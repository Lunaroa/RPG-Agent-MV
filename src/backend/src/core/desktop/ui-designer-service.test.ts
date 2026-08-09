import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { UiDesignerDocument } from '../../../../contract/ui-designer.ts';
import {
  UI_DESIGNER_RECENT_LIMIT,
  UiDesignerFileConflictError,
  UiDesignerPersistenceError,
  UiDesignerUserDataStore,
  readUiDesignerFile,
  saveUiDesignerFile,
} from './ui-designer-service.ts';
import { validateUiDesignerDocument } from './ui-designer-validation.ts';

let tempRoot = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-'));
});

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('ui designer document service', () => {
  test('reads metadata and rejects invalid tree/code schemas', () => {
    const filePath = path.join(tempRoot, 'scene.mzui');
    const document = sampleDocument();
    saveUiDesignerFile(filePath, document);

    const result = readUiDesignerFile(filePath);
    assert.equal(result.document.meta.sceneName, 'Scene_Sample');
    assert.equal(result.metadata.digest, crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'));
    assert.ok(Number.isFinite(result.metadata.mtimeMs));

    const invalid = structuredClone(document) as Record<string, unknown>;
    (invalid.nodes as Array<Record<string, unknown>>)[0].children = ['missing'];
    (invalid.sceneScript as Record<string, unknown>).source = 'onReady(function () {';
    const report = validateUiDesignerDocument(invalid);
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((issue) => issue.code === 'missing-child'));
    assert.ok(report.errors.some((issue) => issue.code === 'invalid-code'));
  });

  test('migrates legacy ready and update bodies into the canonical scene script on read', () => {
    const filePath = path.join(tempRoot, 'legacy-scene.mzui');
    const legacy = structuredClone(sampleDocument()) as unknown as Record<string, unknown>;
    legacy.version = '1.0.0';
    legacy.editorVersion = '1.0.0';
    delete legacy.sceneScript;
    legacy.code = {
      ready: 'this.__legacyReady = arguments.length;',
      update: 'this.__legacyUpdate = true;',
    };
    fs.writeFileSync(filePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    const migrated = readUiDesignerFile(filePath).document;
    assert.equal(migrated.version, '1.1.0');
    assert.equal(migrated.editorVersion, '1.1.0');
    assert.match(migrated.sceneScript.source, /onReady\(function/);
    assert.match(migrated.sceneScript.source, /this\.__legacyReady = arguments\.length/);
    assert.match(migrated.sceneScript.source, /onUpdate\(function/);
    assert.equal('code' in migrated, false);

    saveUiDesignerFile(filePath, migrated, { force: true });
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    assert.equal('code' in persisted, false);
    assert.ok('sceneScript' in persisted);
  });

  test('uses expected digest/mtime conflict checks and explicit force', () => {
    const filePath = path.join(tempRoot, 'scene.mzui');
    const document = sampleDocument();
    const first = saveUiDesignerFile(filePath, document);
    const changed = structuredClone(document) as UiDesignerDocument;
    changed.meta.description = 'Changed';
    fs.writeFileSync(filePath, Buffer.from(`${JSON.stringify({ ...document, meta: { ...document.meta, description: 'External' } }, null, 2)}\n`, 'utf8'));

    assert.throws(
      () => saveUiDesignerFile(filePath, changed, { expected: first }),
      (error: unknown) => error instanceof UiDesignerFileConflictError && error.code === 'UI_DESIGNER_CONFLICT',
    );
    const forced = saveUiDesignerFile(filePath, changed, { expected: first, force: true });
    assert.notEqual(forced.digest, first.digest);
    assert.equal(readUiDesignerFile(filePath).document.meta.description, 'Changed');
  });

  test('keeps child nodes out of root-only zOrder and accepts contract actions without id', () => {
    const document = sampleDocument();
    const child = structuredClone(document.nodes[0]);
    child.id = 'node_child';
    child.name = 'Child';
    child.parentId = 'node_root';
    child.children = [];
    document.nodes[0].children = ['node_child'];
    document.nodes.push(child);
    document.nodes[0].events = { onClick: { actions: [{ type: 'showMessage', message: 'Hello' }] } };
    document.zOrder = ['node_child'];

    const report = validateUiDesignerDocument(document);
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((issue) => issue.code === 'invalid-z-order'));
    assert.ok(!report.errors.some((issue) => issue.path?.includes('actions[0]')));

    document.nodes[0].events = { onClick: { actions: [{ type: 'url', url: 'javascript:alert(1)' }] } };
    const unsafeUrlReport = validateUiDesignerDocument(document);
    assert.ok(unsafeUrlReport.errors.some((issue) => issue.code === 'invalid-value' && issue.path?.endsWith('.url')));
  });

  test('validates node-specific props and scene metadata with focused codes', () => {
    const invalidProps = sampleDocument();
    invalidProps.nodes[0].props = {
      ...invalidProps.nodes[0].props,
      backgroundFillMode: 'bad-mode',
    };
    const invalidPropsReport = validateUiDesignerDocument(invalidProps);
    assert.ok(invalidPropsReport.errors.some((issue) => issue.code === 'invalid-value' && issue.path?.endsWith('backgroundFillMode')));

    const invalidMeta = sampleDocument();
    invalidMeta.meta.sceneName = 'Not_A_Scene';
    invalidMeta.meta.sceneBase = 'not-a-base';
    const invalidMetaReport = validateUiDesignerDocument(invalidMeta);
    assert.ok(invalidMetaReport.errors.some((issue) => issue.code === 'scene-name-invalid'));
    assert.ok(invalidMetaReport.errors.some((issue) => issue.path === 'meta.sceneBase' && issue.code === 'invalid-value'));
  });

  test('accepts the canonical empty frame list as a warning', () => {
    const document = sampleDocument();
    const frame = structuredClone(document.nodes[0]);
    frame.id = 'node_frame_001';
    frame.type = 'frameAnimation';
    frame.name = 'FrameAnimation_001';
    frame.props = {
      ...frame.props,
      defaultFrameDuration: 100,
      loop: true,
      speed: 1,
      initialFrame: 0,
      frames: [],
      fillMode: 'contain',
    };
    document.nodes = [frame];
    document.zOrder = [frame.id];
    const report = validateUiDesignerDocument(document);
    assert.equal(report.valid, true);
    assert.ok(report.warnings.some((issue) => issue.code === 'empty-frame-list'));
  });
});

describe('ui designer user data store', () => {
  test('keeps only the most recent ten snapshots and restores a snapshot', () => {
    const projectFile = path.join(tempRoot, 'scene.mzui');
    saveUiDesignerFile(projectFile, sampleDocument());
    const store = new UiDesignerUserDataStore(path.join(tempRoot, 'user-data'));
    const ids: string[] = [];
    for (let index = 0; index < UI_DESIGNER_RECENT_LIMIT + 2; index += 1) {
      const record = store.captureSnapshot(projectFile);
      ids.push(record.id);
    }
    assert.equal(store.listRecentSnapshots().length, UI_DESIGNER_RECENT_LIMIT);
    assert.equal(store.listRecentSnapshots()[0]?.id, ids.at(-1));

    const target = path.join(tempRoot, 'restored.mzui');
    store.restoreSnapshot(ids.at(-1)!, target);
    assert.equal(readUiDesignerFile(target).document.meta.sceneName, 'Scene_Sample');

    const opened = store.recordRecentFile(projectFile, { opened: true, sceneName: 'Scene_Sample' });
    const saved = store.recordRecentFile(projectFile, { opened: false, saved: true });
    assert.equal(saved.sceneName, 'Scene_Sample');
    assert.equal(saved.lastOpenedAt, opened.lastOpenedAt);
    assert.notEqual(saved.lastSavedAt, undefined);
    const savedWithoutOpenedFlag = store.recordRecentFile(projectFile, { saved: true });
    assert.equal(savedWithoutOpenedFlag.lastOpenedAt, opened.lastOpenedAt);

    store.writePreferences({ selectedTemplate: 'sample' });
    assert.deepEqual(store.readPreferences(), { selectedTemplate: 'sample' });
  });

  test('writes in-memory recovery records and rejects recovery paths outside user data', () => {
    const storeRoot = path.join(tempRoot, 'user-data');
    const store = new UiDesignerUserDataStore(storeRoot);
    const recovery = store.writeRecovery(sampleDocument(), undefined, undefined, 'tab-1');
    assert.equal(store.readRecovery(recovery.id).record.key, 'tab-1');
    assert.equal(store.readRecovery(recovery.id).document.meta.sceneName, 'Scene_Sample');

    const metadataPath = path.join(storeRoot, 'ui-designer', 'recovery.json');
    const outside = path.join(tempRoot, 'outside.mzui');
    fs.writeFileSync(outside, `${JSON.stringify(sampleDocument())}\n`, 'utf8');
    const malicious = {
      id: 'outside', sourcePath: '', snapshotPath: outside, savedAt: new Date().toISOString(), digest: 'digest', mtimeMs: 1,
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify([malicious])}\n`, 'utf8');
    assert.throws(() => store.listRecentSnapshots(), (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'recovery-path');

    const snapshotsRoot = path.join(storeRoot, 'ui-designer', 'snapshots');
    fs.mkdirSync(snapshotsRoot, { recursive: true });
    const link = path.join(snapshotsRoot, 'linked.mzui');
    try {
      fs.symlinkSync(outside, link, 'file');
      fs.writeFileSync(metadataPath, `${JSON.stringify([{ ...malicious, snapshotPath: link }])}\n`, 'utf8');
      assert.throws(() => store.listRecentSnapshots(), (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'recovery-path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EPERM') throw error;
    }
  });
});

function sampleDocument(): UiDesignerDocument {
  return {
    version: '1.1.0',
    editorVersion: '1.1.0',
    meta: {
      sceneName: 'Scene_Sample',
      sceneBase: 'Scene_Base',
      canvasWidth: 816,
      canvasHeight: 624,
      author: '',
      description: '',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
    },
    transitions: {
      enter: { type: 'fade', duration: 300 },
      exit: { type: 'fade', duration: 300 },
    },
    globalFilter: { blur: 0, glow: 0, preset: '' },
    canvas: {
      width: 816,
      height: 624,
      backgroundColor: '#1a1b26',
      backgroundPattern: 'solid',
      grid: { enabled: true, size: 32, color: '#414868' },
      snap: { enabled: true, smartEnabled: true, sensitivity: 5 },
      rulers: true,
      guidesVisible: true,
      mapBackground: { mapId: 0, blur: 0, switchId: 0 },
    },
    guides: [],
    nodes: [{
      id: 'node_root',
      type: 'container',
      name: 'root',
      parentId: null,
      children: [],
      props: {
        x: 0,
        y: 0,
        width: 816,
        height: 624,
        scaleX: 1,
        scaleY: 1,
        rotate: 0,
        opacity: 255,
        visible: true,
        anchorX: 0,
        anchorY: 0,
        zIndex: 0,
        backgroundPath: '',
        backgroundFillMode: 'stretch',
        backgroundRepeatMode: 'none',
        clip: false,
      },
      propModes: {},
      propCodes: {},
      condition: { type: 'none' },
      enterAnim: { type: 'none', duration: 0, easing: 'Linear' },
      exitAnim: { type: 'none', duration: 0, easing: 'Linear' },
      events: {},
    }],
    zOrder: ['node_root'],
    sceneScript: { version: '1.0.0', source: '' },
  };
}
