import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import {
  buildProjectAssetCategoryTree,
  invalidateProjectAssetBrowserCache,
  listProjectAssetCategory,
  type ProjectAssetDirectoryScanner,
} from './project-asset-browser-service.ts';
import { writeStagedProjectBuffer, stageProjectFilesAtomically } from './staging-service.ts';

afterEach(() => {
  invalidateProjectAssetBrowserCache();
});

describe('project asset browser service', () => {
  test('category tree excludes plugins, omits missing directories, and sums parent counts', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'demo_mod');
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeMzProjectSkeleton(project);
      fs.mkdirSync(path.join(project, 'audio', 'bgm'), { recursive: true });
      fs.mkdirSync(path.join(project, 'img', 'pictures'), { recursive: true });
      fs.mkdirSync(path.join(project, 'fonts'), { recursive: true });
      fs.writeFileSync(path.join(project, 'audio', 'bgm', 'Theme.ogg'), 'ogg');
      fs.writeFileSync(path.join(project, 'img', 'pictures', 'A.png'), 'png');
      fs.writeFileSync(path.join(project, 'img', 'pictures', 'B.png'), 'png');
      fs.writeFileSync(path.join(project, 'fonts', 'GameFont.ttf'), 'font');
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(project, 'js', 'plugins', 'Demo.js'), 'js');

      const tree = buildProjectAssetCategoryTree(root, project);
      const ids = collectIds(tree.nodes);
      assert.equal(ids.includes('plugins'), false);
      assert.equal(ids.includes('effects'), false);
      assert.equal(ids.includes('movies'), false);

      const audio = tree.nodes.find((node) => node.id === 'audio');
      assert.ok(audio);
      assert.equal(audio!.directory, 'audio');
      assert.ok(audio!.children?.some((child) => child.id === 'bgm' && child.directory === 'audio/bgm'));
      assert.equal(audio!.entryCount, audio!.children!.reduce((sum, child) => sum + child.entryCount, 0));

      const images = tree.nodes.find((node) => node.id === 'img');
      assert.ok(images);
      assert.equal(images!.directory, 'img');
      const pictures = images!.children!.find((child) => child.id === 'pictures');
      assert.equal(pictures?.entryCount, 2);
      assert.equal(images!.entryCount, images!.children!.reduce((sum, child) => sum + child.entryCount, 0));

      const fonts = tree.nodes.find((node) => node.id === 'fonts');
      assert.ok(fonts);
      assert.equal(fonts!.directory, 'fonts');
      assert.equal(fonts!.entryCount, 1);
      assert.equal(fonts!.children, undefined);
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('produces www-prefixed relative directories for MV layout', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'sample');
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeMvProjectSkeleton(project);
      fs.mkdirSync(path.join(project, 'www', 'audio', 'se'), { recursive: true });
      fs.mkdirSync(path.join(project, 'www', 'img', 'characters'), { recursive: true });
      fs.writeFileSync(path.join(project, 'www', 'audio', 'se', 'Click.ogg'), 'ogg');
      fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Actor.png'), 'png');

      const tree = buildProjectAssetCategoryTree(root, project);
      const audio = tree.nodes.find((node) => node.id === 'audio');
      assert.equal(audio?.directory, 'www/audio');
      assert.ok(audio?.children?.some((child) => child.directory === 'www/audio/se'));
      const images = tree.nodes.find((node) => node.id === 'img');
      assert.equal(images?.directory, 'www/img');
      assert.ok(images?.children?.some((child) => child.directory === 'www/img/characters'));
      assert.equal(tree.nodes.some((node) => node.id === 'effects'), false);
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('listing cache skips directory rescan on revision match and invalidates explicitly', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'demo_mod');
    let scans = 0;
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeMzProjectSkeleton(project);
      const picturesDir = path.join(project, 'img', 'pictures');
      fs.mkdirSync(picturesDir, { recursive: true });
      fs.writeFileSync(path.join(picturesDir, 'Portrait.png'), 'png');

      const readDirectoryEntries: ProjectAssetDirectoryScanner = (absoluteDirectory) => {
        scans += 1;
        return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const absolute = path.join(absoluteDirectory, entry.name);
            const stat = fs.statSync(absolute);
            return { fileName: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs };
          });
      };

      const first = listProjectAssetCategory(root, project, 'pictures', undefined, { readDirectoryEntries });
      assert.equal(first.entries.length, 1);
      assert.equal(scans, 1);

      const second = listProjectAssetCategory(root, project, 'pictures', undefined, { readDirectoryEntries });
      assert.equal(second.entries.length, 1);
      assert.equal(scans, 1);

      invalidateProjectAssetBrowserCache(project);
      const third = listProjectAssetCategory(root, project, 'pictures', undefined, { readDirectoryEntries });
      assert.equal(third.entries.length, 1);
      assert.equal(scans, 2);
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('listing is staging-aware for additions and deletions', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'sample');
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeMzProjectSkeleton(project);
      const picturesDir = path.join(project, 'img', 'pictures');
      fs.mkdirSync(picturesDir, { recursive: true });
      fs.writeFileSync(path.join(picturesDir, 'Keep.png'), 'keep');
      fs.writeFileSync(path.join(picturesDir, 'Gone.png'), 'gone');

      writeStagedProjectBuffer(root, project, 'img/pictures/Staged.png', Buffer.from('staged'));
      stageProjectFilesAtomically(root, project, [
        { relativePath: 'img/pictures/Gone.png', delete: true },
      ]);

      const listing = listProjectAssetCategory(root, project, 'pictures');
      const names = listing.entries.map((entry) => entry.name).sort();
      assert.deepEqual(names, ['Keep', 'Staged']);
      assert.equal(listing.entries.find((entry) => entry.name === 'Staged')?.variants[0]?.fileName, 'Staged.png');
      assert.ok(listing.entries.find((entry) => entry.name === 'Keep')?.url.includes('rmmv-asset://project/'));
      assert.ok(listing.entries.find((entry) => entry.name === 'Keep')?.thumbnailUrl?.includes('rmmv-asset://project-thumbnail/'));
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('browse listing accepts an explicit thumbnail size bucket and rejects unsupported values', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'demo_mod');
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeMzProjectSkeleton(project);
      fs.mkdirSync(path.join(project, 'img', 'pictures'), { recursive: true });
      fs.writeFileSync(path.join(project, 'img', 'pictures', 'Portrait.png'), 'png');

      const listing = listProjectAssetCategory(root, project, 'pictures', 256);
      assert.match(listing.entries[0]!.thumbnailUrl!, /\/256\//);
      assert.throws(
        () => listProjectAssetCategory(root, project, 'pictures', 96),
        /Unsupported project asset thumbnail size bucket/,
      );
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function collectIds(nodes: Array<{ id: string; children?: Array<{ id: string }> }>): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children) ids.push(...node.children.map((child) => child.id));
  }
  return ids;
}

function writeMzProjectSkeleton(project: string): void {
  const dataDir = path.join(project, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.rmmzproject'), 'RPGMZ 1.9.0');
  writeJson(path.join(dataDir, 'System.json'), { gameTitle: 'Demo' });
  writeJson(path.join(dataDir, 'MapInfos.json'), [null]);
}

function writeMvProjectSkeleton(project: string): void {
  const dataDir = path.join(project, 'www', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV 1.6.3');
  writeJson(path.join(dataDir, 'System.json'), { gameTitle: 'Sample' });
  writeJson(path.join(dataDir, 'MapInfos.json'), [null]);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-asset-browser-'));
}
