<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Flag, RefreshCw, Save, X } from '@lucide/vue';
import { projects, storyPages, system, type StoryProjectProfile } from '../../api/client';
import { formatUserFacingError } from '../../utils/user-facing-error';

const props = defineProps<{
  project: string;
}>();

const emit = defineEmits<{
  changed: [profile: StoryProjectProfile | null];
}>();

const profile = ref<StoryProjectProfile | null>(null);
const action = ref<'load' | 'enable' | 'git' | 'sync' | 'save' | null>(null);
const error = ref('');
const errorDetail = ref('');
const success = ref('');
const info = ref('');
const showEnableConfirm = ref(false);
const showSaveConfirm = ref(false);
const showGitDependencyPrompt = ref(false);
const enableVersionNote = ref('');
const saveVersionNote = ref('');
let loadToken = 0;

const GIT_DOWNLOAD_URL = 'https://git-scm.com/download/win';

const isBusy = computed(() => action.value !== null);
const isLoading = computed(() => action.value === 'load');
const statusLabel = computed(() => profile.value ? '已启用' : '未启用');
const statusTone = computed(() => profile.value ? 'enabled' : 'empty');
const statusTitle = computed(() => {
  if (!profile.value) return '当前项目尚未启用版本管理';
  return '版本管理已启用';
});
const activePopover = computed(() => showEnableConfirm.value || showSaveConfirm.value);

function applyUserFacingError(errorValue: unknown, context: 'version' | 'general' = 'version') {
  const formatted = formatUserFacingError(errorValue, context);
  error.value = formatted.message;
  errorDetail.value = formatted.detail || '';
  return formatted;
}

function isGitDependencyMissing(message: string): boolean {
  return /需要安装 Git|缺少 Git 依赖|未找到 git 命令|spawn(?:Sync)? git ENOENT|ENOENT/i.test(message);
}

function clearFeedback() {
  error.value = '';
  errorDetail.value = '';
  success.value = '';
  info.value = '';
}

async function loadProfile() {
  const project = props.project;
  const token = ++loadToken;
  clearFeedback();
  profile.value = null;
  if (!project) return;
  action.value = 'load';
  try {
    const next = await storyPages.profile(project);
    if (token !== loadToken) return;
    profile.value = next;
  } catch (loadError) {
    if (token === loadToken) applyUserFacingError(loadError);
  } finally {
    if (token === loadToken && action.value === 'load') action.value = null;
  }
}

async function enableProject() {
  if (!props.project || isBusy.value) return;
  action.value = 'enable';
  clearFeedback();
  try {
    const result = await storyPages.initializeOriginal(props.project);
    profile.value = result.profile;
    closeEnableConfirm();
    success.value = '已启用';
    emit('changed', profile.value);
  } catch (initError) {
    applyUserFacingError(initError);
  } finally {
    if (action.value === 'enable') action.value = null;
  }
}

async function enableProjectWithGit() {
  if (!props.project || isBusy.value) return;
  action.value = 'git';
  clearFeedback();
  try {
    const result = await storyPages.initializeOriginalWithGitBaseline(props.project, {
      commitMessage: enableVersionNote.value,
    });
    profile.value = result.profile;
    closeEnableConfirm();
    success.value = result.message;
    emit('changed', profile.value);
  } catch (initError) {
    const formatted = applyUserFacingError(initError, 'version');
    if (isGitDependencyMissing(formatted.message) || isGitDependencyMissing(formatted.detail || '')) {
      error.value = '';
      showGitDependencyPrompt.value = true;
    } else {
      error.value = `版本管理未启用：${formatted.message}`;
    }
    await reloadProfileAfterGitFailure();
  } finally {
    if (action.value === 'git') action.value = null;
  }
}

async function saveProjectVersion() {
  if (!props.project || !profile.value || isBusy.value) return;
  action.value = 'save';
  clearFeedback();
  try {
    const result = await projects.saveProjectVersion(props.project, {
      commitMessage: saveVersionNote.value,
    });
    closeSaveConfirm();
    if (result.committed) {
      success.value = result.message;
      return;
    }
    info.value = result.message;
  } catch (saveError) {
    const formatted = applyUserFacingError(saveError, 'version');
    if (isGitDependencyMissing(formatted.message) || isGitDependencyMissing(formatted.detail || '')) {
      error.value = '需要安装 Git 才能保存版本';
    } else {
      error.value = formatted.message;
    }
  } finally {
    if (action.value === 'save') action.value = null;
  }
}

async function reloadProfileAfterGitFailure() {
  try {
    const next = await storyPages.profile(props.project);
    profile.value = next;
    emit('changed', profile.value);
  } catch {
    profile.value = null;
    emit('changed', null);
  }
}

