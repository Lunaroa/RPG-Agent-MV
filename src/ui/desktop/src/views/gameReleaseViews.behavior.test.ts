import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { h } from 'vue';

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
  assert.doesNotMatch(packaging, /preflight\??\.warnings/);
});

test('release audit: selecting a full package clears a hidden delta baseline', () => {
  const state = { activePreset: ref({ packageType: 'file-delta', baseReleaseId: 'sample-base' }) };
  const context = functions('GamePackagingView.vue', ['changePackageType'], state);
  vm.runInContext("changePackageType('full')", context);
  assert.equal(state.activePreset.value.packageType, 'full');
  assert.equal('baseReleaseId' in state.activePreset.value, false);
});

test('packaging confirmation renders one labeled row per changed file without raw HTML', async () => {
  let confirmation: any;
  const state = {
    checking: ref(false), building: ref(false), publishing: ref(false), projectStore: { currentProject: project }, loadRequestId: 1,
    activePreset: ref({}), release: ref({}), releaseStatus: ref({}), h, t: (key: string) => key,
    isCurrentProjectRequest: () => true,
    runPreflight: async () => ({ ok: true, managedChanges: [
      { kind: 'create', relativePath: 'data/sample.json' }, { kind: 'update', relativePath: 'js/plugins.js' },
    ] }),
    ElMessageBox: { confirm: async (value: unknown) => { confirmation = value; throw 'cancel'; } },
  };
  await vm.runInContext('build()', functions('GamePackagingView.vue', ['build'], state));
  assert.equal(confirmation.type, 'ul');
  assert.equal(confirmation.children.length, 2);
  assert.equal(confirmation.children[0].children[0].children, 'gameVersion.create · ');
  assert.equal(confirmation.children[1].children[0].children, 'gameVersion.update · ');
  assert.equal(confirmation.children[1].children[1].children, 'js/plugins.js');
});

test('Android audio confirmation counts files, respects cancellation, and rechecks installed tools', async () => {
  const preparation = { id: 'sample-plan', toolsReady: true, files: [{ sourcePath: 'audio/bgm/Sample.ogg', targetPath: 'audio/bgm/Sample.m4a' }] };
  const checked = { ok: true, preset: { id: 'sample-android' }, androidAudioPreparation: preparation };
  let cancel = true;
  let current = true;
  let installs = 0;
  let refreshes = 0;
  let fresh = structuredClone(checked);
  const messages: string[] = [];
  const errors: string[] = [];
  const state = {
    checked, project,
    t: (key: string, args?: { count: number }) => `${key}${args ? ':' + args.count : ''}`,
    ElMessageBox: { confirm: async (message: string) => { messages.push(message); if (cancel) throw 'cancel'; } },
    ElMessage: { error: (message: string) => errors.push(message) },
    isCurrentProjectRequest: () => current,
    installMediaTools: async () => { installs++; },
    runPreflight: async () => { refreshes++; return fresh; },
  };
  const context = functions('GamePackagingView.vue', ['confirmAndroidAudioPreparation'], state);
  const confirm = () => vm.runInContext('confirmAndroidAudioPreparation(checked, project, 1)', context);
  assert.equal(await confirm(), false);
  assert.equal(installs, 0);
  cancel = false;
  assert.equal(await confirm(), true);
  assert.equal(messages.at(-1), 'gamePackaging.audioPreparationConfirm:1');
  assert.equal(refreshes, 0);
  current = false;
  assert.equal(await confirm(), false);
  current = true;
  preparation.toolsReady = false;
  fresh.androidAudioPreparation.toolsReady = false;
  assert.equal(await confirm(), false, 'canceled or failed installation must not start a build');
  fresh.androidAudioPreparation.toolsReady = true;
  assert.equal(await confirm(), true);
  assert.equal(messages.at(-1), 'gamePackaging.audioPreparationInstallConfirm:1');
  assert.equal(installs, 2);
  assert.equal(refreshes, 2);
  fresh.androidAudioPreparation.id = 'changed-plan';
  assert.equal(await confirm(), false);
  assert.equal(errors.at(-1), 'gamePackaging.audioPreparationChanged');
});

