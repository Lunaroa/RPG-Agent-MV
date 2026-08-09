import { BrowserWindow, ipcMain, screen } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { assertBackgroundWindowState, captureBackgroundPage } from './ui-control-background.js';
import { MAP_PREVIEW_SCHEME } from './map-preview-protocol-policy.js';
import { normalizeUiControlCommand, type UiControlCommand } from './ui-control-command.js';
import { UI_CONTROL_WINDOW_MODE, isBackgroundUiControlMode } from './ui-control-mode.js';
import { acquireUiControlServerLock, prepareUiControlServerInfo } from './ui-control-server-state.js';

interface UiControlServerInfo {
  host: '127.0.0.1';
  port: number;
  token: string;
  pid: number;
  windowMode: typeof UI_CONTROL_WINDOW_MODE;
  startedAt: string;
  commandUrl: string;
}

interface RendererEnvelope {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRendererCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class RendererCommandError extends Error {
  readonly result: unknown;

  constructor(message: string, result: unknown) {
    super(message);
    this.name = 'RendererCommandError';
    this.result = result;
  }
}

let server: http.Server | null = null;
let serverInfo: UiControlServerInfo | null = null;
let workflowRoot = '';
let resolveWindow: (() => BrowserWindow | null) | null = null;
let rendererResultListenerRegistered = false;
let releaseServerLock: (() => void) | null = null;
const pendingRendererCommands = new Map<string, PendingRendererCommand>();

export async function startUiControlBridge(root: string, getWindow: () => BrowserWindow | null): Promise<void> {
  if (!isBackgroundUiControlMode()) return;
  workflowRoot = root;
  resolveWindow = getWindow;
  if (server) return;
  const win = resolveWindow() || null;
  if (!win) throw new Error('Electron background validation window is not available.');
  assertBackgroundWindowState(win);
  prepareUiControlServerInfo(serverInfoPath());
  releaseServerLock = acquireUiControlServerLock(serverLockPath());
  try {
    registerRendererResultListener();

    const token = crypto.randomBytes(24).toString('hex');
    server = http.createServer((request, response) => {
      void handleHttpRequest(request, response, token);
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => {
        server!.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('UI control bridge did not bind a local port.');
    serverInfo = {
      host: '127.0.0.1',
      port: address.port,
      token,
      pid: process.pid,
      windowMode: UI_CONTROL_WINDOW_MODE,
      startedAt: new Date().toISOString(),
      commandUrl: `http://127.0.0.1:${address.port}/command`,
    };
    fs.mkdirSync(uiControlDir(), { recursive: true });
    fs.writeFileSync(serverInfoPath(), JSON.stringify(serverInfo, null, 2) + '\n', 'utf8');
    console.log(`[ui-control] local bridge listening on ${serverInfo.commandUrl}`);
  } catch (error) {
    server?.close();
    server = null;
    if (rendererResultListenerRegistered) {
      ipcMain.removeListener('ui-control:renderer-result', onRendererResult);
      rendererResultListenerRegistered = false;
    }
    releaseServerLock?.();
    releaseServerLock = null;
    throw error;
  }
}

export function stopUiControlBridge(): void {
  for (const pending of pendingRendererCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('UI control bridge stopped.'));
  }
  pendingRendererCommands.clear();
  if (rendererResultListenerRegistered) {
    ipcMain.removeListener('ui-control:renderer-result', onRendererResult);
    rendererResultListenerRegistered = false;
  }
  if (server) {
    server.close();
    server = null;
  }
  serverInfo = null;
  if (workflowRoot) {
    try {
      fs.rmSync(serverInfoPath(), { force: true });
    } catch {
      // Stale bridge metadata is non-critical during shutdown.
    }
  }
  releaseServerLock?.();
  releaseServerLock = null;
}

async function handleHttpRequest(request: http.IncomingMessage, response: http.ServerResponse, token: string): Promise<void> {
  try {
    if (request.method !== 'POST' || request.url !== '/command') {
      writeJsonResponse(response, 404, { ok: false, error: 'Unsupported UI control endpoint.' });
      return;
    }
    const auth = String(request.headers['x-agent-rpg-token'] || '');
    if (!auth || auth !== token) {
      writeJsonResponse(response, 403, { ok: false, error: 'Invalid UI control token.' });
      return;
    }
    const rawBody = await readRequestBody(request);
    const command = normalizeUiControlCommand(JSON.parse(rawBody || '{}'));
    const result = await runUiControlCommand(command);
    writeJsonResponse(response, result.ok ? 200 : 500, result);
  } catch (error) {
    writeJsonResponse(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runUiControlCommand(command: UiControlCommand): Promise<Record<string, unknown>> {
  const win = resolveWindow?.() || null;
  if (!win || win.isDestroyed()) throw new Error('Electron window is not available.');
  assertBackgroundWindowState(win);

  const shouldCapture = command.capture ?? command.type !== 'state';

  let rendererResult: unknown = null;
  let commandError: string | null = null;
  try {
    rendererResult = command.type === 'frame-read'
      ? await readPreviewFrameDiagnostics(win, command)
      : await sendRendererCommand(win, command.type === 'capture-current' ? { ...command, type: 'state' } : command);
  } catch (error) {
    if (error instanceof RendererCommandError) rendererResult = error.result;
    commandError = error instanceof Error ? error.message : String(error);
  }
  assertBackgroundWindowState(win);

  let snapshot: Record<string, unknown> | null = null;
  if (shouldCapture) {
    try {
      snapshot = await captureSnapshot(win, command, rendererResult, commandError);
    } catch (error) {
      if (!commandError) commandError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: !commandError,
    command,
    error: commandError,
    renderer: rendererResult,
    snapshot,
  };
}

function sendRendererCommand(win: BrowserWindow, command: UiControlCommand): Promise<unknown> {
  if (win.webContents.isDestroyed()) throw new Error('Electron renderer is not available.');
  const id = crypto.randomUUID();
  const timeoutMs = clampNumber(command.timeoutMs, 15000, 1000, 60000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRendererCommands.delete(id);
      reject(new Error(`UI control command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    pendingRendererCommands.set(id, { resolve, reject, timer });
    win.webContents.send('ui-control:command', { id, command });
  });
}

function registerRendererResultListener(): void {
  if (rendererResultListenerRegistered) return;
  ipcMain.on('ui-control:renderer-result', onRendererResult);
  rendererResultListenerRegistered = true;
}

/** Fixed, read-only diagnostics executed inside the isolated preview frame; no caller-supplied code. */
const PREVIEW_FRAME_DIAGNOSTIC_SCRIPT = `(async function () {
  var out = { url: String(location.href), visibility: document.visibilityState, hasFocus: document.hasFocus() };
  out.raf = await new Promise(function (resolve) {
    var frames = 0;
    var started = performance.now();
    var settled = false;
    function finish(timedOut) {
      if (settled) return;
      settled = true;
      var elapsed = performance.now() - started;
      resolve({ frames: frames, elapsedMs: Math.round(elapsed), fps: Math.round(frames * 1000 / Math.max(1, elapsed)), timedOut: Boolean(timedOut) });
    }
    function tick() {
      frames += 1;
      if (performance.now() - started >= 1000) finish(false);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(function () { finish(true); }, 3000);
  });
  try {
    var scene = window.SceneManager && SceneManager._scene;
    out.scene = scene && scene.constructor ? scene.constructor.name : null;
    out.sceneStarted = Boolean(scene && scene._started);
    out.fade = scene ? { sign: scene._fadeSign, duration: scene._fadeDuration, opacity: scene._fadeSprite ? scene._fadeSprite.opacity : null } : null;
    var mzApp = window.Graphics && Graphics.app;
    out.ticker = mzApp && mzApp.ticker ? { started: mzApp.ticker.started, fps: Math.round(mzApp.ticker.FPS) } : null;
    var uiRuntime = scene && scene._mzuiCanvasRuntime;
    if (uiRuntime) {
      var particleNodes = (uiRuntime.scene && Array.isArray(uiRuntime.scene.nodes) ? uiRuntime.scene.nodes : []).filter(function (node) { return node && node.type === 'particle'; });
      var particleLimit = 32;
      var particleActive = 0;
      var particlePooled = 0;
      out.uiParticles = {
        mounted: Boolean(uiRuntime.mounted),
        nodeCount: particleNodes.length,
        truncated: particleNodes.length > particleLimit,
        nodes: particleNodes.slice(0, particleLimit).map(function (node) {
          var state = uiRuntime.frameAnimationState && uiRuntime.frameAnimationState[node.id];
          var view = uiRuntime.nodeViews && uiRuntime.nodeViews[node.id];
          var layer = view && view.__mzuiParticleLayer;
          var active = state && Array.isArray(state.particles) ? state.particles.length : 0;
          var pooled = state && Array.isArray(state.pool) ? state.pool.length : 0;
          particleActive += active;
          particlePooled += pooled;
          return {
            nodeId: String(node.id || '').slice(0, 128),
            active: active,
            pooled: pooled,
            layerType: layer && layer.constructor ? String(layer.constructor.name).slice(0, 64) : null,
            childType: layer ? String(layer.__mzuiParticleChildType || '').slice(0, 32) : null,
            glow: Number(node.props && node.props.glow || 0),
            viewDestroyed: Boolean(view && view.__mzuiDestroyed),
            layerDestroyed: Boolean(layer && (layer.__mzuiParticleDestroyed || layer.destroyed)),
          };
        }),
      };
      out.uiParticles.active = particleActive;
      out.uiParticles.pooled = particlePooled;
    } else out.uiParticles = null;
    var probeStage = scene || (mzApp && mzApp.stage) || null;
    out.stageChildren = probeStage ? probeStage.children.map(function (child) {
      var bitmap = child.bitmap;
      return {
        type: child.constructor ? child.constructor.name : 'unknown',
        visible: child.visible,
        alpha: child.alpha,
        bitmap: bitmap ? { url: String(bitmap._url || bitmap.url || ''), state: bitmap._loadingState || null, width: bitmap.width, height: bitmap.height } : null,
      };
    }) : null;
    out.effekseer = Boolean(window.Graphics && Graphics.effekseer);
  } catch (error) { out.sceneError = String(error); }
  try {
    out.frameCount = window.Graphics ? Graphics.frameCount : null;
    var app = window.Graphics && Graphics.app;
    out.appStage = Boolean(app && app.stage);
    if (app && app.ticker) {
      try {
        app.ticker.update(performance.now());
        out.manualTick = 'ok';
      } catch (tickError) {
        out.manualTick = String(tickError && (tickError.stack || tickError.message) || tickError).slice(0, 500);
      }
      out.frameCountAfterTick = window.Graphics ? Graphics.frameCount : null;
    }
  } catch (error) { out.tickProbeError = String(error); }
  try { out.bodyText = String(document.body && document.body.innerText || '').slice(0, 400); } catch (error) { out.bodyTextError = String(error); }
  try { out.brightness = window.$gameScreen ? $gameScreen.brightness() : null; } catch (error) { out.brightnessError = String(error); }
  try { out.transferring = Boolean(window.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring()); } catch (error) { out.transferringError = String(error); }
  try { out.imagesReady = !window.ImageManager || !ImageManager.isReady || ImageManager.isReady(); } catch (error) { out.imagesReadyError = String(error); }
  try {
    var canvas = document.querySelector('canvas');
    out.canvas = canvas ? { width: canvas.width, height: canvas.height } : null;
    var renderer = window.Graphics && (Graphics._renderer || (Graphics.app && Graphics.app.renderer));
    var gl = renderer && renderer.gl;
    var stage = (window.SceneManager && SceneManager._scene)
      || (window.Graphics && Graphics.app && Graphics.app.stage)
      || (window.Graphics && Graphics._stage)
      || null;
    if (renderer && gl && stage) {
      renderer.render(stage);
      var width = gl.drawingBufferWidth;
      var height = gl.drawingBufferHeight;
      var block = 32;
      var spots = [
        ['center', Math.max(0, ((width - block) / 2) | 0), Math.max(0, ((height - block) / 2) | 0)],
        ['q1', Math.max(0, ((width / 4) | 0) - block), Math.max(0, ((height / 4) | 0) - block)],
        ['q3', Math.min(width - block, ((width * 3 / 4) | 0)), Math.min(height - block, ((height * 3 / 4) | 0))],
      ];
      var pixels = {};
      for (var i = 0; i < spots.length; i += 1) {
        var buffer = new Uint8Array(4 * block * block);
        gl.readPixels(spots[i][1], spots[i][2], block, block, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
        var sum = 0;
        var nonBlack = 0;
        var total = block * block;
        for (var p = 0; p < total; p += 1) {
          var value = buffer[p * 4] + buffer[p * 4 + 1] + buffer[p * 4 + 2];
          sum += value;
          if (value > 24) nonBlack += 1;
        }
        pixels[spots[i][0]] = { meanBrightness: Math.round(sum / (total * 3)), nonBlackRatio: Math.round(nonBlack * 1000 / total) / 1000 };
      }
      out.pixels = pixels;
    }
  } catch (error) { out.pixelsError = String(error); }
  return out;
}())`;

/** Minimal rAF sampler for the embedder main frame, to compare against the preview OOPIF. */
const MAIN_FRAME_RAF_SCRIPT = `(function () {
  return new Promise(function (resolve) {
    var frames = 0;
    var started = performance.now();
    var settled = false;
    function finish(timedOut) {
      if (settled) return;
      settled = true;
      var elapsed = performance.now() - started;
      resolve({ frames: frames, elapsedMs: Math.round(elapsed), fps: Math.round(frames * 1000 / Math.max(1, elapsed)), timedOut: Boolean(timedOut) });
    }
    function tick() {
      frames += 1;
      if (performance.now() - started >= 1000) finish(false);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(function () { finish(true); }, 3000);
  });
}())`;

async function readPreviewFrameDiagnostics(win: BrowserWindow, command: UiControlCommand): Promise<unknown> {
  const frame = win.webContents.mainFrame.framesInSubtree.find(
    (candidate) => candidate.url.startsWith(`${MAP_PREVIEW_SCHEME.scheme}://`),
  );
  if (!frame) throw new Error('No isolated map preview frame is loaded.');
  const timeoutMs = clampNumber(command.timeoutMs, 15000, 1000, 60000);
  const diagnostics = await Promise.race([
    Promise.all([
      frame.executeJavaScript(PREVIEW_FRAME_DIAGNOSTIC_SCRIPT, true),
      win.webContents.executeJavaScript(MAIN_FRAME_RAF_SCRIPT, true),
    ]).then(([frameResult, mainFrameRaf]) => Object.assign({}, frameResult as Record<string, unknown>, { mainFrameRaf })),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Preview frame diagnostics timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]);
  return { frameUrl: frame.url, frameProcessId: frame.processId, diagnostics };
}

function onRendererResult(_event: Electron.IpcMainEvent, envelope: RendererEnvelope): void {
  const id = String(envelope?.id || '');
  const pending = pendingRendererCommands.get(id);
  if (!pending) return;
  pendingRendererCommands.delete(id);
  clearTimeout(pending.timer);
  if (envelope.ok) pending.resolve(envelope.result);
  else pending.reject(new RendererCommandError(String(envelope.error || 'UI control renderer command failed.'), envelope.result));
}

async function captureSnapshot(
  win: BrowserWindow,
  command: UiControlCommand,
  rendererResult: unknown,
  commandError: string | null,
): Promise<Record<string, unknown>> {
  assertBackgroundWindowState(win);
  const waitMs = clampNumber(command.waitMs, 150, 0, 5000);
  if (waitMs > 0) await delay(waitMs);

  const { image, png } = await captureBackgroundPage(win);

  const label = sanitizeSnapshotLabel(command.label || command.target || command.type);
  const stamp = timestampForFileName();
  const dir = uiSnapshotDir();
  fs.mkdirSync(dir, { recursive: true });
  const pngPath = path.join(dir, `${stamp}_${label}.png`);
  const jsonPath = path.join(dir, `${stamp}_${label}.json`);
  fs.writeFileSync(pngPath, png);

  const bounds = win.getBounds();
  const [contentWidth, contentHeight] = win.getContentSize();
  const captureSize = image.getSize();
  const display = screen.getDisplayMatching(bounds);
  const metadata = {
    ok: !commandError,
    error: commandError,
    command,
    renderer: rendererResult,
    screenshotPath: pngPath,
    metadataPath: jsonPath,
    window: {
      width: contentWidth,
      height: contentHeight,
      x: bounds.x,
      y: bounds.y,
      outerWidth: bounds.width,
      outerHeight: bounds.height,
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
      visible: win.isVisible(),
      focused: win.isFocused(),
      mode: UI_CONTROL_WINDOW_MODE,
      layout: 'primary-work-area',
      workArea: display.workArea,
      deviceScaleFactor: display.scaleFactor,
      captureWidth: captureSize.width,
      captureHeight: captureSize.height,
    },
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  return metadata;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new Error('UI control command body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function writeJsonResponse(response: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

function uiControlDir(): string {
  return path.join(workflowRoot, 'runtime', 'out', 'ui-control');
}

function uiSnapshotDir(): string {
  return path.join(workflowRoot, 'runtime', 'out', 'ui-snapshots');
}

function serverInfoPath(): string {
  return path.join(uiControlDir(), 'server.json');
}

function serverLockPath(): string {
  return path.join(uiControlDir(), 'server.lock');
}

function sanitizeSnapshotLabel(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return sanitized || 'ui';
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
