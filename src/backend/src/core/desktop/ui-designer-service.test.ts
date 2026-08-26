import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { UiDesignerDocument, UiListNode } from '../../../../contract/ui-designer.ts';
import { migrateLegacyUiSourceCode } from '../../../../contract/ui-designer-script.ts';
import {
  UI_DESIGNER_RECENT_LIMIT,
  UiDesignerFileConflictError,
  UiDesignerPersistenceError,
  UiDesignerUserDataStore,
  listUiDesignerSceneFiles,
  projectUiDesignerScenePath,
  readUiDesignerFile,
  saveUiDesignerFile,
  writeProjectUiDesignerThumbnail,
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
    const legacyCode = {
      ready: 'const text = "onUpdate(function () is data";\r\nthis.__legacyReady = arguments.length;',
      update: 'const text = "onReady(function () is data";\nthis.__legacyUpdate = true;',
    };
    legacy.code = legacyCode;
    fs.writeFileSync(filePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    const migrated = readUiDesignerFile(filePath).document;
    assert.equal(migrated.version, '1.1.0');
    assert.equal(migrated.editorVersion, '1.1.0');
    assert.equal(migrated.sceneScript.source, migrateLegacyUiSourceCode(legacyCode));
    assert.match(migrated.sceneScript.source, /onReady\(function/);
    assert.match(migrated.sceneScript.source, /this\.__legacyReady = arguments\.length/);
    assert.match(migrated.sceneScript.source, /onUpdate\(function/);
    assert.equal('code' in migrated, false);

    saveUiDesignerFile(filePath, migrated, { force: true });
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    assert.equal('code' in persisted, false);
    assert.ok('sceneScript' in persisted);
    assert.equal(readUiDesignerFile(filePath).document.sceneScript.source, migrated.sceneScript.source);
  });

  test('normalizes document geometry and pane preferences to shared integers on read and save', () => {
    const filePath = path.join(tempRoot, 'decimal-scene.mzui');
    const document = sampleDocument();
    document.canvas.width = 816.6;
    document.canvas.height = 623.5;
    document.meta.canvasWidth = 816.6;
    document.meta.canvasHeight = 623.5;
    document.nodes[0].props.width = 816.6;
    document.nodes[0].props.height = 623.5;
    document.nodes[0].props.x = 10.6;
    saveUiDesignerFile(filePath, document);
    const read = readUiDesignerFile(filePath).document;
    assert.deepEqual([read.canvas.width, read.canvas.height, read.nodes[0].props.x], [817, 624, 11]);
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as UiDesignerDocument;
    assert.deepEqual([persisted.meta.canvasWidth, persisted.nodes[0].props.width], [817, 817]);

    const store = new UiDesignerUserDataStore(path.join(tempRoot, 'integer-preferences'));
    store.writePreferences({ leftPaneWidth: 260.6, centerPaneWidth: 639.5, rightPaneWidth: 900 });
    assert.deepEqual(store.readPreferences(), { leftPaneWidth: 261, centerPaneWidth: 640, rightPaneWidth: 550 });
  });

  test('keeps working documents in runtime and never reuses an external source path', () => {
    const userDataRoot = path.join(tempRoot, 'user-data');
    const store = new UiDesignerUserDataStore(userDataRoot);
    const document = sampleDocument();
    const externalPath = path.join(tempRoot, 'external.mzui');

    const imported = store.saveWorkingDocument(document, { path: externalPath });
    assert.equal(path.dirname(imported.path), path.join(userDataRoot, 'runtime', 'ui-designer', 'documents'));
    assert.equal(store.isWorkingDocumentPath(imported.path), true);
    assert.equal(fs.existsSync(externalPath), false);

    document.meta.description = 'Saved in runtime';
    const saved = store.saveWorkingDocument(document, { path: imported.path, expected: imported });
    assert.equal(saved.path, imported.path);
    assert.equal(readUiDesignerFile(imported.path).document.meta.description, 'Saved in runtime');

    const duplicate = store.saveWorkingDocument(document, { path: imported.path, duplicate: true });
    assert.notEqual(duplicate.path, imported.path);
    assert.equal(store.isWorkingDocumentPath(duplicate.path), true);
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

    const listDocument = sampleDocument();
    const list = structuredClone(listDocument.nodes[0]) as unknown as UiListNode;
    list.id = 'node_list';
    list.name = 'List';
    list.type = 'list';
    list.parentId = 'node_root';
    list.props = {
      ...list.props,
      dataSource: '[{ text: "A" }]',
      columns: 1,
      rows: 0,
      autoFlow: 'row',
      columnGap: 8,
      rowGap: 8,
      justifyItems: 'stretch',
      alignItems: 'stretch',
      maxItems: 100,
    };
    listDocument.nodes[0].children = [list.id];
    listDocument.nodes.push(list);
    listDocument.zOrder = [list.id];
    assert.equal(validateUiDesignerDocument(listDocument).errors.some((issue) => issue.nodeId === list.id), false);
    list.props.maxItems = 1001;
    assert.ok(validateUiDesignerDocument(listDocument).errors.some((issue) => issue.nodeId === list.id && issue.path?.endsWith('maxItems')));
    list.props.maxItems = 100;
    list.focusAnim = { type: 'scaleIn', duration: 100, easing: 'Linear' };
    assert.ok(validateUiDesignerDocument(listDocument).errors.some((issue) => issue.nodeId === list.id && issue.path?.endsWith('focusAnim')));
  });

  test('rejects unsafe direct and nested project resource paths', () => {
    const uncPath = `${path.win32.sep}${path.win32.sep}${['host.invalid', 'share', 'hover.png'].join(path.win32.sep)}`;
    const direct = sampleDocument();
    direct.nodes[0].props.backgroundPath = '../outside.png';
    assert.ok(validateUiDesignerDocument(direct).errors.some((issue) => issue.path === '$.resources'));

    const nested = sampleDocument();
    (nested.nodes[0].props as unknown as Record<string, unknown>).imageStates = {
      normal: 'img/pictures/normal.png',
      hover: uncPath,
      pressed: '',
      disabled: '',
    };
    assert.ok(validateUiDesignerDocument(nested).errors.some((issue) => issue.path === '$.resources'));
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

describe('ui designer scene file listing', () => {
  test('lists canonical and legacy project scenes with project thumbnails', () => {
    const project = path.join(tempRoot, 'project');
    fs.mkdirSync(path.join(project, 'ui', 'nested'), { recursive: true });
    const canonicalPath = projectUiDesignerScenePath(project, 'Scene_Sample');
    saveUiDesignerFile(canonicalPath, sampleDocument());
    writeProjectUiDesignerThumbnail(project, 'Scene_Sample', TEST_PNG_DATA_URL);
    saveUiDesignerFile(path.join(project, 'ui', 'nested', 'menu.mzui'), { ...sampleDocument(), meta: { ...sampleDocument().meta, sceneName: 'Scene_Menu_Custom' } });
    fs.writeFileSync(path.join(project, 'ui', 'broken.mzui'), 'not json', 'utf8');
    const invalidName = sampleDocument();
    invalidName.meta.sceneName = 'NotASceneClass';
    fs.writeFileSync(path.join(project, 'ui', 'invalid-name.mzui'), JSON.stringify(invalidName), 'utf8');
    fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });
    saveUiDesignerFile(path.join(project, 'node_modules', 'pkg', 'vendored.mzui'), sampleDocument());
    fs.writeFileSync(path.join(project, 'notes.txt'), 'ignored', 'utf8');

    const records = listUiDesignerSceneFiles(project);
    assert.deepEqual(records.map((record) => record.sceneName), ['Scene_Sample', 'Scene_Menu_Custom']);
    const canonical = records.find((record) => record.sceneName === 'Scene_Sample');
    assert.equal(canonical?.path, '.luna_rpg/ui-designer/scenes/Scene_Sample.mzui');
    assert.equal(canonical?.sourcePath, canonicalPath);
    assert.equal(canonical?.thumbnailUrl, TEST_PNG_DATA_URL);
    assert.equal(Number.isNaN(Date.parse(canonical?.modifiedAt ?? '')), false);
    const legacy = records.find((record) => record.sceneName === 'Scene_Menu_Custom');
    assert.equal(legacy?.path, 'ui/nested/menu.mzui');
    assert.equal(legacy?.thumbnailUrl, undefined);
    assert.deepEqual(listUiDesignerSceneFiles(path.join(project, 'missing')), []);
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

    const opened = store.recordRecentFile(projectFile, { opened: true, sceneName: 'Scene_Sample', thumbnailDataUrl: TEST_PNG_DATA_URL });
    const saved = store.recordRecentFile(projectFile, { opened: false, saved: true });
    assert.equal(saved.sceneName, 'Scene_Sample');
    assert.equal(saved.lastOpenedAt, opened.lastOpenedAt);
    assert.notEqual(saved.lastSavedAt, undefined);
    const savedWithoutOpenedFlag = store.recordRecentFile(projectFile, { saved: true });
    assert.equal(savedWithoutOpenedFlag.lastOpenedAt, opened.lastOpenedAt);
    assert.equal(store.listRecentFiles()[0]?.thumbnailUrl, TEST_PNG_DATA_URL);
    store.removeRecentFile(projectFile);
    assert.deepEqual(store.listRecentFiles(), []);

    store.writePreferences({ selectedTemplate: 'sample' });
    assert.deepEqual(store.readPreferences(), { selectedTemplate: 'sample' });
    assert.equal(fs.existsSync(path.join(tempRoot, 'user-data', 'ui-designer')), false);
    assert.equal(fs.existsSync(path.join(tempRoot, 'user-data', 'data', 'ui-designer', 'preferences.json')), true);
    assert.equal(fs.existsSync(path.join(tempRoot, 'user-data', 'runtime', 'ui-designer', 'recovery.json')), true);
  });

  test('filters recent files by the owning project', () => {
    const projectA = path.join(tempRoot, 'project-a');
    const projectB = path.join(tempRoot, 'project-b');
    const sceneA = path.join(projectA, 'ui', 'scene-a.mzui');
    const legacySceneA = path.join(projectA, 'ui', 'legacy-a.mzui');
    const sceneB = path.join(projectB, 'ui', 'scene-b.mzui');
    fs.mkdirSync(path.dirname(sceneA), { recursive: true });
    fs.mkdirSync(path.dirname(sceneB), { recursive: true });
    saveUiDesignerFile(sceneA, sampleDocument());
    saveUiDesignerFile(legacySceneA, sampleDocument());
    saveUiDesignerFile(sceneB, sampleDocument());

    const store = new UiDesignerUserDataStore(path.join(tempRoot, 'user-data'));
    store.recordRecentFile(sceneA, { opened: true, projectPath: projectA });
    store.recordRecentFile(legacySceneA, { opened: true });
    store.recordRecentFile(sceneB, { opened: true, projectPath: projectB });

    assert.deepEqual(
      store.listRecentFiles(projectA).map((record) => record.sourcePath).sort(),
      [legacySceneA, sceneA].map((value) => path.resolve(value)).sort(),
    );
    assert.deepEqual(
      store.listRecentFiles(projectB).map((record) => record.sourcePath),
      [path.resolve(sceneB)],
    );
  });

  test('writes in-memory recovery records and rejects recovery paths outside user data', () => {
    const storeRoot = path.join(tempRoot, 'user-data');
    const store = new UiDesignerUserDataStore(storeRoot);
    const recovery = store.writeRecovery(sampleDocument(), undefined, undefined, 'tab-1');
    assert.equal(store.readRecovery(recovery.id).record.key, 'tab-1');
    assert.equal(store.readRecovery(recovery.id).document.meta.sceneName, 'Scene_Sample');

    const metadataPath = path.join(storeRoot, 'runtime', 'ui-designer', 'recovery.json');
    const outside = path.join(tempRoot, 'outside.mzui');
    fs.writeFileSync(outside, `${JSON.stringify(sampleDocument())}\n`, 'utf8');
    const malicious = {
      id: 'outside', sourcePath: '', snapshotPath: outside, savedAt: new Date().toISOString(), digest: 'digest', mtimeMs: 1,
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify([malicious])}\n`, 'utf8');
    assert.throws(() => store.listRecentSnapshots(), (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'recovery-path');

    const snapshotsRoot = path.join(storeRoot, 'runtime', 'ui-designer', 'snapshots');
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

  test('migrates the legacy top-level store into data and runtime without losing recovery', () => {
    const storeRoot = path.join(tempRoot, 'user-data');
    const legacyRoot = path.join(storeRoot, 'ui-designer');
    const legacySnapshotsRoot = path.join(legacyRoot, 'snapshots');
    const snapshotId = 'legacy-snapshot';
    const legacySnapshot = path.join(legacySnapshotsRoot, `${snapshotId}.mzui`);
    fs.mkdirSync(legacySnapshotsRoot, { recursive: true });
    fs.writeFileSync(legacySnapshot, `${JSON.stringify(sampleDocument(), null, 2)}\n`, 'utf8');
    const record = {
      id: snapshotId,
      sourcePath: '',
      snapshotPath: legacySnapshot,
      savedAt: new Date().toISOString(),
      digest: 'digest',
      mtimeMs: 1,
      key: 'tab-legacy',
    };
    fs.writeFileSync(path.join(legacyRoot, 'recovery.json'), `${JSON.stringify([record], null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(legacyRoot, 'recent.json'), `${JSON.stringify([record], null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(legacyRoot, 'preferences.json'), `${JSON.stringify({ leftPaneWidth: 280 })}\n`, 'utf8');

    const store = new UiDesignerUserDataStore(storeRoot);
    const migrated = store.readRecovery(snapshotId);

    assert.equal(migrated.record.key, 'tab-legacy');
    assert.equal(migrated.document.meta.sceneName, 'Scene_Sample');
    assert.equal(migrated.record.snapshotPath, path.join(storeRoot, 'runtime', 'ui-designer', 'snapshots', `${snapshotId}.mzui`));
    assert.deepEqual(store.readPreferences(), { leftPaneWidth: 280 });
    assert.equal(fs.existsSync(legacyRoot), false);
    assert.equal(fs.existsSync(path.join(storeRoot, 'data', 'ui-designer', 'preferences.json')), true);
    assert.equal(fs.existsSync(path.join(storeRoot, 'runtime', 'ui-designer', 'recovery.json')), true);
  });

  test('leaves the complete legacy store untouched when a migration target conflicts', () => {
    const storeRoot = path.join(tempRoot, 'user-data');
    const legacyRoot = path.join(storeRoot, 'ui-designer');
    const legacySnapshotsRoot = path.join(legacyRoot, 'snapshots');
    const legacySnapshot = path.join(legacySnapshotsRoot, 'legacy.mzui');
    fs.mkdirSync(legacySnapshotsRoot, { recursive: true });
    fs.writeFileSync(legacySnapshot, `${JSON.stringify(sampleDocument())}\n`, 'utf8');
    fs.writeFileSync(path.join(legacyRoot, 'preferences.json'), `${JSON.stringify({ leftPaneWidth: 280 })}\n`, 'utf8');
    const destinationPreferences = path.join(storeRoot, 'data', 'ui-designer', 'preferences.json');
    fs.mkdirSync(path.dirname(destinationPreferences), { recursive: true });
    fs.writeFileSync(destinationPreferences, `${JSON.stringify({ leftPaneWidth: 320 })}\n`, 'utf8');

    assert.throws(
      () => new UiDesignerUserDataStore(storeRoot),
      (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'migrate-user-data',
    );
    assert.equal(fs.existsSync(legacySnapshot), true);
    assert.equal(fs.existsSync(path.join(legacyRoot, 'preferences.json')), true);
    assert.equal(fs.existsSync(path.join(storeRoot, 'runtime', 'ui-designer', 'snapshots', 'legacy.mzui')), false);
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
      focusAnim: { type: 'none', duration: 0, easing: 'Linear' },
      events: {},
    }],
    zOrder: ['node_root'],
    sceneScript: { version: '1.1.0', source: '' },
  };
}

const TEST_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
