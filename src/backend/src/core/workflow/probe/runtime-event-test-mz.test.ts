import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { RPG_MAKER_MZ_ENGINE_FILES } from '../../rmmv/rpg-maker-engine.ts';
import { writeJson } from '../../rmmv/json.ts';
import { buildRuntimeEventTest } from './runtime-event-test.ts';
import { copyProjectForProbe, renderRuntimeProbeScript } from './nwjs-runtime-event-probe.ts';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('MZ runtime event probe context', () => {
  test('accepts an MZ plan and resolves character assets from the MZ source root', () => {
    const root = temporaryDirectory();
    const project = path.join(root, 'sample-mz-project');
    writeMZProject(project);
    const report = buildRuntimeEventTest(project, {
      engine: 'rpg-maker-mz',
      tests: [{
        id: 'visible_character',
        name: 'Visible character',
        steps: [{ type: 'assert-player-visible', value: true, characterName: 'SampleCharacter' }],
      }],
    });

    assert.equal(report.engine, 'rpg-maker-mz');
    assert.equal(report.status, 'static-pass');
    assert.equal(report.staticReview.summary.blockingFindings, 0);
    assert.throws(() => buildRuntimeEventTest(project, {
      engine: 'rpg-maker-mv',
      tests: [{ id: 'wrong_engine', steps: [{ type: 'wait', frames: 1 }] }],
    }), /does not match project engine/);
  });

  test('wraps normalized tests for the runtime and copies MZ projects without runtime or saves', () => {
    const root = temporaryDirectory();
    const source = path.join(root, 'source');
    const target = path.join(root, 'isolated');
    writeMZProject(source);
    fs.writeFileSync(path.join(source, 'Game.exe'), 'runtime', 'utf8');
    fs.writeFileSync(path.join(source, 'nw.dll'), 'runtime', 'utf8');
    fs.mkdirSync(path.join(source, 'locales'), { recursive: true });
    fs.writeFileSync(path.join(source, 'locales', 'en-US.pak'), 'runtime', 'utf8');
    fs.mkdirSync(path.join(source, 'save'), { recursive: true });
    fs.writeFileSync(path.join(source, 'save', 'file1.rmmzsave'), 'save', 'utf8');

    copyProjectForProbe(source, target, 'rpg-maker-mz');
    assert.equal(fs.existsSync(path.join(target, 'Game.exe')), false);
    assert.equal(fs.existsSync(path.join(target, 'nw.dll')), false);
    assert.equal(fs.existsSync(path.join(target, 'locales')), false);
    assert.equal(fs.existsSync(path.join(target, 'save')), false);
    assert.equal(fs.existsSync(path.join(target, 'data', 'System.json')), true);
    assert.equal(fs.existsSync(path.join(source, 'save', 'file1.rmmzsave')), true);

    const script = renderRuntimeProbeScript('result.json', [{ id: 'sample', steps: [] }], 1000, 'rpg-maker-mz');
    assert.match(script, /"engine":"rpg-maker-mz","tests":\[\{"id":"sample"/);
    assert.match(script, /plan\.tests/);
    assert.doesNotMatch(script, /RPG Maker MV runtime/);
  });
});

function temporaryDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-probe-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeMZProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === 'package.json' ? '{"main":"index.html"}' : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  for (const directory of ['audio', 'fonts', 'img/characters', 'movies', 'effects', 'js/plugins', 'data']) {
    fs.mkdirSync(path.join(project, ...directory.split('/')), { recursive: true });
  }
  fs.writeFileSync(path.join(project, 'img', 'characters', 'SampleCharacter.png'), '', 'utf8');
  writeJson(path.join(project, 'data', 'System.json'), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
    switches: [null],
    variables: [null],
  });
  writeJson(path.join(project, 'data', 'MapInfos.json'), [null]);
}
