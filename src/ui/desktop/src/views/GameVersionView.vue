<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'

import type {
  GameReleaseConfig,
  GameReleaseManagedChange,
  GameReleaseStatus,
  SaveCompatibilityAction,
  SaveCompatibilityKind,
} from '@contract/game-release'
import { gameRelease } from '../api/client'
import { useI18n, type MessageKey } from '../i18n'
import { useProjectStore } from '../stores/project'
import { cloneDraft } from '../utils/clone-draft'
import { registerProductPluginLifecycleGuard } from '../utils/productPluginLifecycle'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'

const projectStore = useProjectStore()
const { language, t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const testingUpdateIndex = ref(false)
const error = ref('')
const updateIndexMessage = ref('')
const advanced = ref(false)
const status = ref<GameReleaseStatus | null>(null)
const form = ref<GameReleaseConfig | null>(null)
const savedForm = ref<GameReleaseConfig | null>(null)
const managedChanges = ref<GameReleaseManagedChange[]>([])
const previewError = ref('')
let previewRequestId = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined
let unregisterLifecycle: (() => void) | null = null
let loadRequestId = 0

const saveKinds: SaveCompatibilityKind[] = ['legacy', 'older', 'same', 'newer', 'differentChannel']
const actions: SaveCompatibilityAction[] = ['allow', 'warn', 'block', 'callback']
const hasProject = computed(() => Boolean(projectStore.currentProject))
const insecureUpdateUrl = computed(() => form.value?.update.indexUrl.trim().startsWith('http:'))
const dirty = computed(() => Boolean(
  form.value
  && savedForm.value
  && JSON.stringify(form.value) !== JSON.stringify(savedForm.value),
))

watch(() => projectStore.currentProject, () => void load(), { immediate: true })
onActivated(() => void refreshOnActivation())

async function refreshOnActivation() {
  if (loading.value || dirty.value || saving.value || testingUpdateIndex.value) return
  const project = projectStore.currentProject
  const requestId = loadRequestId
  if (!project) return
  try {
    const next = await gameRelease.status(project)
    if (requestId !== loadRequestId || projectStore.currentProject !== project || dirty.value || saving.value || testingUpdateIndex.value) return
    if (next.sourceHash !== status.value?.sourceHash) await load()
    else managedChanges.value = next.managedChanges
  } catch (cause) {
    if (requestId === loadRequestId && projectStore.currentProject === project) error.value = operationError('gameVersion.error.load', cause)
  }
}
watch(() => JSON.stringify(form.value), () => {
  clearTimeout(previewTimer)
  previewRequestId += 1
  managedChanges.value = []
  previewError.value = ''
  if (form.value && !saving.value) previewTimer = setTimeout(() => void refreshManagedChanges(), 150)
})

async function refreshManagedChanges() {
  const project = projectStore.currentProject
  const draft = form.value && cloneDraft(form.value)
  const requestId = ++previewRequestId
  if (!project || !draft) return
  try {
    const next = await gameRelease.status(project, draft)
    if (requestId !== previewRequestId || projectStore.currentProject !== project) return
    managedChanges.value = next.managedChanges
  } catch (cause) {
    if (requestId === previewRequestId && projectStore.currentProject === project) {
      previewError.value = operationError('gameVersion.error.preview', cause)
    }
  }
}

onMounted(() => {
  unregisterLifecycle = registerProductPluginLifecycleGuard('game-version', {
    isDirty: () => dirty.value,
    save: () => save(false),
    discard: discardDraft,
  })
})

onUnmounted(() => {
  clearTimeout(previewTimer)
  previewRequestId += 1
  unregisterLifecycle?.()
  unregisterLifecycle = null
})

async function load(): Promise<boolean> {
  clearTimeout(previewTimer)
  previewRequestId += 1
  const requestId = ++loadRequestId
  const project = projectStore.currentProject
  status.value = null
  form.value = null
  savedForm.value = null
  error.value = ''
  updateIndexMessage.value = ''
  saving.value = false
  testingUpdateIndex.value = false
  if (!project) return true
  loading.value = true
  try {
    const next = await gameRelease.status(project)
    if (requestId !== loadRequestId || projectStore.currentProject !== project) return false
    status.value = next
    form.value = cloneDraft(next.config)
    savedForm.value = cloneDraft(next.config)
    managedChanges.value = next.managedChanges
    advanced.value = next.config.update.enabled
    return true
  } catch (cause) {
    if (requestId === loadRequestId && projectStore.currentProject === project) {
      error.value = operationError('gameVersion.error.load', cause)
    }
    return false
  } finally {
    if (requestId === loadRequestId && projectStore.currentProject === project) loading.value = false
  }
}

function compatibilityMessage(kind: SaveCompatibilityKind): string {
  return form.value?.saveCompatibility.messages?.[kind] || ''
}

function setCompatibilityMessage(kind: SaveCompatibilityKind, value: string) {
  if (!form.value) return
  const messages = { ...(form.value.saveCompatibility.messages || {}) }
  if (value.trim()) messages[kind] = value
  else delete messages[kind]
  if (Object.keys(messages).length) form.value.saveCompatibility.messages = messages
  else delete form.value.saveCompatibility.messages
}

function showMessageField(kind: SaveCompatibilityKind): boolean {
  const action = form.value?.saveCompatibility[kind]
  return action === 'warn' || action === 'block'
}

function setUpdateEnabled(enabled: boolean) {
  if (!form.value) return
  form.value.update.enabled = enabled
  if (!enabled && form.value.update.manifestSignature) {
    form.value.update.manifestSignature.enabled = false
  }
}

function setCheckOnStart(enabled: boolean) {
  if (!form.value) return
  form.value.update.checkOnStart = enabled
  if (!enabled) form.value.update.backgroundDownload = false
}

async function save(confirmWrite = true): Promise<boolean> {
  const requestId = loadRequestId
  const project = projectStore.currentProject
  if (!project || !form.value || !status.value || saving.value || testingUpdateIndex.value) return false
  const draft = cloneDraft(form.value)
  const expectedSourceHash = status.value.sourceHash
  if (confirmWrite) {
    try {
      await ElMessageBox.confirm(
        t('gameVersion.confirm.detail'),
        t('gameVersion.confirm.title'),
        { confirmButtonText: t('gameVersion.save'), cancelButtonText: t('ui.cancel'), type: 'warning' },
      )
    } catch {
      return false
    }
  }
  if (requestId !== loadRequestId || projectStore.currentProject !== project) return false
  saving.value = true
  error.value = ''
  try {
    const saved = await gameRelease.save({
      config: draft,
      expectedSourceHash,
      installRuntimePlugins: true,
    }, project)
    if (requestId !== loadRequestId || projectStore.currentProject !== project) return false
    status.value = saved
    form.value = cloneDraft(saved.config)
    savedForm.value = cloneDraft(saved.config)
    managedChanges.value = saved.managedChanges
    ElMessage.success(t('gameVersion.saved'))
    return true
  } catch (cause) {
    if (requestId === loadRequestId && projectStore.currentProject === project) {
      error.value = operationError('gameVersion.error.save', cause)
      ElMessage.error(error.value)
    }
    return false
  } finally {
    if (requestId === loadRequestId && projectStore.currentProject === project) saving.value = false
  }
}

function discardDraft(): boolean {
  if (savedForm.value) form.value = cloneDraft(savedForm.value)
  error.value = ''
  updateIndexMessage.value = ''
  return true
}

async function testUpdateIndex() {
  const requestId = loadRequestId
  const project = projectStore.currentProject
  if (!project || !form.value || testingUpdateIndex.value || saving.value) return
  testingUpdateIndex.value = true
  error.value = ''
  updateIndexMessage.value = ''
  try {
    const tested = await gameRelease.testUpdateIndex(cloneDraft(form.value), project)
    if (requestId !== loadRequestId || projectStore.currentProject !== project) return
    updateIndexMessage.value = tested.latestVersion
      ? t('gameVersion.indexTestAvailable', { version: tested.latestVersion })
      : t('gameVersion.indexTestCurrent')
    ElMessage.success(t('gameVersion.indexTestPassed'))
  } catch (cause) {
    if (requestId === loadRequestId && projectStore.currentProject === project) {
      error.value = operationError('gameVersion.error.indexTest', cause)
      ElMessage.error(error.value)
    }
  } finally {
    if (requestId === loadRequestId && projectStore.currentProject === project) testingUpdateIndex.value = false
  }
}

function operationError(key: MessageKey, value: unknown): string {
  const detail = formatUserFacingErrorMessage(value, 'general', language.value)
  return t(key, { message: detail })
}
</script>

<template>
  <main class="release-page" data-ui-id="game-version-page">
    <header class="page-header">
      <div>
        <h1>{{ t('gameVersion.title') }}</h1>
        <p v-if="status" class="source-path">{{ status.relativePath }}</p>
      </div>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!form || loading || testingUpdateIndex"
        data-ui-id="game-version-save"
        @click="save"
      >
        {{ t('gameVersion.save') }}
      </el-button>
    </header>

    <div v-if="!hasProject" class="empty-state">{{ t('gameVersion.noProject') }}</div>
    <div v-else-if="loading" class="empty-state"><el-icon class="is-loading"><Loading /></el-icon></div>
    <el-alert v-else-if="error && !form" :title="error" type="error" :closable="false" show-icon />

    <el-scrollbar v-else-if="form" class="page-scroll">
      <el-form label-position="top" class="release-form" :disabled="saving || testingUpdateIndex" @submit.prevent>
        <el-alert v-if="error || previewError" class="page-error" :title="error || previewError" type="error" show-icon @close="error = ''; previewError = ''" />
        <section class="form-section form-section-primary">
          <el-form-item :label="t('gameVersion.version')">
            <el-input v-model="form.version" data-ui-id="game-version-value" placeholder="1.0.0-beta.1" />
          </el-form-item>
          <el-form-item :label="t('gameVersion.channel')">
            <el-input v-model="form.channel" data-ui-id="game-version-channel" placeholder="stable" />
          </el-form-item>
          <el-form-item :label="t('gameVersion.gameId')">
            <el-input v-model="form.gameId" data-ui-id="game-version-game-id" />
          </el-form-item>
        </section>

        <section class="form-section">
          <div class="section-heading">
            <h2>{{ t('gameVersion.saveCompatibility') }}</h2>
          </div>
          <div class="policy-list">
            <div v-for="kind in saveKinds" :key="kind" class="policy-row">
              <span>{{ t(`gameVersion.saveKind.${kind}`) }}</span>
              <el-select v-model="form.saveCompatibility[kind]" :data-ui-id="`game-version-policy-${kind}`">
                <el-option v-for="action in actions" :key="action" :value="action" :label="t(`gameVersion.action.${action}`)" />
              </el-select>
              <el-input
                v-if="showMessageField(kind)"
                :model-value="compatibilityMessage(kind)"
                :placeholder="t('gameVersion.messagePlaceholder')"
                @update:model-value="setCompatibilityMessage(kind, String($event))"
              />
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="switch-row">
            <div>
              <h2>{{ t('gameVersion.onlineUpdate') }}</h2>
              <span>{{ form.update.enabled ? t('gameVersion.updateEnabled') : t('gameVersion.updateDisabled') }}</span>
            </div>
            <el-switch
              :model-value="form.update.enabled"
              data-ui-id="game-version-update-enabled"
              @update:model-value="setUpdateEnabled(Boolean($event))"
            />
          </div>
          <el-button v-if="form.update.enabled" text class="advanced-toggle" @click="advanced = !advanced">
            {{ advanced ? t('gameVersion.hideAdvanced') : t('gameVersion.showAdvanced') }}
          </el-button>
          <div v-if="form.update.enabled && advanced" class="advanced-fields">
            <el-form-item :label="t('gameVersion.indexUrl')">
              <div class="index-url-line">
                <el-input v-model="form.update.indexUrl" data-ui-id="game-version-index-url" placeholder="https://example.com/releases.json" />
                <el-button
                  :loading="testingUpdateIndex"
                  :disabled="!form.update.indexUrl.trim()"
                  data-ui-id="game-version-test-index"
                  @click="testUpdateIndex"
                >{{ t('gameVersion.testIndex') }}</el-button>
              </div>
            </el-form-item>
            <el-alert
              v-if="insecureUpdateUrl"
              :title="t('gameVersion.httpWarning')"
              type="warning"
              :closable="false"
              show-icon
            />
            <el-alert v-if="updateIndexMessage" :title="updateIndexMessage" type="success" show-icon @close="updateIndexMessage = ''" />
            <p class="runtime-note">{{ t('gameVersion.runtimeUpdateNote') }}</p>
            <div class="update-options">
              <div class="update-toggle-list">
                <el-checkbox
                  :model-value="form.update.checkOnStart"
                  @update:model-value="setCheckOnStart(Boolean($event))"
                >{{ t('gameVersion.checkOnStart') }}</el-checkbox>
                <el-checkbox
                  v-model="form.update.backgroundDownload"
                  :disabled="!form.update.checkOnStart"
                >{{ t('gameVersion.backgroundDownload') }}</el-checkbox>
              </div>
              <el-form-item class="update-policy" :label="t('gameVersion.updatePolicy')">
                <el-radio-group v-model="form.update.policy">
                  <el-radio value="optional">{{ t('gameVersion.optionalUpdate') }}</el-radio>
                  <el-radio value="required">{{ t('gameVersion.requiredUpdate') }}</el-radio>
                </el-radio-group>
              </el-form-item>
            </div>
          </div>
        </section>

        <section v-if="managedChanges.length" class="managed-changes">
          <h2>{{ t('gameVersion.pendingFiles') }}</h2>
          <p>{{ t('gameVersion.pendingFilesNote') }}</p>
          <div v-for="change in managedChanges" :key="change.relativePath" class="managed-change">
            <code>{{ change.relativePath }}</code>
            <span>{{ change.kind === 'create' ? t('gameVersion.create') : t('gameVersion.update') }}</span>
          </div>
        </section>
      </el-form>
    </el-scrollbar>
  </main>
</template>

<style scoped>
.release-page {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
}

.page-header {
  min-height: 64px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--app-border);
}

