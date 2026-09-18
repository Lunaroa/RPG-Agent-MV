import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

const ref = <T>(value: T) => ({ value });
const project = path.join(os.tmpdir(), 'sample-release-project');
const read = (view: string) => fs.readFileSync(path.join(import.meta.dirname, view), 'utf8');

function functions(view: string, names: string[], state: Record<string, unknown>): vm.Context {
  const source = parse(read(view)).descriptor.scriptSetup!.content;
  const ast = ts.createSourceFile(view + '.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  assert.equal(declarations.length, names.length);
  const code = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const context = vm.createContext(state);
  vm.runInContext(code, context);
  return context;
}

test('release audit: both release page templates compile and expose encryption before a key exists', () => {
  for (const view of ['GameVersionView.vue', 'GamePackagingView.vue']) {
    const { descriptor } = parse(read(view));
    const script = compileScript(descriptor, { id: view });
    const template = compileTemplate({ id: view, source: descriptor.template!.content, filename: view,
      compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    assert.match(read(view), /onActivated\(\(\) => void refreshOnActivation\(\)\)/);
  }
  const packaging = read('GamePackagingView.vue');
  assert.match(packaging, /<el-form-item v-if="usesEncryption"/);
  assert.doesNotMatch(packaging, /v-if="activePreset.processing.encryptionKeyId"/);
  const errors = packaging.slice(packaging.indexOf('<section v-if="preflight"'), packaging.indexOf('<section v-if="preflight?.warnings'));
  assert.doesNotMatch(errors, /preflight\.warnings/);
});

test('release audit: selecting a full package clears a hidden delta baseline', () => {
  const state = { activePreset: ref({ packageType: 'file-delta', baseReleaseId: 'sample-base' }) };
  const context = functions('GamePackagingView.vue', ['changePackageType'], state);
  vm.runInContext("changePackageType('full')", context);
  assert.equal(state.activePreset.value.packageType, 'full');
  assert.equal('baseReleaseId' in state.activePreset.value, false);
});

test('release audit: automatic publication starts once after the build state clears', async () => {
  const preset = { id: 'sample-web', target: 'web', upload: { enabled: true, authorization: 'none' } };
  let publications = 0;
  const state = {
    checking: ref(false), building: ref(false), publishing: ref(false), cancelingBuild: ref(false),
    projectStore: { currentProject: project }, loadRequestId: 1, activePreset: ref(preset),
    release: ref({ gameId: 'sample', update: {} }), releaseStatus: ref({ sourceHash: null }),
    settings: ref({ publicationDirectory: path.join(os.tmpdir(), 'sample-publication') }),
    savedRelease: ref(null), savedSettings: ref(null), result: ref(null), published: ref(null),
    error: ref(''), buildProgress: ref(null), signingStorePassword: ref(''), signingKeyPassword: ref(''),
    uploadUsername: ref(''), uploadPassword: ref(''), uploadToken: ref(''), rememberUploadCredential: ref(false),
    t: (key: string) => key, collectPublicationMetadata: () => ({ defaultLanguage: 'en-US' }),
    runPreflight: async () => ({ ok: true, managedChanges: [], existingOutput: false }),
    isCurrentProjectRequest: () => true, chooseConflict: async () => 'new-directory',
    crypto: { randomUUID: () => 'sample-operation' }, cloneDraft: structuredClone,
    ElMessage: { success() {}, error() {}, info() {} },
    gameRelease: { status: async () => ({ config: { gameId: 'sample', update: {} } }) },
    gameBuild: {
      build: async () => ({ status: 'success', releaseId: 'sample-release' }),
      getSettings: async () => ({ publicationDirectory: path.join(os.tmpdir(), 'sample-publication') }),
      publish: async () => { assert.equal(state.building.value, false); publications++; return { record: {} }; },
    },
    restorePublicationDraft() {}, settingsForSave: () => ({}), refreshCredentialStatus: async () => {},
    persistSettings: async () => {}, operationError: (_key: string, error: unknown) => String(error),
  };
  const context = functions('GamePackagingView.vue', ['build', 'publishRelease'], state);
  await vm.runInContext('build()', context);
  assert.equal(state.error.value, '');
  assert.equal(publications, 1);
  state.building.value = true;
  await vm.runInContext("publishRelease('sample-release')", context);
  assert.equal(publications, 1);
});

test('release audit: reactivating clean pages refreshes changed data without discarding dirty drafts', async () => {
  for (const view of ['GameVersionView.vue', 'GamePackagingView.vue']) {
    let loads = 0;
    let diskHash = 'old';
    const state = {
      loading: ref(false), dirty: ref(false), saving: ref(false), testingUpdateIndex: ref(false),
      checking: ref(false), building: ref(false), publishing: ref(false), error: ref(''),
      projectStore: { currentProject: project }, loadRequestId: 1,
      status: ref({ sourceHash: 'old' }), releaseStatus: ref({ sourceHash: 'old' }),
      settings: ref({}), managedChanges: ref([]),
      gameRelease: { status: async () => ({ sourceHash: diskHash, managedChanges: [] }) },
      gameBuild: { getSettings: async () => ({}) },
      isCurrentProjectRequest: () => true, load: async () => { loads++; },
      operationError: (_key: string, error: unknown) => String(error),
    };
    const context = functions(view, ['refreshOnActivation'], state);
    await vm.runInContext('refreshOnActivation()', context);
    assert.equal(loads, 0, 'unchanged reactivation must preserve build results');
    diskHash = 'new';
    await vm.runInContext('refreshOnActivation()', context);
    assert.equal(loads, 1);
    state.dirty.value = true;
    await vm.runInContext('refreshOnActivation()', context);
    assert.equal(loads, 1, 'unsaved drafts must not be replaced');
  }
});

test('release audit: version file preview ignores late responses for previous drafts', async () => {
  let finishFirst!: (value: unknown) => void;
  let calls = 0;
  const state = {
    projectStore: { currentProject: project }, form: ref({ version: '1.0.0' }), previewRequestId: 0,
    managedChanges: ref([]), previewError: ref(''), cloneDraft: structuredClone,
    gameRelease: { status: async () => ++calls === 1 ? new Promise((resolve) => { finishFirst = resolve; })
      : { managedChanges: [{ relativePath: 'data/RPGAgentRelease.json', kind: 'update' }] } },
    operationError: (_key: string, error: unknown) => String(error),
  };
  const context = functions('GameVersionView.vue', ['refreshManagedChanges'], state);
  const first = vm.runInContext('refreshManagedChanges()', context);
  state.form.value.version = '2.0.0';
  await vm.runInContext('refreshManagedChanges()', context);
  finishFirst({ managedChanges: [] });
  await first;
  assert.equal(state.managedChanges.value.length, 1);
});