test('Android audio build sends consent only after confirmation and displays blocking errors in a dialog', async () => {
  const preparation = { id: 'sample-plan', toolsReady: true, files: [{ sourcePath: 'audio/bgm/Sample.ogg', targetPath: 'audio/bgm/Sample.m4a' }] };
  let checked: any = { ok: true, managedChanges: [], existingOutput: false, androidAudioPreparation: preparation };
  let approved = false;
  const requests: any[] = [];
  const alerts: any[] = [];
  const state = {
    checking: ref(false), building: ref(false), publishing: ref(false), cancelingBuild: ref(false),
    projectStore: { currentProject: project }, loadRequestId: 1, activePreset: ref({ id: 'sample-android', target: 'android' }),
    release: ref({}), releaseStatus: ref({ sourceHash: null }), error: ref(''), published: ref(null), result: ref(null), buildProgress: ref(null),
    runPreflight: async () => checked, isCurrentProjectRequest: () => true,
    confirmAndroidAudioPreparation: async () => approved, chooseConflict: async () => 'new-directory',
    crypto: { randomUUID: () => 'sample-operation' }, cloneDraft: structuredClone, h,
    t: (key: string) => key, errorText: (message: string) => 'localized:' + message,
    ElMessage: { info() {}, error() {} }, ElMessageBox: { alert: async (message: any) => { alerts.push(message); } },
    gameBuild: { build: async (request: unknown) => { requests.push(request); return { status: 'canceled' }; } },
    operationError: (_key: string, error: unknown) => String(error),
  };
  const context = functions('GamePackagingView.vue', ['build'], state);
  await vm.runInContext('build()', context);
  assert.equal(requests.length, 0);
  approved = true;
  await vm.runInContext('build()', context);
  assert.equal(state.error.value, '');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].androidAudioPreparationId, preparation.id);
  assert.equal(state.building.value, false);
  checked = { ok: false, blockers: ['minimum Android API is 24'] };
  await vm.runInContext('build()', context);
  assert.equal(requests.length, 1);
  assert.equal(alerts[0].children[0].children, 'localized:minimum Android API is 24');
});

test('packaging tool installation settles after project switches and cancellation reaches the active operation', async () => {
  let finish!: (value: unknown) => void;
  let canceled = '';
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const state = {
    projectStore: { currentProject: project }, loadRequestId: 1, settings: ref({}), error: ref(''),
    toolRunning: ref(false), installingAndroidToolchain: ref(false), toolProgress: ref<any>(null), toolOutcome: ref(null), toolError: ref(''), toolCanceling: ref(false),
    androidToolchain: ref(null), crypto: { randomUUID: () => 'sample-tool-operation' }, t: (key: string) => key,
    ElMessageBox: { confirm: async () => {} }, ElMessage: { success() {}, error() {} }, errorText: String,
    isCurrentProjectRequest: (requested: string) => requested === state.projectStore.currentProject,
    persistSettings: async () => {},
    gameBuild: {
      selectOutputDirectory: async () => path.join(os.tmpdir(), 'sample-toolchain'),
      installAndroidToolchain: () => { began(); return new Promise(resolve => { finish = resolve; }); },
      cancelToolInstall: async (id: string) => { canceled = id; },
    },
  };
  const context = functions('GamePackagingView.vue', ['installAndroidToolchain', 'startToolTask', 'cancelToolInstall'], state);
  const installing = vm.runInContext('installAndroidToolchain()', context);
  await started;
  assert.equal(state.installingAndroidToolchain.value, true);
  await vm.runInContext('cancelToolInstall()', context);
  assert.equal(canceled, 'sample-tool-operation');
  state.projectStore.currentProject = path.join(os.tmpdir(), 'other-sample-project');
  finish({ configured: true });
  await installing;
  assert.equal(state.installingAndroidToolchain.value, false);
  assert.equal(state.toolOutcome.value, 'success');
  assert.equal(state.androidToolchain.value, null);
});

test('Android installer selects and saves its own directory and cancels before download', async () => {
  const selected = path.join(os.tmpdir(), 'sample-toolchain');
  let picked: string | null = selected;
  const calls: string[] = [];
  const state = {
    projectStore: { currentProject: project }, loadRequestId: 1, settings: ref<any>({}), error: ref(''), preflight: ref({ ok: false }),
    toolRunning: ref(false), installingAndroidToolchain: ref(false), toolProgress: ref<any>(null), toolOutcome: ref(null), toolError: ref(''), toolCanceling: ref(false),
    androidToolchain: ref<any>(null), crypto: { randomUUID: () => 'sample-tool-operation' }, t: (key: string) => key,
    ElMessageBox: { confirm: async () => {} }, ElMessage: { success() {}, error() {} }, errorText: String,
    isCurrentProjectRequest: () => true,
    persistSettings: async () => { assert.equal(state.settings.value.androidToolchainRoot, selected); calls.push('save'); },
    gameBuild: {
      selectOutputDirectory: async (_initial: string, purpose: string) => { assert.equal(purpose, 'android-toolchain'); return picked; },
      installAndroidToolchain: async (request: { root: string }) => { assert.equal(request.root, selected); calls.push('install'); return { configured: true, root: selected }; },
    },
  };
  const context = functions('GamePackagingView.vue', ['installAndroidToolchain', 'startToolTask'], state);
  await vm.runInContext('installAndroidToolchain()', context);
  assert.deepEqual(calls, ['save', 'install']);
  assert.equal(state.preflight.value, null);
  picked = null;
  await vm.runInContext('installAndroidToolchain()', context);
  picked = path.join(os.tmpdir(), '中文 工具链');
  await vm.runInContext('installAndroidToolchain()', context);
  assert.deepEqual(calls, ['save', 'install']);
  assert.match(state.error.value, /androidPath/);
  assert.equal(state.installingAndroidToolchain.value, false);
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
