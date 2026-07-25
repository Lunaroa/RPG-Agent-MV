import { nativeImage } from 'electron';

import {
  assertProjectAssetThumbnailSizeBucket,
  computeProjectAssetThumbnailFitSize,
  ensureProjectAssetThumbnailSync,
  projectAssetThumbnailNeedsDownscale,
  type ProjectAssetThumbnailCodec,
  type ProjectAssetThumbnailSizeBucket,
} from './project-asset-thumbnail-cache-core.ts';

/**
 * Thumbnail decode/resize is synchronous native work on the Electron main process.
 * Requests are serialized, and each generation awaits setImmediate first so other
 * main-process work can interleave between bursts instead of monopolizing the event loop.
 */
let thumbnailTail: Promise<unknown> = Promise.resolve();

export function createNativeImageProjectAssetThumbnailCodec(): ProjectAssetThumbnailCodec {
  return ({ sourceFilePath, sizeBucket }) => {
    const image = nativeImage.createFromPath(sourceFilePath);
    if (image.isEmpty()) {
      throw new Error(
        `Unsupported or encrypted image for thumbnail: ${sourceFilePath}. Use a decodable PNG/JPEG/WebP, or decrypt the RPG Maker asset first.`,
      );
    }
    const { width, height } = image.getSize();
    if (!projectAssetThumbnailNeedsDownscale(width, height, sizeBucket)) {
      return { width, height, thumbnailPng: null };
    }
    const { width: targetWidth, height: targetHeight } = computeProjectAssetThumbnailFitSize(
      width,
      height,
      sizeBucket,
    );
    const resized = image.resize({ width: targetWidth, height: targetHeight, quality: 'best' });
    if (resized.isEmpty()) {
      throw new Error(`Failed to resize image for thumbnail: ${sourceFilePath}`);
    }
    return { width, height, thumbnailPng: resized.toPNG() };
  };
}

const defaultCodec = createNativeImageProjectAssetThumbnailCodec();

export async function ensureProjectAssetThumbnail(input: {
  workflowRoot: string;
  project: string;
  relativePath: string;
  sourceFilePath: string;
  sizeBucket: number;
  codec?: ProjectAssetThumbnailCodec;
}): Promise<{ filePath: string; fromCache: boolean; servedSource: boolean }> {
  assertProjectAssetThumbnailSizeBucket(input.sizeBucket);
  const codec = input.codec ?? defaultCodec;
  const run = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return ensureProjectAssetThumbnailSync({
      workflowRoot: input.workflowRoot,
      project: input.project,
      relativePath: input.relativePath,
      sourceFilePath: input.sourceFilePath,
      sizeBucket: input.sizeBucket as ProjectAssetThumbnailSizeBucket,
      codec,
    });
  };
  const result = thumbnailTail.then(run, run);
  thumbnailTail = result.then(() => undefined, () => undefined);
  return result;
}
