import { BrowserWindow, nativeImage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { captureBackgroundPage, type BackgroundCaptureWindow } from './ui-control-background.js';
import { registerMapPreviewRoot, unregisterMapPreviewRoot } from './map-preview-protocol.js';
import {
  assertProjectAssetThumbnailSizeBucket,
  projectEffectThumbnailCachePath,
  projectEffectThumbnailContentVersion,
  writeThumbnailCacheAtomic,
} from './project-asset-thumbnail-cache-core.ts';

/**
 * Offscreen effect-thumbnail generation.
 *
 * Effekseer effects are animations that cannot be rasterized statically, so a
 * representative frame is produced by playing the effect in an off-screen window
 * and capturing it. The backend prepares a tiny capture app (autoplay, no battle
 * background) whose runtime freezes on a representative frame and signals via
 * document.title; here we host it in an off-screen BrowserWindow, capturePage the
 * frozen frame, crop-and-resize to a square bucket, and content-address the PNG.
 *
 * Generation is fully IPC-driven: the asset protocol only ever serves a cache
 * that already exists. Runs are serialized (one off-screen window at a time) and
 * de-duplicated by cache path so concurrent callers share one capture.
 */

/** Backend-provided capture app; sizing + serve-direct roots come from the preparation. */
export interface EffectThumbnailCapturePreparation {
  appDirectory: string;
  screenWidth: number;
  screenHeight: number;
  passthroughRoot: string;
  passthroughPrefixes: readonly string[];
}

export interface EnsureEffectThumbnailInput {
  workflowRoot: string;
  project: string;
  effectName: string;
  /** Effective `effects/<name>.efkefc` project-relative path (drives the content version). */
  relativePath: string;
  /** Effective `.efkefc` file on disk (drives the content version fingerprint). */
  sourceFilePath: string;
  sizeBucket: number;
  captureFrameCount: number;
  /** document.title the capture runtime sets once the representative frame is frozen. */
  readyTitle: string;
  prepareCaptureApp: (input: {
    workflowRoot: string;
    project: string;
    effectName: string;
    captureFrameCount: number;
  }) => EffectThumbnailCapturePreparation;
  cleanupCaptureApp: (preparation: { appDirectory: string }) => void;
}

export interface EffectThumbnailResult {
  filePath: string;
  fromCache: boolean;
}

// Once the capture window renders at full frame rate its runtime freezes on a
// representative frame within ~3s (180-tick cap), so this only fires if navigation
// or WebGL init wedges. Keep above the runtime cap so a healthy capture never times out.
const CAPTURE_READY_TIMEOUT_MS = 6_000;

let generationTail: Promise<unknown> = Promise.resolve();
const inFlightByCachePath = new Map<string, Promise<EffectThumbnailResult>>();

export async function ensureEffectThumbnail(
  input: EnsureEffectThumbnailInput,
): Promise<EffectThumbnailResult> {
  assertProjectAssetThumbnailSizeBucket(input.sizeBucket);
  if (!fs.existsSync(input.sourceFilePath) || !fs.statSync(input.sourceFilePath).isFile()) {
    throw new Error(`Effect thumbnail source is missing: ${input.sourceFilePath}`);
  }
  const stat = fs.statSync(input.sourceFilePath);
  const contentVersion = projectEffectThumbnailContentVersion({
    effectRelativePath: input.relativePath,
    sourceBytes: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    sizeBucket: input.sizeBucket,
  });
  const cachePath = projectEffectThumbnailCachePath(
    input.workflowRoot,
    input.project,
    input.sizeBucket,
    contentVersion,
  );
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).isFile()) {
    return { filePath: cachePath, fromCache: true };
  }

  const inFlight = inFlightByCachePath.get(cachePath);
  if (inFlight) return inFlight;

  const run = async (): Promise<EffectThumbnailResult> => {
    // A concurrent run queued ahead may have produced the same cache entry.
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).isFile()) {
      return { filePath: cachePath, fromCache: true };
    }
    const png = await captureEffectRepresentativeFrame(input);
    const square = cropAndResizeToBucketPng(png, input.sizeBucket);
    writeThumbnailCacheAtomic(cachePath, square);
    return { filePath: cachePath, fromCache: false };
  };

  // Serialize generation so only one off-screen capture window exists at a time.
  const queued = generationTail.then(run, run);
  generationTail = queued.then(() => undefined, () => undefined);
  const tracked = queued.finally(() => {
    if (inFlightByCachePath.get(cachePath) === tracked) inFlightByCachePath.delete(cachePath);
  });
  inFlightByCachePath.set(cachePath, tracked);
  return tracked;
}

