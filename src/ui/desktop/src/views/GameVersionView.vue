<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'

import type {
  GameReleaseConfig,
  GameReleaseStatus,
  SaveCompatibilityAction,
  SaveCompatibilityKind,
} from '@contract/game-release'
import { gameRelease } from '../api/client'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'

const projectStore = useProjectStore()
const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const advanced = ref(false)
const status = ref<GameReleaseStatus | null>(null)
const form = ref<GameReleaseConfig | null>(null)

const saveKinds: SaveCompatibilityKind[] = ['legacy', 'older', 'same', 'newer', 'differentChannel']
const actions: SaveCompatibilityAction[] = ['allow', 'warn', 'block', 'callback']
const hasProject = computed(() => Boolean(projectStore.currentProject))
const insecureUpdateUrl = computed(() => form.value?.update.indexUrl.trim().startsWith('http:'))

watch(() => projectStore.currentProject, () => void load(), { immediate: true })

async function load() {
  const project = projectStore.currentProject
  status.value = null
  form.value = null
  error.value = ''
  if (!project) return
  loading.value = true
  try {
    const next = await gameRelease.status(project)
    if (projectStore.currentProject !== project) return
    status.value = next
    form.value = structuredClone(next.config)
    advanced.value = next.config.update.enabled
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    if (projectStore.currentProject === project) loading.value = false
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

async function save() {
  const project = projectStore.currentProject
  if (!project || !form.value || !status.value) return
  try {
    await ElMessageBox.confirm(
      t('gameVersion.confirm.detail'),
      t('gameVersion.confirm.title'),
      { confirmButtonText: t('gameVersion.save'), cancelButtonText: t('ui.cancel'), type: 'warning' },
    )
  } catch {
    return
  }
  saving.value = true
  error.value = ''
  try {
    const saved = await gameRelease.save({
      config: structuredClone(form.value),
      expectedSourceHash: status.value.sourceHash,
      installRuntimePlugins: true,
    }, project)
    if (projectStore.currentProject !== project) return
    status.value = saved
    form.value = structuredClone(saved.config)
    ElMessage.success(t('gameVersion.saved'))
  } catch (cause) {
    error.value = errorText(cause)
    ElMessage.error(error.value)
  } finally {
    if (projectStore.currentProject === project) saving.value = false
  }
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
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
        :disabled="!form || loading"
        data-ui-id="game-version-save"
        @click="save"
      >
        {{ t('gameVersion.save') }}
      </el-button>
    </header>

    <div v-if="!hasProject" class="empty-state">{{ t('gameVersion.noProject') }}</div>
    <div v-else-if="loading" class="empty-state"><el-icon class="is-loading"><Loading /></el-icon></div>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon />

    <el-scrollbar v-else-if="form" class="page-scroll">
      <el-form label-position="top" class="release-form" @submit.prevent>
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
              <el-input v-model="form.update.indexUrl" data-ui-id="game-version-index-url" placeholder="https://example.com/releases.json" />
            </el-form-item>
            <el-alert
              v-if="insecureUpdateUrl"
              :title="t('gameVersion.httpWarning')"
              type="warning"
              :closable="false"
              show-icon
            />
            <div class="inline-options">
              <el-checkbox
                :model-value="form.update.checkOnStart"
                @update:model-value="setCheckOnStart(Boolean($event))"
              >{{ t('gameVersion.checkOnStart') }}</el-checkbox>
              <el-checkbox
                v-model="form.update.backgroundDownload"
                :disabled="!form.update.checkOnStart"
              >{{ t('gameVersion.backgroundDownload') }}</el-checkbox>
              <el-radio-group v-model="form.update.policy">
                <el-radio-button value="optional">{{ t('gameVersion.optionalUpdate') }}</el-radio-button>
                <el-radio-button value="required">{{ t('gameVersion.requiredUpdate') }}</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </section>

        <section v-if="status?.managedChanges.length" class="managed-changes">
          <h2>{{ t('gameVersion.pendingFiles') }}</h2>
          <div v-for="change in status.managedChanges" :key="change.relativePath" class="managed-change">
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
.inline-options { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.managed-changes { padding: 14px 18px; border-radius: var(--app-radius-lg); background: var(--app-accent-soft); }
.managed-changes h2 { margin-bottom: 8px; }
.managed-change { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; color: var(--app-ink-soft); font-size: 12px; }
.managed-change code { overflow: hidden; text-overflow: ellipsis; color: var(--app-ink); }
.empty-state { flex: 1; display: grid; place-items: center; color: var(--app-ink-muted); }

@media (max-width: 900px) {
  .form-section-primary, .policy-row { grid-template-columns: 1fr; }
  .inline-options { align-items: flex-start; flex-direction: column; }
}
</style>