h1, h2, p { margin: 0; }
h1 { font-size: 18px; color: var(--app-ink); }
h2 { font-size: 14px; color: var(--app-ink); }
.source-path { margin-top: 4px; color: var(--app-ink-muted); font: 11px var(--app-font-mono); }
.page-scroll { min-height: 0; flex: 1; }
.release-form { width: min(760px, calc(100% - 40px)); margin: 20px auto 36px; }
.page-error { margin-bottom: 14px; }
.form-section { padding: 18px; margin-bottom: 14px; border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); background: var(--app-bg-elevated); }
.form-section-primary { display: grid; grid-template-columns: 1.15fr .75fr 1fr; gap: 14px; }
.form-section-primary :deep(.el-form-item) { margin-bottom: 0; }
.section-heading { margin-bottom: 12px; }
.policy-list { display: grid; gap: 10px; }
.policy-row { display: grid; grid-template-columns: minmax(145px, 1fr) 150px minmax(220px, 1.8fr); gap: 12px; align-items: center; }
.policy-row > span { color: var(--app-ink-soft); font-size: 13px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; }
.switch-row span { display: block; margin-top: 4px; color: var(--app-ink-muted); font-size: 12px; }
.advanced-toggle { margin-top: 8px; padding-left: 0; }
.advanced-fields { margin-top: 10px; display: grid; gap: 10px; }
.index-url-line { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.runtime-note { color: var(--app-ink-muted); font-size: 12px; line-height: 1.5; }
.update-options { display: grid; grid-template-columns: minmax(0, 1fr) minmax(210px, auto); gap: 14px 24px; align-items: start; }
.update-toggle-list { min-width: 0; display: grid; gap: 8px; }
.update-toggle-list :deep(.el-checkbox) { height: auto; margin-right: 0; white-space: normal; }
.update-policy { margin-bottom: 0; }
.update-policy :deep(.el-form-item__content), .update-policy :deep(.el-radio-group) { display: grid; gap: 8px; }
.update-policy :deep(.el-radio) { height: auto; margin-right: 0; white-space: normal; }
.managed-changes { padding: 14px 18px; border-radius: var(--app-radius-lg); background: var(--app-accent-soft); }
.managed-changes h2 { margin-bottom: 8px; }
.managed-changes p { margin-bottom: 8px; color: var(--app-ink-muted); font-size: 12px; line-height: 1.5; }
.managed-change { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; color: var(--app-ink-soft); font-size: 12px; }
.managed-change code { overflow: hidden; text-overflow: ellipsis; color: var(--app-ink); }
.empty-state { flex: 1; display: grid; place-items: center; color: var(--app-ink-muted); }

@media (max-width: 900px) {
  .form-section-primary, .policy-row { grid-template-columns: 1fr; }
  .update-options { grid-template-columns: 1fr; }
}
</style>
