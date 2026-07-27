import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import {
  buildPluginTranslationPrompt,
  buildPluginTranslationSource,
  computePluginTranslationSourceHash,
  getPluginTranslation,
  parsePluginTranslationResponse,
  storePluginTranslation,
} from './plugin-translation-service.ts';

interface Fixture {
  root: string;
  project: string;
}

describe('plugin translation service', { concurrency: false }, () => {
  let fixture: Fixture;

  before(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
  });

  after(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('builds the translation source from plugindesc, help and parameter texts', () => {
    const source = buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix');
    assert.equal(source.plugindesc, 'Core fixes.');
    assert.match(source.help, /Adjust the speed parameter/);
    assert.deepEqual(Object.keys(source.params), ['speed', 'mode']);
    assert.equal(source.params.speed.label, 'Speed');
    assert.equal(source.params.speed.description, 'Movement speed multiplier.');
    assert.throws(
      () => buildPluginTranslationSource(fixture.root, fixture.project, 'Missing'),
      /Plugin not found: Missing/,
    );
  });

  test('source hash is stable for identical sources and changes with the header', () => {
    const first = computePluginTranslationSourceHash(
      buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix'),
    );
    const second = computePluginTranslationSourceHash(
      buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix'),
    );
    assert.equal(first, second);
    const other = computePluginTranslationSourceHash({
      plugindesc: 'Changed.', help: '', params: {},
    });
    assert.notEqual(first, other);
  });

  test('prompt embeds the target language and the source JSON', () => {
    const source = buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix');
    const prompt = buildPluginTranslationPrompt(source, 'zh-CN');
    assert.match(prompt, /"zh-CN"/);
    assert.match(prompt, /Movement speed multiplier\./);
    assert.match(prompt, /no code fences/);
  });

  test('parses a fenced JSON response and validates the shape strictly', () => {
    const source = buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix');
    const payload = parsePluginTranslationResponse([
      '```json',
      JSON.stringify({
        plugindesc: '核心修正。',
        help: '调整 speed 参数。',
        params: {
          speed: { label: '速度', description: '移动速度倍率。' },
          mode: { label: '模式', description: '' },
        },
      }),
      '```',
    ].join('\n'), source);
    assert.equal(payload.plugindesc, '核心修正。');
    assert.equal(payload.params.speed.label, '速度');

    assert.throws(() => parsePluginTranslationResponse('not json', source), /did not return valid JSON/);
    assert.throws(() => parsePluginTranslationResponse('', source), /empty response/);
    assert.throws(
      () => parsePluginTranslationResponse(JSON.stringify({ plugindesc: 'x', help: 'y', params: { speed: { label: '速度', description: '' } } }), source),
      /missing or malformed for parameters: mode/,
    );
    assert.throws(
      () => parsePluginTranslationResponse(JSON.stringify({ help: 'y', params: { speed: { label: 'a', description: '' }, mode: { label: 'b', description: '' } } }), source),
      /missing the "plugindesc" or "help" field/,
    );
  });

  test('stores and reads back a translation record with stale detection', () => {
    const source = buildPluginTranslationSource(fixture.root, fixture.project, 'CoreFix');
    const hash = computePluginTranslationSourceHash(source);
    const stored = storePluginTranslation(fixture.project, 'CoreFix', 'zh-CN', hash, {
      plugindesc: '核心修正。',
      help: '帮助译文。',
      params: {
        speed: { label: '速度', description: '移动速度倍率。' },
        mode: { label: '模式', description: '' },
      },
    });
    assert.equal(stored.stale, false);

    const read = getPluginTranslation(fixture.root, fixture.project, 'CoreFix', 'zh-CN');
    assert.ok(read);
    assert.equal(read.payload.plugindesc, '核心修正。');
    assert.equal(read.stale, false);
    assert.equal(getPluginTranslation(fixture.root, fixture.project, 'CoreFix', 'en-US'), null);

    // Header change flips the stale flag without touching the stored payload.
    const pluginPath = path.join(fixture.project, 'www', 'js', 'plugins', 'CoreFix.js');
    fs.writeFileSync(pluginPath, fs.readFileSync(pluginPath, 'utf8').replace('Core fixes.', 'Core fixes v2.'), 'utf8');
    const afterChange = getPluginTranslation(fixture.root, fixture.project, 'CoreFix', 'zh-CN');
    assert.ok(afterChange);
    assert.equal(afterChange.stale, true);
    assert.equal(afterChange.payload.plugindesc, '核心修正。');
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-plugin-translation-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'System.json'), { gameTitle: 'Translation Test', switches: [null], variables: [null] });
  writeJson(path.join(dataDir, 'Map001.json'), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  fs.mkdirSync(path.join(project, 'www', 'js', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'CoreFix.js'), `/*:
 * @plugindesc Core fixes.
 * @param speed
 * @text Speed
 * @desc Movement speed multiplier.
 * @type number
 * @default 1
 *
 * @param mode
 * @type select
 * @option Safe
 * @value safe
 * @default safe
 *
 * @help
 * Adjust the speed parameter to tune movement.
 */
`, 'utf8');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), `// Generated by RPG Maker.
var $plugins =
[
{"name":"CoreFix","status":true,"description":"Core patch","parameters":{"speed":"1"}}
];
`, 'utf8');
  return { root, project };
}
