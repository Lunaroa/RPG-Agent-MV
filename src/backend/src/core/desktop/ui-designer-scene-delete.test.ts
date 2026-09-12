import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import type { UiDesignerDocument } from '../../../../contract/ui-designer.ts';
import {
  UiDesignerFileConflictError,
  UiDesignerPersistenceError,
  UiDesignerUserDataStore,
  inspectProjectUiDesignerSceneDeletion,
  projectUiDesignerScenePath,
  removeProjectUiDesignerThumbnail,
  saveUiDesignerFile,
  trashProjectUiDesignerScene,
  writeProjectUiDesignerThumbnail,
} from './ui-designer-service.ts';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+X4f3AAAAAElFTkSuQmCC';

let temporaryRoot = '';

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-scene-delete-'));
});

afterEach(() => {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = '';
});

test('inspects structured scene references and moves only the confirmed canonical source', async () => {
  const project = path.join(temporaryRoot, 'project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  const targetDocument = sceneDocument('Scene_Target');
  const targetPath = projectUiDesignerScenePath(project, 'Scene_Target');
  const targetMetadata = saveUiDesignerFile(targetPath, targetDocument);

  const referringDocument = sceneDocument('Scene_Referrer');
  const root = referringDocument.nodes.find((node) => node.id === 'node_root')!;
  root.events = { onClick: { actions: [{ type: 'gotoScene', sceneName: 'Scene_Target' }] } };
  const referringPath = projectUiDesignerScenePath(project, 'Scene_Referrer');
  saveUiDesignerFile(referringPath, referringDocument);

  const inspection = inspectProjectUiDesignerSceneDeletion(project, targetPath);
  assert.equal(inspection.sceneName, 'Scene_Target');
  assert.equal(inspection.metadata.digest, targetMetadata.digest);
  assert.deepEqual(inspection.references.map((reference) => ({
    sceneName: reference.sceneName,
    nodeId: reference.nodeId,
    event: reference.event,
  })), [{ sceneName: 'Scene_Referrer', nodeId: 'node_root', event: 'onClick' }]);

  let trashCalls = 0;
  await assert.rejects(
    () => trashProjectUiDesignerScene(project, targetPath, { digest: 'stale', mtimeMs: targetMetadata.mtimeMs }, async () => { trashCalls += 1; }),
    (error: unknown) => error instanceof UiDesignerFileConflictError,
  );
  assert.equal(trashCalls, 0);
  assert.equal(fs.existsSync(targetPath), true);

  const recycleDirectory = path.join(temporaryRoot, 'recycle-bin');
  fs.mkdirSync(recycleDirectory);
  const deleted = await trashProjectUiDesignerScene(
    project,
    targetPath,
    { digest: targetMetadata.digest, mtimeMs: targetMetadata.mtimeMs },
    async (sourcePath) => {
      trashCalls += 1;
      fs.renameSync(sourcePath, path.join(recycleDirectory, path.basename(sourcePath)));
    },
  );
  assert.equal(deleted.sceneName, 'Scene_Target');
  assert.equal(trashCalls, 1);
  assert.equal(fs.existsSync(targetPath), false);
  assert.equal(fs.existsSync(path.join(recycleDirectory, 'Scene_Target.mzui')), true);
  assert.equal(fs.existsSync(referringPath), true);
});

test('rejects non-canonical scene paths and cleans derived records by source', () => {
  const project = path.join(temporaryRoot, 'project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  const targetDocument = sceneDocument('Scene_Target');
  const targetPath = projectUiDesignerScenePath(project, 'Scene_Target');
  const targetMetadata = saveUiDesignerFile(targetPath, targetDocument);

  const outsidePath = path.join(project, 'Scene_Target.mzui');
  saveUiDesignerFile(outsidePath, targetDocument);
  assert.throws(
    () => inspectProjectUiDesignerSceneDeletion(project, outsidePath),
    (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'inspect-scene-deletion',
  );

  const mismatchedPath = projectUiDesignerScenePath(project, 'Scene_Wrong');
  saveUiDesignerFile(mismatchedPath, targetDocument);
  assert.throws(
    () => inspectProjectUiDesignerSceneDeletion(project, mismatchedPath),
    (error: unknown) => error instanceof UiDesignerPersistenceError && error.operation === 'inspect-scene-deletion',
  );

  writeProjectUiDesignerThumbnail(project, 'Scene_Target', PNG_DATA_URL);
  assert.equal(removeProjectUiDesignerThumbnail(project, 'Scene_Target'), true);
  assert.equal(removeProjectUiDesignerThumbnail(project, 'Scene_Target'), false);

  const store = new UiDesignerUserDataStore(path.join(temporaryRoot, 'user-data'));
  const recovery = store.writeRecovery(targetDocument, targetPath, targetMetadata, 'tab-1');
  store.writeRecovery(sceneDocument('Scene_Other'), undefined, undefined, 'tab-2');
  store.recordRecentFile(targetPath, { opened: true, projectPath: project, sceneName: 'Scene_Target', thumbnailDataUrl: PNG_DATA_URL });
  assert.deepEqual(store.removeRecoveryForSource(targetPath), [recovery.id]);
  assert.equal(store.listRecovery().some((record) => record.sourcePath === targetPath), false);
  assert.equal(store.listRecovery().length, 1);
  store.removeRecentFile(targetPath);
  assert.deepEqual(store.listRecentFiles(project), []);
});

function sceneDocument(sceneName: string): UiDesignerDocument {
  return {
    version: '1.1.0',
    editorVersion: '1.1.0',
    meta: {
      sceneName,
      sceneBase: 'Scene_Base',
      canvasWidth: 816,
      canvasHeight: 624,
      author: '',
      description: '',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
    },
    transitions: { enter: { type: 'fade', duration: 300 }, exit: { type: 'fade', duration: 300 } },
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
      locked: false,
      condition: { type: 'none' },
      conditionFrequency: 'per-frame',
      enterAnim: { type: 'none', duration: 0, easing: 'Linear' },
      exitAnim: { type: 'none', duration: 0, easing: 'Linear' },
      focusAnim: { type: 'none', duration: 0, easing: 'Linear' },
      events: {},
    }],
    zOrder: ['node_root'],
    sceneScript: { version: '1.1.0', source: '' },
  };
}