function openEnableConfirm() {
  clearFeedback();
  showSaveConfirm.value = false;
  showGitDependencyPrompt.value = false;
  enableVersionNote.value = '';
  showEnableConfirm.value = true;
}

function closeEnableConfirm() {
  showEnableConfirm.value = false;
  showGitDependencyPrompt.value = false;
  enableVersionNote.value = '';
}

function openSaveConfirm() {
  if (!profile.value || isBusy.value) return;
  clearFeedback();
  showEnableConfirm.value = false;
  saveVersionNote.value = '';
  showSaveConfirm.value = true;
}

function closeSaveConfirm() {
  showSaveConfirm.value = false;
  saveVersionNote.value = '';
}

async function openGitDownload() {
  error.value = '';
  try {
    await system.openExternalUrl(GIT_DOWNLOAD_URL);
    closeEnableConfirm();
  } catch (openError) {
    applyUserFacingError(openError);
  }
}

async function syncStoryProject() {
  if (!props.project || !profile.value || isBusy.value) return;
  action.value = 'sync';
  clearFeedback();
  try {
    const result = await storyPages.sync(props.project);
    profile.value = result.profile || profile.value;
    success.value = '已同步';
    emit('changed', profile.value);
  } catch (syncError) {
    applyUserFacingError(syncError);
  } finally {
    if (action.value === 'sync') action.value = null;
  }
}

watch(() => props.project, () => {
  closeEnableConfirm();
  closeSaveConfirm();
  void loadProfile();
}, { immediate: true });
</script>

