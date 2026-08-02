import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';
import {
  deleteProjectAssetSubfolder,
  renameProjectAssetSubfolder,
} from './asset-management-service.ts';
import { buildProjectAssetCategoryTree, listProjectAssetCategory } from './project-asset-browser-service.ts';

describe('project asset picture subfolder mutations', { concurrency: false }, () => {
  let root: string;
  let project: string;
  const trashed: string[] = [];

  beforeEach(async () => {
    trashed.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-subfolder-'));
    project = path.join(root, 'projects', 'demo_mod');
    writeMzProject(project);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('renameProjectAssetSubfolder rewrites nested picture names and directory', () => {
    const result = renameProjectAssetSubfolder(root, project, 'pictures/ui', 'hud');
    assert.equal(result.nextNodeId, 'pictures/hud');
    assert.equal(result.directory, 'img/pictures/hud');
    assert.equal(fs.existsSync(path.join(project, 'img', 'pictures', 'hud', 'Portrait.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'img', 'pictures', 'ui')), false);

    const listing = listProjectAssetCategory(root, project, 'pictures/hud');
    assert.equal(listing.entries[0]?.name, 'hud/Portrait');

    const tree = buildProjectAssetCategoryTree(root, project);
    const pictures = tree.nodes.find((node) => node.id === 'img')?.children?.find((child) => child.id === 'pictures');
    assert.ok(pictures?.children?.some((child) => child.id === 'pictures/hud'));
  });

  test('deleteProjectAssetSubfolder trashes the directory after nested assets', async () => {
    const batch = await deleteProjectAssetSubfolder(
      root,
      project,
      'pictures/ui',
      { force: true },
      {
        trashItem: async (absolutePath) => {
          trashed.push(absolutePath);
          fs.rmSync(absolutePath, { recursive: true, force: true });
        },
      },
    );
    assert.equal(batch.results.every((item) => item.status === 'deleted'), true);
    assert.equal(fs.existsSync(path.join(project, 'img', 'pictures', 'ui')), false);
    assert.ok(trashed.some((entry) => entry.replace(/\\/g, '/').endsWith('img/pictures/ui')));
  });
});

function writeMzProject(projectPath: string): void {
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(projectPath, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  fs.mkdirSync(path.join(projectPath, 'img', 'pictures', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'img', 'pictures', 'ui', 'Portrait.png'), 'png', 'utf8');
  writeJson(path.join(projectPath, 'data', 'System.json'), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
  });
  writeJson(path.join(projectPath, 'data', 'MapInfos.json'), [null]);
}
