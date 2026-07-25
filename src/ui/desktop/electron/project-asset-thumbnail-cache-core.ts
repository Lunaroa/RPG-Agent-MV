import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertProjectAssetThumbnailSizeBucket,
  PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION,
  PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS,
  type ProjectAssetThumbnailSizeBucket,
} from '../../../contract/project-asset-thumbnails.ts';

export {
  assertProjectAssetThumbnailSizeBucket,
  PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION,
  PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS,
  type ProjectAssetThumbnailSizeBucket,
};

/**
 * Decode once: report source dimensions and, when a downscale is required,
 * produce thumbnail PNG bytes from that same decode. `thumbnailPng` is null when
 * both source dimensions are already within the bucket (no downscale needed —
 * not a decode-failure fallback).
 */
export type ProjectAssetThumbnailCodec = (input: {
  sourceFilePath: string;
  sizeBucket: ProjectAssetThumbnailSizeBucket;
}) => {
  width: number;
  height: number;
  thumbnailPng: Buffer | null;
};

export function projectAssetThumbnailProjectKey(project: string): string {
  return crypto
    .createHash('sha256')
    .update(path.resolve(project).toLocaleLowerCase())
    .digest('hex')
    .slice(0, 20);
}

export function projectAssetThumbnailContentVersion(input: {
  relativePath: string;
  sourceBytes: number;
  sourceMtimeMs: number;
  sizeBucket: number;
  schemaVersion?: number;
}): string {
  const schemaVersion = input.schemaVersion ?? PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION;
  return crypto
    .createHash('sha256')
    .update([
      normalizeRelativePath(input.relativePath),
      String(input.sourceBytes),
      String(input.sourceMtimeMs),
      String(input.sizeBucket),
      String(schemaVersion),
    ].join('\0'))
    .digest('hex')
    .slice(0, 40);
}

export function projectAssetThumbnailCachePath(
  workflowRoot: string,
  project: string,
  sizeBucket: number,
  contentVersion: string,
): string {
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  return path.join(
    path.resolve(workflowRoot),
    'runtime',
    'asset-thumbnails',
    projectAssetThumbnailProjectKey(project),
    String(sizeBucket),
    `${contentVersion}.png`,
  );
}

/**
 * When both source dimensions are already within the bucket, no thumbnail PNG is
 * generated and the source file is served as-is. This is "no downscale needed",
 * not a decode-failure fallback.
 */
export function projectAssetThumbnailNeedsDownscale(
  sourceWidth: number,
  sourceHeight: number,
  sizeBucket: number,
): boolean {
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(
      `Invalid source image dimensions for thumbnail: ${sourceWidth}x${sourceHeight}`,
    );
  }
  return sourceWidth > sizeBucket || sourceHeight > sizeBucket;
}

export type ProjectAssetThumbnailPlan =
  | { action: 'serve-source'; reason: 'no-downscale-needed' }
  | { action: 'use-cache'; cachePath: string }
  | { action: 'generate'; cachePath: string };

export function planProjectAssetThumbnail(input: {
  workflowRoot: string;
  project: string;
  relativePath: string;
  sourceBytes: number;
  sourceMtimeMs: number;
  sizeBucket: number;
  sourceWidth: number;
  sourceHeight: number;
  cacheExists: boolean;
  schemaVersion?: number;
}): ProjectAssetThumbnailPlan {
  assertProjectAssetThumbnailSizeBucket(input.sizeBucket);
  const contentVersion = projectAssetThumbnailContentVersion({
    relativePath: input.relativePath,
    sourceBytes: input.sourceBytes,
    sourceMtimeMs: input.sourceMtimeMs,
    sizeBucket: input.sizeBucket,
    schemaVersion: input.schemaVersion,
  });
  const cachePath = projectAssetThumbnailCachePath(
    input.workflowRoot,
    input.project,
    input.sizeBucket,
    contentVersion,
  );
  if (input.cacheExists) return { action: 'use-cache', cachePath };
  if (!projectAssetThumbnailNeedsDownscale(input.sourceWidth, input.sourceHeight, input.sizeBucket)) {
    return { action: 'serve-source', reason: 'no-downscale-needed' };
  }
  return { action: 'generate', cachePath };
}

/**
 * Electron-free thumbnail orchestration: source validation, content version,
 * cache hit, serve-source vs generate, and atomic cache write. The codec is
 * injected so unit tests can drive the flow without Electron.
 */
export function ensureProjectAssetThumbnailSync(input: {
  workflowRoot: string;
  project: string;
  relativePath: string;
  sourceFilePath: string;
  sizeBucket: number;
  codec: ProjectAssetThumbnailCodec;
}): { filePath: string; fromCache: boolean; servedSource: boolean } {
  assertProjectAssetThumbnailSizeBucket(input.sizeBucket);
  if (!fs.existsSync(input.sourceFilePath) || !fs.statSync(input.sourceFilePath).isFile()) {
    throw new Error(`Project asset thumbnail source is missing: ${input.sourceFilePath}`);
  }
  const sourceStat = fs.statSync(input.sourceFilePath);
  const contentVersion = projectAssetThumbnailContentVersion({
    relativePath: input.relativePath,
    sourceBytes: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    sizeBucket: input.sizeBucket,
  });
  const cachePath = projectAssetThumbnailCachePath(
    input.workflowRoot,
    input.project,
    input.sizeBucket,
    contentVersion,
  );
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).isFile()) {
    return { filePath: cachePath, fromCache: true, servedSource: false };
  }

  const decoded = input.codec({
    sourceFilePath: input.sourceFilePath,
    sizeBucket: input.sizeBucket,
  });
  const plan = planProjectAssetThumbnail({
    workflowRoot: input.workflowRoot,
    project: input.project,
    relativePath: input.relativePath,
    sourceBytes: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    sizeBucket: input.sizeBucket,
    sourceWidth: decoded.width,
    sourceHeight: decoded.height,
    cacheExists: false,
  });

  if (plan.action === 'serve-source') {
    return { filePath: input.sourceFilePath, fromCache: false, servedSource: true };
  }

  if (!decoded.thumbnailPng) {
    throw new Error(
      `Thumbnail codec returned no PNG for a source that requires downscale: ${input.sourceFilePath}`,
    );
  }
  writeThumbnailCacheAtomic(plan.cachePath, decoded.thumbnailPng);
  return { filePath: plan.cachePath, fromCache: false, servedSource: false };
}

export function writeThumbnailCacheAtomic(filePath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const temporary = `${filePath}.tmp.${nonce}`;
  fs.writeFileSync(temporary, bytes);
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}