async function captureEffectRepresentativeFrame(input: EnsureEffectThumbnailInput): Promise<Buffer> {
  const preparation = input.prepareCaptureApp({
    workflowRoot: input.workflowRoot,
    project: input.project,
    effectName: input.effectName,
    captureFrameCount: input.captureFrameCount,
  });
  const key = crypto.randomBytes(32).toString('hex');
  let win: BrowserWindow | null = null;
  try {
    // Runtime scripts, Effekseer resources and the effect are served straight from
    // the project through the isolated preview protocol (no per-session copy).
    const url = registerMapPreviewRoot(key, preparation.appDirectory, [], {
      root: preparation.passthroughRoot,
      prefixes: preparation.passthroughPrefixes,
    });
    // The window must be shown (not show:false) or the compositor pauses the page's
    // requestAnimationFrame loop, so the MZ game loop never advances to a representative
    // frame and every capture waits out the timeout. Position it far off-screen and keep
    // it non-focusable / off the taskbar so it renders at full frame rate yet stays invisible.
    win = new BrowserWindow({
      show: true,
      x: -32_000,
      y: -32_000,
      skipTaskbar: true,
      focusable: false,
      minimizable: false,
      useContentSize: true,
      width: Math.max(1, Math.round(preparation.screenWidth)),
      height: Math.max(1, Math.round(preparation.screenHeight)),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // Attach the readiness listener before navigating so the signal is never missed.
    const ready = waitForCaptureReadyTitle(win, input.readyTitle, CAPTURE_READY_TIMEOUT_MS);
    await win.loadURL(url);
    await ready;
    const capture = await captureBackgroundPage(win as unknown as BackgroundCaptureWindow);
    return capture.png;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    unregisterMapPreviewRoot(key);
    try {
      input.cleanupCaptureApp({ appDirectory: preparation.appDirectory });
    } catch {
      // Best effort: a leftover temp dir must not fail an otherwise good capture.
    }
  }
}

function waitForCaptureReadyTitle(
  win: BrowserWindow,
  readyTitle: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onTitle = (_event: unknown, title: string): void => {
      if (title === readyTitle) finish();
    };
    const onGone = (): void => finish(new Error('Effect thumbnail renderer exited before signalling a ready frame.'));
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.webContents.off('page-title-updated', onTitle);
      win.webContents.off('render-process-gone', onGone);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('Effect thumbnail capture timed out before the runtime signalled a ready frame.')),
      timeoutMs,
    );
    win.webContents.on('page-title-updated', onTitle);
    win.webContents.on('render-process-gone', onGone);
  });
}

/**
 * Center-crop the captured frame to a square then resize to the bucket, so the
 * effect (rendered around screen center) fills a square thumbnail without
 * distortion. Uses Electron nativeImage to match the image thumbnail codec.
 */
function cropAndResizeToBucketPng(png: Buffer, sizeBucket: number): Buffer {
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) throw new Error('Captured effect frame produced an empty image.');
  const { width, height } = image.getSize();
  if (width < 1 || height < 1) throw new Error('Captured effect frame has invalid dimensions.');
  const side = Math.min(width, height);
  const squared = width === height
    ? image
    : image.crop({
      x: Math.max(0, Math.floor((width - side) / 2)),
      y: Math.max(0, Math.floor((height - side) / 2)),
      width: side,
      height: side,
    });
  const resized = squared.resize({ width: sizeBucket, height: sizeBucket, quality: 'best' });
  if (resized.isEmpty()) throw new Error('Failed to resize captured effect frame.');
  return resized.toPNG();
}
