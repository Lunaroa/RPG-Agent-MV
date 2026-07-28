import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  assertProjectAssetThumbnailSizeBucket,
  computeProjectAssetThumbnailFitSize,
  ensureProjectAssetThumbnailSync,
  planProjectAssetThumbnail,
  PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION,
  PROJECT_EFFECT_THUMBNAIL_SCHEMA_VERSION,
  projectAssetThumbnailCachePath,
  projectAssetThumbnailContentVersion,
  projectAssetThumbnailNeedsDownscale,
  projectEffectThumbnailCachePath,
  projectEffectThumbnailContentVersion,
  type ProjectAssetThumbnailCodec,
} from './project-asset-thumbnail-cache-core.ts';

describe('project asset thumbnail cache core', () => {
  test('rejects size buckets outside the allowed set', () => {
    assert.throws(() => assertProjectAssetThumbnailSizeBucket(96), /Unsupported project asset thumbnail size bucket/);
    assert.throws(() => projectAssetThumbnailNeedsDownscale(100, 100, 96 as 128), /Unsupported/);
  });

  test('fit size keeps aspect ratio and never exceeds the bucket', () => {
    const wide = computeProjectAssetThumbnailFitSize(1000, 500, 128);
    assert.equal(wide.width, 128);
    assert.equal(wide.height, 64);
    assert.ok(wide.width <= 128 && wide.height <= 128);

    const tall = computeProjectAssetThumbnailFitSize(400, 800, 128);
    assert.equal(tall.width, 64);
    assert.equal(tall.height, 128);

    const square = computeProjectAssetThumbnailFitSize(512, 512, 256);
    assert.equal(square.width, 256);
    assert.equal(square.height, 256);

    const near = computeProjectAssetThumbnailFitSize(300, 100, 128);
    assert.equal(near.width, 128);
    assert.equal(near.height, 43);
    assert.ok(Math.abs(near.width / near.height - 3) < 0.05);
    assert.ok(near.width <= 128 && near.height <= 128);
  });

  test('cache path and content version are stable and change with inputs', () => {
    const workflowRoot = path.join('C:', 'workflow');
    const project = path.join(workflowRoot, 'projects', 'demo_mod');
    const base = {
      relativePath: 'img/pictures/Portrait.png',
      sourceBytes: 1024,
      sourceMtimeMs: 1000,
      sizeBucket: 128 as const,
    };
    const versionA = projectAssetThumbnailContentVersion(base);
    const versionB = projectAssetThumbnailContentVersion(base);
    assert.equal(versionA, versionB);

    const pathA = projectAssetThumbnailCachePath(workflowRoot, project, 128, versionA);
    const pathB = projectAssetThumbnailCachePath(workflowRoot, project, 128, versionB);
    assert.equal(pathA, pathB);
    assert.match(pathA.replace(/\\/g, '/'), /runtime\/asset-thumbnails\/[a-f0-9]{20}\/128\/[a-f0-9]{40}\.png$/);

    assert.notEqual(
      versionA,
      projectAssetThumbnailContentVersion({ ...base, sourceMtimeMs: 2000 }),
    );
    assert.notEqual(
      versionA,
      projectAssetThumbnailContentVersion({ ...base, sizeBucket: 256 }),
    );
    assert.notEqual(
      versionA,
      projectAssetThumbnailContentVersion({ ...base, schemaVersion: PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION + 1 }),
    );
    assert.notEqual(
      versionA,
      projectAssetThumbnailContentVersion({ ...base, relativePath: 'img/pictures/Other.png' }),
    );
  });

  test('already-small images report no-downscale-needed instead of generating', () => {
    assert.equal(projectAssetThumbnailNeedsDownscale(64, 48, 128), false);
    assert.equal(projectAssetThumbnailNeedsDownscale(256, 48, 128), true);

    const plan = planProjectAssetThumbnail({
      workflowRoot: path.join('C:', 'workflow'),
      project: path.join('C:', 'workflow', 'projects', 'sample'),
      relativePath: 'img/system/IconSet.png',
      sourceBytes: 100,
      sourceMtimeMs: 1,
      sizeBucket: 128,
      sourceWidth: 96,
      sourceHeight: 96,
      cacheExists: false,
    });
    assert.deepEqual(plan, { action: 'serve-source', reason: 'no-downscale-needed' });
  });

  test('cache miss generates and writes; second call hits cache without re-encoding', () => {
    const root = tempRoot();
    try {
      const project = path.join(root, 'projects', 'demo_mod');
      const sourceFilePath = path.join(project, 'img', 'pictures', 'Large.png');
      fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true });
      fs.writeFileSync(sourceFilePath, 'source-bytes');
      let codecCalls = 0;
      const codec: ProjectAssetThumbnailCodec = () => {
        codecCalls += 1;
        return { width: 512, height: 512, thumbnailPng: Buffer.from('thumb-png') };
      };

      const first = ensureProjectAssetThumbnailSync({
        workflowRoot: root,
        project,
        relativePath: 'img/pictures/Large.png',
        sourceFilePath,
        sizeBucket: 128,
        codec,
      });
      assert.equal(first.fromCache, false);
      assert.equal(first.servedSource, false);
      assert.equal(codecCalls, 1);
      assert.equal(fs.readFileSync(first.filePath, 'utf8'), 'thumb-png');

      const second = ensureProjectAssetThumbnailSync({
        workflowRoot: root,
        project,
        relativePath: 'img/pictures/Large.png',
        sourceFilePath,
        sizeBucket: 128,
        codec,
      });
      assert.equal(second.fromCache, true);
      assert.equal(second.filePath, first.filePath);
      assert.equal(codecCalls, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('already-small source is served directly without writing a cache file', () => {
    const root = tempRoot();
    try {
      const project = path.join(root, 'projects', 'sample');
      const sourceFilePath = path.join(project, 'img', 'system', 'Icon.png');
      fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true });
      fs.writeFileSync(sourceFilePath, 'small-source');
      let codecCalls = 0;
      const codec: ProjectAssetThumbnailCodec = () => {
        codecCalls += 1;
        return { width: 64, height: 48, thumbnailPng: null };
      };

      const result = ensureProjectAssetThumbnailSync({
        workflowRoot: root,
        project,
        relativePath: 'img/system/Icon.png',
        sourceFilePath,
        sizeBucket: 128,
        codec,
      });
      assert.equal(result.servedSource, true);
      assert.equal(result.fromCache, false);
      assert.equal(result.filePath, sourceFilePath);
      assert.equal(codecCalls, 1);

      const cacheRoot = path.join(root, 'runtime', 'asset-thumbnails');
      assert.equal(fs.existsSync(cacheRoot), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('decode failure propagates as an error instead of falling back to the original', () => {
    const root = tempRoot();
    try {
      const project = path.join(root, 'projects', 'demo_mod');
      const sourceFilePath = path.join(project, 'img', 'pictures', 'Broken.rpgmvp');
      fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true });
      fs.writeFileSync(sourceFilePath, 'encrypted');
      const codec: ProjectAssetThumbnailCodec = () => {
        throw new Error(
          `Unsupported or encrypted image for thumbnail: ${sourceFilePath}. Use a decodable PNG/JPEG/WebP, or decrypt the RPG Maker asset first.`,
        );
      };

      assert.throws(
        () => ensureProjectAssetThumbnailSync({
          workflowRoot: root,
          project,
          relativePath: 'img/pictures/Broken.rpgmvp',
          sourceFilePath,
          sizeBucket: 128,
          codec,
        }),
        /Unsupported or encrypted image for thumbnail/,
      );
      assert.equal(fs.existsSync(path.join(root, 'runtime', 'asset-thumbnails')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project effect thumbnail cache core', () => {
  const base = {
    effectRelativePath: 'effects/Recovery1.efkefc',
    sourceBytes: 2048,
    sourceMtimeMs: 5000,
    sizeBucket: 256 as const,
  };

  test('effect content version is stable and changes with each fingerprint input', () => {
    const versionA = projectEffectThumbnailContentVersion(base);
    assert.equal(versionA, projectEffectThumbnailContentVersion(base));
    assert.match(versionA, /^[a-f0-9]{40}$/);

    assert.notEqual(versionA, projectEffectThumbnailContentVersion({ ...base, sourceBytes: 4096 }));
    assert.notEqual(versionA, projectEffectThumbnailContentVersion({ ...base, sourceMtimeMs: 6000 }));
    assert.notEqual(versionA, projectEffectThumbnailContentVersion({ ...base, sizeBucket: 128 }));
    assert.notEqual(versionA, projectEffectThumbnailContentVersion({ ...base, effectRelativePath: 'effects/Recovery2.efkefc' }));
    assert.notEqual(
      versionA,
      projectEffectThumbnailContentVersion({ ...base, schemaVersion: PROJECT_EFFECT_THUMBNAIL_SCHEMA_VERSION + 1 }),
    );
  });

  test('effect cache path is isolated from image thumbnails via the effect segment', () => {
    const workflowRoot = path.join('C:', 'workflow');
    const project = path.join(workflowRoot, 'projects', 'demo_mod');
    const version = projectEffectThumbnailContentVersion(base);
    const effectPath = projectEffectThumbnailCachePath(workflowRoot, project, 256, version);
    assert.match(
      effectPath.replace(/\\/g, '/'),
      /runtime\/asset-thumbnails\/[a-f0-9]{20}\/effect\/256\/[a-f0-9]{40}\.png$/,
    );
    // Must never collide with the image thumbnail path (which has no `effect` segment).
    assert.notEqual(effectPath, projectAssetThumbnailCachePath(workflowRoot, project, 256, version));
  });

  test('effect and image content versions never collide for identical fingerprint inputs', () => {
    const shared = { sourceBytes: 1024, sourceMtimeMs: 1000, sizeBucket: 128 as const };
    const effectVersion = projectEffectThumbnailContentVersion({ ...shared, effectRelativePath: 'effects/A.efkefc' });
    const imageVersion = projectAssetThumbnailContentVersion({ ...shared, relativePath: 'effects/A.efkefc' });
    assert.notEqual(effectVersion, imageVersion);
  });
});

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-asset-thumb-'));
}
