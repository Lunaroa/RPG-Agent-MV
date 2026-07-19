import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { resolveAssetRequest } from './asset-service.ts';
import { buildMapIndex, buildMapPayload, updateMapPropertiesDraft } from './map-service.ts';
import { mapProjectParallaxImageMissing } from './mapServiceLocalization.ts';
import { applyProjectStaging, getMapFileForRead } from './staging-service.ts';

describe('map parallax preview payload', { concurrency: false }, () => {
  let root: string;
  let project: string;
  let mapFile: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-map-parallax-'));
    project = path.join(root, 'projects', 'sample');
    const dataDir = path.join(project, 'www', 'data');
    mapFile = path.join(dataDir, 'Map001.json');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Sample Map', parentId: 0, order: 1, expanded: true }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeMap({ parallaxName: 'Clouds', parallaxShow: true });
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('returns a safe project URL when editor preview is enabled', () => {
    const imageFile = path.join(project, 'www', 'img', 'parallaxes', 'Clouds.png');
    fs.mkdirSync(path.dirname(imageFile), { recursive: true });
    fs.writeFileSync(imageFile, Buffer.from('png'));

    const payload = buildMapPayload(root, project, 1);

    assert.match(payload.parallaxImageUrl!, /^rmmv-asset:\/\/project\//);
    assert.equal(resolveAssetRequest(root, payload.parallaxImageUrl!), imageFile);
  });

  test('returns a non-blocking warning and preserves the configured name when the preview image is missing', () => {
    const payload = withTestLanguage(() => buildMapPayload(root, project, 1));
    assert.equal(payload.parallaxImageUrl, null);
    assert.equal(payload.map.parallaxName, 'Clouds');
    assert.match(payload.resourceWarnings[0], /Clouds\.png/);
    assert.match(mapProjectParallaxImageMissing('Clouds', 'zh-CN'), /img\/parallaxes/);
    assert.match(mapProjectParallaxImageMissing('Clouds', 'en-US'), /Show in editor/);
  });

  test('does not require the image when editor preview is disabled', () => {
    writeMap({ parallaxName: 'Clouds', parallaxShow: false });

    assert.equal(buildMapPayload(root, project, 1).parallaxImageUrl, null);
    assert.deepEqual(buildMapPayload(root, project, 1).resourceWarnings, []);
  });

  test('includes the tileset mode required by the live automatic-layer preview', () => {
    writeJson(path.join(project, 'www', 'data', 'Tilesets.json'), [
      null,
      { id: 1, name: 'Outdoor', mode: 0, tilesetNames: [], flags: [] },
    ]);
    writeMap({ tilesetId: 1, parallaxName: '', parallaxShow: false });

    assert.equal(buildMapPayload(root, project, 1).tileset?.mode, 0);
  });

  test('keeps missing maps in the tree with an explicit availability flag', () => {
    writeJson(path.join(project, 'www', 'data', 'MapInfos.json'), [
      null,
      { id: 1, name: 'Available Map', parentId: 0, order: 1 },
      { id: 2, name: 'Missing Map', parentId: 0, order: 2 },
    ]);

    const index = buildMapIndex(root, project);

    assert.deepEqual(index.maps.map((map) => [map.id, map.mapFileExists]), [[1, true], [2, false]]);
  });

  test('preserves multiline notes and complete encounter regions through staging and apply', () => {
    writeMap({ parallaxName: '', parallaxShow: false });
    const note = 'First line\nSecond line\nThird line';
    const encounterList = [{ troopId: 2, weight: 7, regionSet: [1, 2, 3, 4] }];

    updateMapPropertiesDraft(root, project, 1, { name: 'Sample Map', note, encounterList });
    const stagedMap = readJson(getMapFileForRead(root, project, 1)) as any;
    assert.equal(stagedMap.note, note);
    assert.deepEqual(stagedMap.encounterList, encounterList);

    assert.equal(applyProjectStaging(root, project).applied, true);
    const appliedMap = readJson(mapFile) as any;
    assert.equal(appliedMap.note, note);
    assert.deepEqual(appliedMap.encounterList, encounterList);
  });

  function writeMap(overrides: Record<string, unknown>): void {
    writeJson(mapFile, {
      width: 2,
      height: 2,
      tilesetId: 0,
      data: Array(24).fill(0),
      events: [null],
      encounterList: [],
      note: '',
      ...overrides,
    });
  }
});
