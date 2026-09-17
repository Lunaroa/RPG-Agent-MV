import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { LatestAsyncCoordinator } from '../../utils/latestAsyncCoordinator';
import { mapPreviewDiagnosticFromError } from '../../utils/mapPreviewDiagnostics';

const source = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('map loading separates the requested map from the committed map', () => {
  assert.match(source, /:selected-map-id="requestedMapId \?\? selectedMapId"/);
  assert.match(source, /mapLoadCoordinator\.begin\(\{ project, mapId \}\)/);
  assert.match(source, /mapLoadCoordinator\.runExclusive\(token,/);
  assert.match(source, /if \(!mapLoadCoordinator\.isCurrent\(token\)\) return 'superseded'/);
  const loadMapSource = source.slice(source.indexOf('async function loadMap('), source.indexOf('async function reloadCurrentMap()'));
  const requestPhase = loadMapSource.slice(0, loadMapSource.indexOf('busy.value = true'));
  assert.doesNotMatch(requestPhase, /schedulePreviewIntentReconcile/);
  assert.equal(loadMapSource.match(/schedulePreviewIntentReconcile\(\)/g)?.length, 3);
});

test('preview lifecycle is driven by one latest intent queue', () => {
  assert.match(source, /previewIntentCoordinator\.runExclusive\(token,/);
  assert.match(source, /previewSessionMatchesIntent\(session, intent\)/);
  assert.match(source, /event\.sessionId !== session\.sessionId \|\| event\.operationId !== session\.operationId/);
  assert.match(source, /event\.mapId !== session\.mapId \|\| event\.mapRevision !== session\.mapRevision/);
  assert.doesNotMatch(source, /ensurePreviewForSelectedMap/);
});

test('restart checks the latest intent after stopping the old session', () => {
  const restart = source.slice(source.indexOf('async function restartPreview()'), source.indexOf('async function setPreviewSwitch'));
  assert.match(restart, /previewIntentCoordinator\.begin\(intent/);
  assert.match(restart, /await stopPreviewSession\(\)/);
  assert.match(restart, /if \(!isCurrent\(\) \|\| !token\.value\.active\) return/);
});

test('a rendered map commits after clearing inactive preview state', async () => {
  const { context, requests, failures } = createEditorLoadContext();
  assert.equal(await vm.runInContext('loadMap(1)', context), 'committed');
  await context.previewIntentCoordinator.drain();
  assert.deepEqual(requests, [1]);
  assert.deepEqual(failures, []);
  assert.equal(context.selectedMapId.value, 1);
  assert.equal(context.renderCount, 1);
  assert.equal(context.busy.value, false);
  assert.equal(context.previewError.value, '');
  assert.equal(context.previewDiagnostic.value, null);
  assert.equal(context.suspendCount, 1);
});

test('opening the preferred map stops after its first successful load', async () => {
  const { context, requests, failures } = createEditorLoadContext();
  assert.equal(await vm.runInContext('openPreferredMap(2)', context), true);
  await context.previewIntentCoordinator.drain();
  assert.deepEqual(requests, [2]);
  assert.deepEqual(failures, []);
  assert.equal(context.renderCount, 1);
});

test('stopping preview clears active and empty sessions without obsolete staging state', async () => {
  const { context } = createEditorLoadContext();
  context.previewSession.value = { status: 'running' };
  await vm.runInContext('stopPreviewSession()', context);
  assert.equal(context.stopCount, 1);
  assert.equal(context.previewSession.value, null);
  assert.equal(context.previewStatus.value, 'stopped');
  assert.equal(context.previewError.value, '');
  assert.equal(context.previewDiagnostic.value, null);
  assert.equal(context.previewRuntimeCommand.value, null);
  assert.equal(context.previewConsoleEntries.value.length, 0);
  await vm.runInContext('stopPreviewSession()', context);
  assert.equal(context.stopCount, 1);
});

test('preview failure handling retains the original diagnostic', () => {
  const { context } = createEditorLoadContext();
  context.failure = new Error('Sample preview transport failure');
  context.currentEngine.value = 'mv';
  context.previewSession.value = { operationId: 3 };
  vm.runInContext("setDirectPreviewFailure(failure, 'start-ipc', { active: true, project: projectStore.currentProject, mapId: 1 })", context);
  assert.equal(context.previewDiagnostic.value.detail.message, context.failure.message);
  assert.equal(context.previewDiagnostic.value.detail.stage, 'start-ipc');
  assert.equal(context.previewDiagnostic.value.mapId, 1);
  assert.equal(context.previewDiagnostic.value.operationId, 3);
  assert.equal(context.publishedDiagnostic, context.previewDiagnostic.value);
});

function createEditorLoadContext() {
  const requests: number[] = [];
  const failures: string[] = [];
  const noop = () => {};
  const context = vm.createContext({
    console: { debug: noop, warn: noop },
    projectStore: { currentProject: path.join(os.tmpdir(), 'sample-editor-project') },
    mapLoadCoordinator: new LatestAsyncCoordinator(),
    previewIntentCoordinator: new LatestAsyncCoordinator(),
    mode: { value: 'map' },
    mapTree: { value: [1, 2, 3, 4].map((id) => ({ id })) },
    route: { query: {} },
    flattenTree: (tree: unknown) => tree,
    findTreeNode: (id: number) => ({ id, mapFileExists: true }),
    mapsApi: { get: async (id: number) => {
      requests.push(id);
      return { map: { data: [], events: [], note: '' }, info: {}, effectiveMapRevision: 'sample-revision' };
    } },
    payloadToMap: (map: unknown) => map,
    preloadTileset: async () => [],
    preloadOptionalImage: async () => null,
    prepareEventCharacters: async () => [],
    syncCurrentEvents: noop,
    syncPreviewOverridesFromWorkspace: noop,
    setPropertiesFromMap: noop,
    setMap: async () => {},
    characterImages: new Map(),
    cloneDraft: (value: unknown) => structuredClone(value),
    persistWorkspaceSelection: noop,
    setStatus: (message: string, kind: string) => { if (kind === 'error') failures.push(message); },
    t: (key: string, params?: { message?: string }) => params?.message ?? key,
    ElMessage: { error: noop, warning: noop },
    captureEditorSurfaceVersion: async () => {},
    ensurePreviewForIntent: async () => {},
    mapPreviewDiagnosticFromError,
    currentMap: null,
    renderCount: 0,
    suspendCount: 0,
    stopCount: 0,
    lastPublishedPreviewFailureKey: '',
    previewConsoleRequestSequence: 0,
    previewConsoleEntrySequence: 0,
  });
  context.renderMap = () => { context.renderCount += 1; };
  context.suspendPreviewSession = async () => { context.suspendCount += 1; };
  context.mapPreview = { stop: async () => { context.stopCount += 1; } };
  context.publishPreviewFailureToWorkbench = (diagnostic: unknown) => { context.publishedDiagnostic = diagnostic; };
  for (const name of [
    'requestedMapId', 'selectedMapId', 'selectedEventId', 'currentMapRevision',
    'busy', 'currentTileSize', 'currentEngine', 'currentTilesetMode', 'currentTilesetNames',
    'currentExtendedTilesetSheets', 'systemData', 'previewStateCatalog', 'currentMapName',
    'currentMapNote', 'tilesetFlags', 'currentParallaxImage', 'currentTilesetImages',
    'previewRefreshActive', 'previewError', 'previewDiagnostic', 'previewSession', 'previewStatus',
    'previewRequestedMapId', 'previewRuntimeCommand', 'previewSwitchOverrides',
    'previewVariableOverrides', 'previewSelfSwitchOverrides', 'previewConsoleEntries',
  ]) context[name] = { value: null };
  context.previewError.value = 'Previous preview failure';
  context.previewDiagnostic.value = { detail: { message: 'Previous preview failure' } };
  context.previewPresentationEpoch = { value: 0 };
  context.previewVariableDraftResetEpoch = { value: 0 };

  // Execute the view's actual control flow, replacing only renderer and IPC dependencies.
  const { descriptor } = parse(source);
  assert.ok(descriptor.scriptSetup);
  const ast = ts.createSourceFile('EditorView.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
  const names = new Set([
    'loadMap', 'openPreferredMap', 'schedulePreviewIntentReconcile', 'currentPreviewIntent',
    'stopPreviewSession', 'revokePreviewFrame', 'setDirectPreviewFailure',
  ]);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text || ''));
  assert.equal(functions.length, names.size);
  const code = functions.map((node) => node.getText(ast)).join('\n');
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, requests, failures };
}
