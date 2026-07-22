import { BrowserWindow, ipcMain, screen } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { assertBackgroundWindowState, captureBackgroundPage } from './ui-control-background.js';
import { UI_CONTROL_WINDOW_MODE, isBackgroundUiControlMode } from './ui-control-mode.js';
import { acquireUiControlServerLock, prepareUiControlServerInfo } from './ui-control-server-state.js';

type UiControlCommandType =
  | 'capture-current'
  | 'navigate'
  | 'open-event-editor'
  | 'state'
  | 'click'
  | 'pointer'
  | 'input'
  | 'key'
  | 'read'
  | 'wait';

type UiControlWaitCondition = 'present' | 'visible' | 'hidden' | 'enabled' | 'disabled' | 'text' | 'value';

interface UiControlCommand {
  type: UiControlCommandType;
  target?: string;
  mapId?: number;
  eventId?: number;
  label?: string;
  capture?: boolean;
  waitMs?: number;
  timeoutMs?: number;
  selector?: string;
  testId?: string;
  text?: string;
  key?: string;
  condition?: UiControlWaitCondition;
  expect?: string;
  modifiers?: string[];
  phase?: 'down' | 'move' | 'up';
  offsetX?: number;
  offsetY?: number;
  button?: number;
}

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

const ALLOWED_TARGETS = new Set([
  'workbench',
  'map-overview',
  'console-home',
  'console-assets',
  'console-story',
  'console-plugins',
  'console-logs',
  'console-settings',
]);

const ALLOWED_COMMAND_TYPES = new Set<UiControlCommandType>([
  'capture-current',
  'navigate',
  'open-event-editor',
  'state',
  'click',
  'pointer',
  'input',
  'key',
  'read',
  'wait',
]);

const ALLOWED_WAIT_CONDITIONS = new Set<UiControlWaitCondition>([
  'present',
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'text',
  'value',
]);

const ALLOWED_MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'meta', 'control', 'cmd', 'command', 'win', 'windows']);

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
    const command = normalizeCommand(JSON.parse(rawBody || '{}'));
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
    rendererResult = await sendRendererCommand(win, command.type === 'capture-current' ? { ...command, type: 'state' } : command);
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

function normalizeCommand(raw: unknown): UiControlCommand {
  if (!raw || typeof raw !== 'object') throw new Error('UI control command must be an object.');
  const value = raw as Record<string, unknown>;
  const type = String(value.type || '') as UiControlCommandType;
  if (!ALLOWED_COMMAND_TYPES.has(type)) {
    throw new Error(`Unsupported UI control command type: ${String(value.type || '')}`);
  }
  const command: UiControlCommand = { type };
  if (typeof value.label === 'string' && value.label.trim()) command.label = value.label.trim();
  if (typeof value.capture === 'boolean') command.capture = value.capture;
  command.waitMs = clampNumber(value.waitMs, 150, 0, 5000);
  command.timeoutMs = clampNumber(value.timeoutMs, 15000, 1000, 60000);

  if (type === 'navigate') {
    const target = String(value.target || '');
    if (!ALLOWED_TARGETS.has(target)) throw new Error(`Unsupported UI control target: ${target}`);
    command.target = target;
  }

  if (type === 'open-event-editor') {
    command.mapId = normalizePositiveInteger(value.mapId, 'mapId');
    command.eventId = normalizePositiveInteger(value.eventId, 'eventId');
  }

  if (['click', 'pointer', 'input', 'read', 'wait'].includes(type)) {
    normalizeElementTarget(value, command);
  }

  if (type === 'pointer') {
    const phase = String(value.phase || '') as 'down' | 'move' | 'up';
    if (!['down', 'move', 'up'].includes(phase)) throw new Error('pointer command requires phase down, move, or up.');
    const offsetX = Number(value.offsetX);
    const offsetY = Number(value.offsetY);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new Error('pointer command requires finite offsetX and offsetY.');
    command.phase = phase;
    command.offsetX = offsetX;
    command.offsetY = offsetY;
    const button = value.button == null ? 0 : Number(value.button);
    if (!Number.isInteger(button) || button < 0 || button > 2) throw new Error('pointer command button must be 0, 1, or 2.');
    command.button = button;
  }

  if (type === 'input') {
    if (typeof value.text !== 'string') throw new Error('input command requires text.');
    command.text = value.text;
  }

  if (type === 'key') {
    if (value.selector !== undefined || value.testId !== undefined) normalizeElementTarget(value, command);
    if (typeof value.key !== 'string' || !value.key.trim()) throw new Error('key command requires key.');
    command.key = value.key.trim();
    command.modifiers = normalizeModifiers(value.modifiers);
  }

  if (type === 'wait') {
    const condition = String(value.condition || 'visible') as UiControlWaitCondition;
    if (!ALLOWED_WAIT_CONDITIONS.has(condition)) throw new Error(`Unsupported wait condition: ${condition}`);
    command.condition = condition;
    if (value.expect !== undefined) {
      if (typeof value.expect !== 'string') throw new Error('wait expect must be a string.');
      command.expect = value.expect;
    }
  }

  return command;
}

function normalizeElementTarget(value: Record<string, unknown>, command: UiControlCommand): void {
  const selector = typeof value.selector === 'string' ? value.selector.trim() : '';
  const testId = typeof value.testId === 'string' ? value.testId.trim() : '';
  if (selector && testId) throw new Error('Use either selector or testId, not both.');
  if (!selector && !testId) throw new Error(`${command.type} command requires selector or testId.`);
  if (selector) command.selector = selector;
  if (testId) command.testId = testId;
}

function normalizeModifiers(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const modifiers = raw
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  for (const modifier of modifiers) {
    if (!ALLOWED_MODIFIERS.has(modifier)) throw new Error(`Unsupported key modifier: ${modifier}`);
  }
  return modifiers;
}

function normalizePositiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be an integer >= 1.`);
  return parsed;
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
