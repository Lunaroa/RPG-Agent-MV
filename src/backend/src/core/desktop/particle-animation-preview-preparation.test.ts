import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';
import {
  cleanupIsolatedProject,
  verifyIsolatedSourceState,
} from './isolated-project-preparation.ts';
import {
  prepareParticleAnimationPreview,
  validatePreviewAnimation,
  type ParticleAnimationPreviewPreparation,
} from './particle-animation-preview-preparation.ts';

describe('isolated MZ particle animation preview preparation', { concurrency: false }, () => {
  let root: string;
  let project: string;
  let preparation: ParticleAnimationPreviewPreparation | null;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-particle-preview-test-'));
    project = path.join(root, 'projects', 'sample');
    preparation = null;
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
    writeMZProject(project);
  });

  afterEach(() => {
    if (preparation && fs.existsSync(preparation.temporaryProject)) cleanupIsolatedProject(preparation);
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('builds a neutral temporary app with only core scripts and selected resources', () => {
    const sourceEffect = fs.readFileSync(path.join(project, 'effects', 'fx', 'Spark.efkefc'));
    preparation = prepareParticleAnimationPreview(root, project, animation());

    assert.equal(preparation.engine, 'rpg-maker-mz');
    assert.equal(preparation.temporaryProject.startsWith(os.tmpdir()), true);
    assert.equal(preparation.appDirectory.startsWith(preparation.temporaryProject), true);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'effects', 'fx', 'Spark.efkefc')), true);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'audio', 'se', 'ui', 'Confirm.ogg')), true);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'effects', 'fx', 'Unused.efkefc')), false);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'audio', 'se', 'Unused.ogg')), false);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'js', 'libs', 'vorbisdecoder.js')), true);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'js', 'libs', 'vorbisdecoder.wasm')), false);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'js', 'plugins.js')), false);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'data')), false);

    const main = fs.readFileSync(path.join(preparation.appDirectory, 'js', 'main.js'), 'utf8');
    const preview = fs.readFileSync(path.join(preparation.appDirectory, 'js', 'particle-preview.js'), 'utf8');
    const html = fs.readFileSync(path.join(preparation.appDirectory, 'index.html'), 'utf8');
    assert.doesNotMatch(main, /PluginManager\.setup/);
    assert.match(main, /effekseer\.initRuntime/);
    assert.match(main, /vorbisdecoder\.js/);
    assert.match(preview, /Sprite_Animation/);
    assert.match(html, /"effectName":"fx\/Spark"/);
    assert.doesNotMatch(html, /UnusedPlugin/);

    assert.deepEqual(verifyIsolatedSourceState(root, preparation), {
      sourceUnchanged: true,
      savesUnchanged: true,
      stagingUnchanged: true,
    });
    assert.deepEqual(fs.readFileSync(path.join(project, 'effects', 'fx', 'Spark.efkefc')), sourceEffect);
  });

  test('rejects unsafe resources and malformed MZ timing structures before preparation', () => {
    assert.throws(
      () => validatePreviewAnimation({ ...animation(), effectName: '../outside' }, 816, 624),
      /safe project-relative resource name/,
    );
    assert.throws(
      () => validatePreviewAnimation({
        ...animation(),
        flashTimings: [{ frame: 0, duration: 30, color: [255, 255, 255] }],
      }, 816, 624),
      /exactly four channels/,
    );
    assert.throws(
      () => validatePreviewAnimation({ ...animation(), offsetX: 817 }, 816, 624),
      /offsetX must be an integer from -816 to 816/,
    );
  });

  test('omits the audio decoder and sound assets when the selected preview has no sound timing', () => {
    preparation = prepareParticleAnimationPreview(root, project, {
      ...animation(),
      soundTimings: [],
    });

    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'js', 'libs', 'vorbisdecoder.js')), false);
    assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'audio')), false);
    const main = fs.readFileSync(path.join(preparation.appDirectory, 'js', 'main.js'), 'utf8');
    assert.doesNotMatch(main, /vorbisdecoder\.js/);
  });
});

function animation(): InteractiveParticleAnimationPreview {
  return {
    displayType: 0,
    effectName: 'fx/Spark',
    scale: 100,
    speed: 100,
    offsetX: 0,
    offsetY: 0,
    rotation: { x: 0, y: 0, z: 0 },
    alignBottom: false,
    flashTimings: [{ frame: 2, duration: 30, color: [255, 200, 160, 128] }],
    soundTimings: [{
      frame: 1,
      se: { name: 'ui/Confirm', volume: 90, pitch: 100, pan: 0 },
    }],
  };
}

function writeMZProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : relative === 'js/plugins.js'
          ? 'var $plugins = [{"name":"UnusedPlugin","status":true,"parameters":{}}];'
          : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  for (const relative of [
    'js/libs/pixi.js',
    'js/libs/pako.min.js',
    'js/libs/localforage.min.js',
    'js/libs/effekseer.min.js',
    'js/libs/effekseer.wasm',
    'js/libs/vorbisdecoder.js',
  ]) {
    const file = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'runtime fixture', 'utf8');
  }
  for (const directory of ['audio/se/ui', 'effects/fx', 'fonts', 'img', 'movies', 'js/plugins']) {
    fs.mkdirSync(path.join(project, ...directory.split('/')), { recursive: true });
  }
  fs.writeFileSync(path.join(project, 'effects', 'fx', 'Spark.efkefc'), 'selected effect', 'utf8');
  fs.writeFileSync(path.join(project, 'effects', 'fx', 'Unused.efkefc'), 'unused effect', 'utf8');
  fs.writeFileSync(path.join(project, 'audio', 'se', 'ui', 'Confirm.ogg'), 'selected sound', 'utf8');
  fs.writeFileSync(path.join(project, 'audio', 'se', 'Unused.ogg'), 'unused sound', 'utf8');
  writeJson(path.join(project, 'data', 'System.json'), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
    startMapId: 1,
  });
  writeJson(path.join(project, 'data', 'MapInfos.json'), [null, { id: 1, name: 'Sample Map' }]);
  writeJson(path.join(project, 'data', 'Map001.json'), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null],
  });
}