<template>
  <div class="story-identity" :class="[`tone-${statusTone}`, { open: activePopover }]">
    <span class="identity-status" :title="statusTitle">
      <Flag class="identity-icon" />
      <b>{{ isLoading ? '读取中' : statusLabel }}</b>
      <small v-if="profile">事件编辑</small>
    </span>

    <template v-if="!isLoading && !profile">
      <button
        type="button"
        class="identity-action primary"
        :disabled="isBusy || !project"
        :aria-expanded="showEnableConfirm"
        @click="openEnableConfirm"
      >
        <Check class="identity-icon" />
        <span>{{ action === 'git' ? '处理中' : '启用版本管理' }}</span>
      </button>
    </template>

    <template v-else-if="profile">
      <button
        type="button"
        class="identity-action"
        :disabled="isBusy"
        :aria-expanded="showSaveConfirm"
        @click="openSaveConfirm"
      >
        <Save class="identity-icon" />
        <span>{{ action === 'save' ? '保存中' : '保存版本' }}</span>
      </button>
      <button
        type="button"
        class="identity-icon-button"
        :disabled="isBusy"
        title="同步事件身份"
        aria-label="同步事件身份"
        @click="syncStoryProject"
      >
        <RefreshCw class="identity-icon" :class="{ spinning: action === 'sync' }" />
      </button>
    </template>

    <span v-if="success && !error" class="identity-message">{{ success }}</span>
    <span v-if="info && !error && !success" class="identity-info">{{ info }}</span>
    <span
      v-if="error && !activePopover"
      class="identity-error"
      :title="errorDetail || error"
    >{{ error }}</span>

    <section v-if="showEnableConfirm" class="identity-popover" aria-label="启用版本管理">
      <header>
        <strong>{{ showGitDependencyPrompt ? '需要安装 Git' : '启用版本管理' }}</strong>
        <button type="button" aria-label="关闭" @click="closeEnableConfirm">
          <X class="identity-icon" />
        </button>
      </header>

      <template v-if="showGitDependencyPrompt">
        <p class="identity-note">保存版本需要本机安装 Git，但当前电脑没有找到 Git。</p>
        <p class="identity-note">是否打开 Git 下载页？安装完成后重新启用即可。</p>
      </template>
      <template v-else>
        <p class="identity-note">会先保存一份当前项目快照；失败则不启用。</p>
        <p class="identity-note">也可以只启用事件编辑，但不会自动保存当前版本。</p>
        <label>
          版本说明
          <input
            v-model="enableVersionNote"
            type="text"
            maxlength="200"
            placeholder="例如：项目初稿"
            :disabled="isBusy"
          >
        </label>
      </template>
      <p v-if="error" class="popover-error">{{ error }}</p>

      <footer v-if="showGitDependencyPrompt">
        <button type="button" class="identity-action" :disabled="isBusy" @click="closeEnableConfirm">
          取消
        </button>
        <button type="button" class="identity-action primary" :disabled="isBusy" @click="openGitDownload">
          下载 Git
        </button>
      </footer>
      <footer v-else>
        <button type="button" class="identity-action" :disabled="isBusy" @click="enableProject">
          {{ action === 'enable' ? '启用中' : '仅启用编辑' }}
        </button>
        <button type="button" class="identity-action primary" :disabled="isBusy" @click="enableProjectWithGit">
          {{ action === 'git' ? '处理中' : '启用版本管理' }}
        </button>
      </footer>
    </section>

    <section v-if="showSaveConfirm" class="identity-popover" aria-label="保存版本">
      <header>
        <strong>保存版本</strong>
        <button type="button" aria-label="关闭" @click="closeSaveConfirm">
          <X class="identity-icon" />
        </button>
      </header>

      <p class="identity-note">把当前项目改动记入本地版本历史，不需要远程仓库。</p>
      <label>
        版本说明
        <input
          v-model="saveVersionNote"
          type="text"
          maxlength="200"
          placeholder="例如：第一章剧情定稿"
          :disabled="isBusy"
        >
      </label>
      <p v-if="error" class="popover-error">{{ error }}</p>

      <footer>
        <button type="button" class="identity-action" :disabled="isBusy" @click="closeSaveConfirm">
          取消
        </button>
        <button type="button" class="identity-action primary" :disabled="isBusy" @click="saveProjectVersion">
          {{ action === 'save' ? '保存中' : '确认保存' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.story-identity {
  position: relative;
  min-width: 0;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--console-text-soft, #5a5247);
}

.identity-status,
.identity-action,
.identity-icon-button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  background: var(--console-paper, #fffdfa);
  color: inherit;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.identity-status {
  min-width: 88px;
  gap: 7px;
  padding: 0 11px;
  border-radius: 9px;
}

.identity-status b {
  font-weight: 650;
}

.identity-status small {
  max-width: 72px;
  overflow: hidden;
  color: var(--console-text-muted, #9a8e7e);
  font-family: var(--app-font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
}

.tone-empty .identity-status {
  border-color: #d9c09a;
  background: #fff6df;
  color: #8a6424;
}

.tone-enabled .identity-status {
  border-color: #bfd8c1;
  background: #e8f2e6;
  color: #3f7a4d;
}

.identity-action {
  gap: 5px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
}

.identity-action.primary {
  border-color: var(--console-accent, #be5630);
  background: var(--console-accent, #be5630);
  color: #fffdfa;
}

.identity-action:hover:not(:disabled),
.identity-icon-button:hover:not(:disabled) {
  border-color: var(--console-accent, #be5630);
  color: var(--console-accent, #be5630);
}

.identity-action.primary:hover:not(:disabled) {
  border-color: var(--console-accent-hover, #a8481f);
  background: var(--console-accent-hover, #a8481f);
  color: #fffdfa;
}

.identity-action:disabled,
.identity-icon-button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.identity-action:focus-visible,
.identity-icon-button:focus-visible,
.identity-popover button:focus-visible,
.identity-popover input:focus-visible,
.identity-popover select:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.identity-icon-button {
  width: 34px;
  padding: 0;
  border-radius: 8px;
  cursor: pointer;
}

.identity-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  stroke-width: 1.9;
}

.spinning {
  animation: spin .8s linear infinite;
}

.identity-message,
.identity-info,
.identity-error {
  max-width: 130px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-message {
  color: #3f7a4d;
}

.identity-info {
  color: var(--console-text-muted, #9a8e7e);
}

.identity-error,
.popover-error {
  color: var(--app-danger, #b73524);
}

.identity-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: min(420px, calc(100vw - 32px));
  padding: 12px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 10px;
  background: var(--console-paper, #fffdfa);
  box-shadow: var(--console-shadow, 0 14px 30px -18px rgba(80, 50, 25, .4));
}

.identity-popover header,
.identity-popover footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.identity-popover header {
  margin-bottom: 10px;
}

.identity-popover strong {
  color: var(--console-text, #211d17);
  font-size: 13px;
}

.identity-popover header button {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--console-text-muted, #9a8e7e);
  cursor: pointer;
}

.identity-popover header button:hover {
  background: var(--console-accent-soft, #f6e3d7);
  color: var(--console-accent, #be5630);
}

.identity-popover label {
  display: grid;
  gap: 5px;
  margin-bottom: 9px;
  color: var(--console-text-muted, #9a8e7e);
  font-size: 11px;
}

.identity-popover input,
.identity-popover select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 8px;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-soft, #5a5247);
  font: inherit;
  font-size: 12px;
}

.popover-error {
  margin: 0 0 9px;
  font-size: 11px;
}

.identity-note {
  margin: 0 0 9px;
  color: var(--console-text-soft, #5a5247);
  font-size: 12px;
  line-height: 1.45;
}

.identity-popover footer {
  justify-content: flex-end;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .story-identity {
    width: 100%;
    flex-wrap: wrap;
  }

  .identity-status {
    flex: 1;
  }

  .identity-popover {
    left: 0;
    right: auto;
  }
}
</style>
