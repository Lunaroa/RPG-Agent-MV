import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  GameBuildArtifact,
  GameBuildReport,
  GameReleasePublicationMetadata,
} from '../../../../contract/game-release.ts';
import { collectDirectoryDigest, sha256File, writeJsonAtomically } from './game-build-file-service.ts';
import {
  createGameManifestSigningIdentity,
  verifyGameReleaseManifestSignature,
} from './game-manifest-signing-service.ts';
import { publishGameRelease } from './game-release-publication-service.ts';

const metadata: GameReleasePublicationMetadata = {
  defaultLanguage: 'zh-CN',
  title: { 'zh-CN': '测试版本' },
  summary: { 'zh-CN': '修复若干问题。' },
  required: false,
  maintenance: null,
};

test('publishes a directory artifact into a multi-game index and permits an identical retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-'));
  const project = path.join(root, 'projects', 'sample');
  const artifact = path.join(root, 'artifacts', 'sample-web');
  const publishDirectory = path.join(root, 'public');
  try {
    write(artifact, 'index.html', '<!doctype html>');
    write(artifact, 'data/System.json', '{}');
    const releaseId = 'release-one';
    writeReport(project, releaseId, directoryArtifact(artifact, 'directory'));

    const first = await publishGameRelease(project, {
      releaseId,
      publishDirectory,
      metadata,
      updateLatest: true,
    });
    assert.equal(fs.existsSync(path.join(first.releaseDirectory, 'sample-web', 'index.html')), true);
    const index = JSON.parse(fs.readFileSync(first.indexPath, 'utf8'));
    assert.equal(index.games['sample-game'].channels.stable.latestReleaseId, releaseId);
    assert.equal(index.games['sample-game'].channels.stable.releases.length, 1);
    assert.match(index.games['sample-game'].channels.stable.releases[0].packages[0].url, /\/$/);

    const retry = await publishGameRelease(project, {
      releaseId,
      publishDirectory,
      metadata,
      updateLatest: true,
    });
    assert.equal(retry.record.releaseId, releaseId);
    assert.equal(JSON.parse(fs.readFileSync(first.indexPath, 'utf8')).games['sample-game'].channels.stable.releases.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release audit: publishing and promoting a platform preserves other platform pointers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-platform-publication-'));
  const project = path.join(root, 'sample');
  const publishDirectory = path.join(root, 'published');
  try {
    for (const [releaseId, platform, architecture, promote] of [
      ['web-one', 'web', 'web', true], ['windows-one', 'windows', 'x64', true],
      ['windows-two', 'windows', 'x64', false],
    ] as const) {
      const artifact = path.join(root, releaseId);
      write(artifact, 'index.html', '<!doctype html>');
      writeReport(project, releaseId, { ...directoryArtifact(artifact, 'directory'), platform, architecture });
      await publishGameRelease(project, { releaseId, publishDirectory, metadata, updateLatest: promote });
    }
    const channel = () => JSON.parse(fs.readFileSync(path.join(publishDirectory, 'releases.json'), 'utf8')).games['sample-game'].channels.stable;
    assert.deepEqual(channel().latestReleaseIds, { 'web/web': 'web-one', 'windows/x64': 'windows-one' });
    await publishGameRelease(project, { releaseId: 'windows-two', publishDirectory, metadata, updateLatest: true });
    assert.deepEqual(channel().latestReleaseIds, { 'web/web': 'web-one', 'windows/x64': 'windows-two' });
    await publishGameRelease(project, { releaseId: 'web-one', publishDirectory, metadata, updateLatest: true });
    assert.equal(channel().latestReleaseIds['windows/x64'], 'windows-two');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('release audit: rejects an old publication index without changing existing files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-old-publication-'));
  const project = path.join(root, 'sample');
  const artifact = path.join(root, 'artifact');
  const publishDirectory = path.join(root, 'published');
  try {
    write(artifact, 'index.html', '<!doctype html>');
    writeReport(project, 'release-new', directoryArtifact(artifact, 'directory'));
    write(publishDirectory, 'releases.json', JSON.stringify({ schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', games: {} }));
    write(publishDirectory, 'existing-content.txt', 'Existing publication');
    const before = collectDirectoryDigest(publishDirectory);
    await assert.rejects(
      publishGameRelease(project, { releaseId: 'release-new', publishDirectory, metadata, updateLatest: true }),
      /schemaVersion 2.*new directory/,
    );
    assert.deepEqual(collectDirectoryDigest(publishDirectory), before);
    assert.equal(fs.existsSync(path.join(publishDirectory, 'games')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publishes an unzipped delta artifact as a directory and rejects changed retry metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-delta-'));
  const project = path.join(root, 'projects', 'sample');
  const artifact = path.join(root, 'artifacts', 'sample-delta');
  const publishDirectory = path.join(root, 'public');
  try {
    write(artifact, '.rpg-agent/release-package.json', '{"schemaVersion":1}');
    write(artifact, 'data/Map001.json', '{}');
    const releaseId = 'release-delta';
    writeReport(project, releaseId, directoryArtifact(artifact, 'delta'));

    const result = await publishGameRelease(project, {
      releaseId,
      publishDirectory,
      metadata,
      updateLatest: false,
    });
    assert.equal(result.record.packages[0]?.packageType, 'file-delta');
    assert.equal(fs.existsSync(path.join(result.releaseDirectory, 'sample-delta', 'data', 'Map001.json')), true);

    await assert.rejects(
      publishGameRelease(project, {
        releaseId,
        publishDirectory,
        metadata: { ...metadata, summary: { 'zh-CN': '不同说明' } },
        updateLatest: false,
      }),
      /different metadata or build content/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes Windows game content without platform runtime or the external updater itself', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-windows-'));
  const project = path.join(root, 'projects', 'sample');
  const artifactPath = path.join(root, 'artifacts', 'sample-windows');
  const publishDirectory = path.join(root, 'public');
  try {
    write(artifactPath, 'Game.exe', 'runtime');
    write(artifactPath, 'locales/en-US.pak', 'runtime locale');
    write(artifactPath, '.rpg-agent/updater/updater.cjs', 'runtime updater');
    write(artifactPath, '.rpg-agent/current-release.json', '{"releaseId":"release-windows"}');
    write(artifactPath, 'data/Map001.json', '{}');
    const digest = collectDirectoryDigest(artifactPath);
    const artifact: GameBuildArtifact = {
      kind: 'directory',
      platform: 'windows',
      architecture: 'x64',
      path: artifactPath,
      bytes: digest.bytes,
      sha256: digest.sha256,
      packageType: 'full',
    };
    writeReport(project, 'release-windows', artifact);
    const result = await publishGameRelease(project, {
      releaseId: 'release-windows',
      publishDirectory,
      metadata,
      updateLatest: true,
    });
    const packageRecord = result.record.packages[0]!;
    assert.equal(packageRecord.targetFiles.some((file) => file.path === 'Game.exe'), false);
    assert.equal(packageRecord.packageFiles?.some((file) => file.path === 'Game.exe'), false);
    assert.equal(packageRecord.packageFiles?.some((file) => file.path === 'data/Map001.json'), true);
    const publishedArtifact = path.join(result.releaseDirectory, path.basename(artifactPath));
    assert.equal(fs.existsSync(path.join(publishedArtifact, 'Game.exe')), false);
    assert.equal(fs.existsSync(path.join(publishedArtifact, '.rpg-agent', 'updater')), false);
    assert.equal(fs.existsSync(path.join(publishedArtifact, '.rpg-agent', 'current-release.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes Android content and each signed ABI APK in the same release record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-android-'));
  const project = path.join(root, 'projects', 'sample');
  const content = path.join(root, 'artifacts', 'content');
  const apk = path.join(root, 'artifacts', 'sample-arm64-v8a.apk');
  const publishDirectory = path.join(root, 'public');
  try {
    write(content, '.rpg-agent/release-package.json', '{"schemaVersion":1}');
    write(content, 'data/Map001.json', '{}');
    write(root, 'artifacts/sample-arm64-v8a.apk', 'signed apk fixture');
    const contentDigest = collectDirectoryDigest(content);
    const artifacts: GameBuildArtifact[] = [
      {
        kind: 'directory', platform: 'android', architecture: 'universal', path: content,
        bytes: contentDigest.bytes, sha256: contentDigest.sha256, packageType: 'full', applicationId: 'org.example.game',
      },
      {
        kind: 'apk', platform: 'android', architecture: 'arm64-v8a', path: apk,
        bytes: fs.statSync(apk).size, sha256: sha256File(apk), packageType: 'full',
        versionName: '1.2.3', versionCode: 74, applicationId: 'org.example.game', certificateSha256: 'a'.repeat(64),
      },
    ];
    writeAndroidReport(project, 'release-android', artifacts, contentDigest.files);
    const result = await publishGameRelease(project, {
      releaseId: 'release-android', publishDirectory, metadata, updateLatest: true,
    });
    assert.deepEqual(result.record.packages.map((item) => item.delivery), ['content', 'apk']);
    const apkRecord = result.record.packages.find((item) => item.delivery === 'apk')!;
    assert.equal(apkRecord.applicationId, 'org.example.game');
    assert.equal(apkRecord.versionCode, 74);
    assert.equal(apkRecord.signingCertificateSha256, 'a'.repeat(64));
    assert.equal(fs.existsSync(path.join(result.releaseDirectory, 'content', 'data', 'Map001.json')), true);
    assert.equal(fs.existsSync(path.join(result.releaseDirectory, path.basename(apk))), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('signs one game manifest with the build identity and rejects later tampering', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-signed-'));
  const project = path.join(root, 'projects', 'sample');
  const artifact = path.join(root, 'artifacts', 'sample-web');
  const publishDirectory = path.join(root, 'public');
  const identity = createGameManifestSigningIdentity('manifest-signing-test');
  try {
    write(artifact, 'index.html', '<!doctype html>');
    writeReport(project, 'release-signed', directoryArtifact(artifact, 'directory'), identity);
    const result = await publishGameRelease(project, {
      releaseId: 'release-signed',
      publishDirectory,
      metadata,
      updateLatest: true,
      manifestSigningCredential: { privateKey: identity.privateKey },
    });
    const index = JSON.parse(fs.readFileSync(result.indexPath, 'utf8'));
    const config = {
      enabled: true as const,
      algorithm: identity.algorithm,
      keyId: identity.keyId,
      publicKey: identity.publicKey,
    };
    assert.equal(verifyGameReleaseManifestSignature('sample-game', index.games['sample-game'], config), true);
    index.games['sample-game'].channels.stable.latestReleaseIds['web/web'] = 'tampered';
    assert.equal(verifyGameReleaseManifestSignature('sample-game', index.games['sample-game'], config), false);
    index.games['sample-game'].channels.stable.latestReleaseIds['web/web'] = 'release-signed';
    index.games['sample-game'].channels.stable.latestReleaseId = 'tampered';
    assert.equal(verifyGameReleaseManifestSignature('sample-game', index.games['sample-game'], config), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function directoryArtifact(artifactPath: string, kind: 'directory' | 'delta'): GameBuildArtifact {
  const digest = collectDirectoryDigest(artifactPath);
  return {
    kind,
    platform: 'web',
    architecture: 'web',
    path: artifactPath,
    bytes: digest.bytes,
    sha256: digest.sha256,
    packageType: kind === 'delta' ? 'file-delta' : 'full',
  };
}

function writeReport(
  project: string,
  releaseId: string,
  artifact: GameBuildArtifact,
  signing?: ReturnType<typeof createGameManifestSigningIdentity>,
): void {
  const digest = collectDirectoryDigest(artifact.path);
  const report: GameBuildReport = {
    schemaVersion: 1,
    releaseId,
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    gameId: 'sample-game',
    gameName: 'Sample Game',
    version: '1.2.3',
    versionCore: ['1', '2', '3'],
    suffix: '',
    channel: 'stable',
    target: artifact.platform,
    architectures: [artifact.architecture],
    presetId: 'web-release',
    presetName: 'Web release',
    packageType: artifact.packageType,
    ...(artifact.packageType === 'full' ? {} : { baseReleaseId: 'release-base' }),
    gitCommit: null,
    processing: {
      images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none',
    },
    runtime: {
      platformRuntime: 'browser',
      manifestSignatureAlgorithm: signing?.algorithm || null,
      manifestSignatureKeyId: signing?.keyId || null,
      manifestSignaturePublicKey: signing?.publicKey || null,
    },
    artifacts: [artifact],
    files: digest.files,
    deletedFiles: [],
    warnings: [],
  };
  writeJsonAtomically(path.join(project, '.luna_rpg', 'release-history', `${releaseId}.json`), report);
}

function writeAndroidReport(
  project: string,
  releaseId: string,
  artifacts: GameBuildArtifact[],
  files: GameBuildReport['files'],
): void {
  const report: GameBuildReport = {
    schemaVersion: 1,
    releaseId,
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    gameId: 'sample-game',
    gameName: 'Sample Game',
    version: '1.2.3',
    versionCore: ['1', '2', '3'],
    suffix: '',
    channel: 'stable',
    target: 'android',
    architectures: ['arm64-v8a'],
    presetId: 'android-release',
    presetName: 'Android release',
    packageType: 'full',
    gitCommit: null,
    processing: {
      images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none',
    },
    runtime: { platformRuntime: 'managed-android-webview-shell', androidApplicationId: 'org.example.game' },
    artifacts,
    files,
    deletedFiles: [],
    warnings: [],
  };
  writeJsonAtomically(path.join(project, '.luna_rpg', 'release-history', `${releaseId}.json`), report);
}

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
