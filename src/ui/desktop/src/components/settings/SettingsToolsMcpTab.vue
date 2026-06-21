<template>
  <div class="capabilities-tab">
    <h3>{{ t('settings.toolsMcp.title') }}</h3>
    <p class="desc">{{ t('settings.toolsMcp.description') }}</p>

    <div v-if="store.lastError" class="alert alert-error">
      <span class="alert-icon">!</span> {{ store.lastError }}
    </div>

    <div class="meta-bar">
      <span v-if="engineLabel" class="pill pill-info">{{ t('settings.toolsMcp.engine') }}: {{ engineLabel }}</span>
      <button class="workbench-button" :disabled="loading" @click="reload">
        {{ loading ? t('settings.toolsMcp.loading') : t('settings.toolsMcp.refresh') }}
      </button>
    </div>

    <div class="alert alert-info">
      <span class="alert-icon">i</span>
      {{ t('settings.toolsMcp.policyHint') }}
    </div>

    <section class="cap-section">
      <div class="section-head">
        <h4>{{ t('settings.toolsMcp.capabilities') }}</h4>
        <span class="section-hint">{{ t('settings.toolsMcp.toggleHint') }}</span>
      </div>

      <div v-for="group in toolGroups" :key="group.layer" class="tool-group">
        <div class="group-title">{{ group.label }}</div>
        <div v-for="tool in group.items" :key="tool.id" class="tool-row" :class="{ 'is-unavailable': !tool.available }">
          <div class="tool-main">
            <div class="tool-title">
              <span>{{ tool.title }}</span>
              <span v-if="tool.readOnly" class="pill pill-sm pill-info">{{ t('settings.toolsMcp.readOnly') }}</span>
              <span
                v-for="badge in toolRiskBadges(tool)"
                :key="badge"
                class="pill pill-sm"
                :class="riskBadgeClass(badge)"
              >
                {{ riskBadgeLabel(badge) }}
              </span>
              <span v-if="!tool.available" class="pill pill-sm pill-muted">{{ t('settings.toolsMcp.unavailable') }}</span>
              <span v-else-if="tool.requiresNewSession" class="pill pill-sm pill-muted">{{ t('settings.toolsMcp.nextSession') }}</span>
              <span v-if="tool.warning" class="pill pill-sm pill-warn">{{ t('settings.toolsMcp.configMismatch') }}</span>
            </div>
            <div class="tool-desc">{{ tool.description }}</div>
            <div v-if="tool.disabledReason" class="tool-disabled">{{ tool.disabledReason }}</div>
            <div v-if="tool.warning" class="tool-warn">{{ tool.warning }}</div>
            <div class="tool-meta mono">{{ tool.id }}</div>
          </div>
          <label
            class="toggle"
            :class="{ 'is-loading': toggleLoading === tool.id, 'is-disabled': !tool.toggleable }"
            :title="tool.toggleable ? t('settings.toolsMcp.newSessionsOnly') : (tool.disabledReason || t('settings.toolsMcp.cannotToggle'))"
          >
            <input
              type="checkbox"
              :checked="tool.allowed"
              :disabled="toggleLoading === tool.id || !tool.toggleable"
              @change="onToggleTool(tool.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
        </div>
      </div>
    </section>

    <!-- Toast notifications -->
    <Teleport to="body">
      <div class="toast-stack">
        <TransitionGroup name="toast">
          <div v-for="toastItem in toasts" :key="toastItem.id" class="toast-item" :class="'toast-' + toastItem.type">
            {{ toastItem.message }}
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { CapabilityToolEntry } from '../../api/client'
import { useI18n } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import { buildSettingsToolGroups } from '../../utils/settingsToolGroups'

const props = defineProps<{
  engine?: string | null
}>()

const store = useSettingsStore()
const { language, t } = useI18n()
const loading = ref(false)
const toggleLoading = ref<string | null>(null)

/* ---- Toast system (replaces ElMessage) ---- */
type ToastType = 'success' | 'error' | 'warn' | 'info'
const toasts = ref<Array<{ id: number; type: ToastType; message: string }>>([])
let _toastId = 0
function toast(type: ToastType, message: string) {
  const id = ++_toastId
  toasts.value.push({ id, type, message })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
}

const snapshot = computed(() => store.agentCapabilities)
const engineLabel = computed(() => props.engine || snapshot.value?.engine || null)

const toolGroups = computed(() => buildSettingsToolGroups(snapshot.value?.builtinTools || [], language.value))
const toolsById = computed(() => new Map((snapshot.value?.builtinTools || []).map((tool) => [tool.id, tool])))

type RiskBadge = 'high' | 'experimental'

function toolRiskBadges(tool: CapabilityToolEntry): RiskBadge[] {
  if (Array.isArray(tool.riskBadges) && tool.riskBadges.length > 0) {
    return tool.riskBadges
  }
  return tool.riskLevel === 'high' || tool.riskLevel === 'experimental' ? [tool.riskLevel] : []
}

function riskBadgeLabel(badge: RiskBadge): string {
  return badge === 'high' ? t('settings.toolsMcp.risk.high') : t('settings.toolsMcp.risk.experimental')
}

function riskBadgeClass(badge: RiskBadge): string {
  return badge === 'high' ? 'pill-danger' : 'pill-warn'
}

async function reload() {
  loading.value = true
  try {
    await store.loadAgentCapabilities()
  } catch {
    toast('error', t('settings.toolsMcp.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function onToggleTool(toolId: string, allowed: boolean) {
  const tool = toolsById.value.get(toolId)
  if (!tool?.toggleable) return
  if (allowed && tool.riskLevel !== 'normal') {
    const riskLabel = tool.riskLevel === 'high' ? t('settings.toolsMcp.riskLabel.high') : t('settings.toolsMcp.riskLabel.experimental')
    const ok = window.confirm(t('settings.toolsMcp.enableConfirm', { title: tool.title, risk: riskLabel }))
    if (!ok) return
  }
  toggleLoading.value = toolId
  try {
    await store.saveAgentToolAllow(toolId, allowed)
    toast('success', allowed
      ? t('settings.toolsMcp.enabled', { toolId })
      : t('settings.toolsMcp.disabled', { toolId }))
  } catch {
    toast('error', t('settings.toolsMcp.updateFailed', { toolId }))
  } finally {
    toggleLoading.value = null
  }
}

onMounted(() => {
  if (!store.agentCapabilities) reload()
})
</script>

<style scoped>
.capabilities-tab {
  padding: 0;
}

.capabilities-tab h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 650;
  color: var(--app-ink);
}

.capabilities-tab .desc {
  color: var(--app-ink-soft);
  margin: 0 0 16px;
  font-size: 13px;
}

/* Alert */
.alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--app-radius-sm);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.5;
}

.alert-icon {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
}

.alert-error {
  background: var(--app-danger-soft);
  color: var(--app-danger);
}

.alert-error .alert-icon {
  background: var(--app-danger);
  color: var(--app-bg);
}

.alert-info {
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.alert-info .alert-icon {
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

/* Meta bar */
.meta-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Pills (replace el-tag) */
.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: var(--app-radius-pill);
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--app-border);
  color: var(--app-ink-soft);
  background: var(--app-bg-soft);
  white-space: nowrap;
}

.pill-info {
  border-color: var(--app-accent);
  color: var(--app-accent);
  background: var(--app-accent-soft);
}

.pill-warn {
  border-color: var(--app-warn);
  color: var(--app-warn);
  background: var(--app-warn-soft);
}

.pill-danger {
  border-color: var(--app-danger);
  color: var(--app-danger);
  background: var(--app-danger-soft);
}

.pill-muted {
  border-color: var(--app-border);
  color: var(--app-ink-muted);
  background: var(--app-bg-soft);
}

.pill-sm {
  font-size: 11px;
  padding: 1px 7px;
}

/* Sections */
.cap-section {
  margin-bottom: 28px;
}

.section-head {
  margin-bottom: 12px;
}

.section-head h4 {
  margin: 0;
  font-size: 15px;
  color: var(--app-ink);
}

.section-hint {
  display: block;
  font-size: 12px;
  color: var(--app-ink-soft);
  margin-top: 4px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  margin: 12px 0 8px;
  color: var(--app-ink-soft);
}

/* Tool rows */
.tool-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  margin-bottom: 8px;
  background: var(--app-bg);
}

.tool-row:hover {
  background: var(--app-bg-sunken);
}

.tool-row.is-unavailable {
  opacity: 0.74;
}

.tool-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--app-ink);
}

.tool-desc,
.tool-meta,
.tool-warn,
.tool-disabled {
  font-size: 12px;
  color: var(--app-ink-soft);
  margin-top: 4px;
}

.tool-warn {
  color: var(--app-warn);
}

.tool-disabled {
  color: var(--app-ink-muted);
}

.mono {
  font-family: var(--app-font-mono);
}

/* Toggle switch (replaces el-switch) */
.toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle.is-loading {
  opacity: 0.5;
  pointer-events: none;
}

.toggle.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-pill);
  position: relative;
  transition: background var(--app-dur) var(--app-ease), border-color var(--app-dur) var(--app-ease);
}

.toggle-thumb {
  width: 14px;
  height: 14px;
  background: var(--app-ink-muted);
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--app-dur) var(--app-ease), background var(--app-dur) var(--app-ease);
}

.toggle input:checked + .toggle-track {
  background: var(--app-accent-soft);
  border-color: var(--app-accent);
}

.toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(16px);
  background: var(--app-accent);
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--app-ink-muted);
  font-size: 13px;
}

/* Toast stack */
.toast-stack {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  padding: 8px 16px;
  border-radius: var(--app-radius-sm);
  font-size: 13px;
  font-family: var(--app-font-mono);
  border: 1px solid;
  pointer-events: auto;
  max-width: 420px;
  line-height: 1.4;
}

.toast-success {
  background: var(--app-ok-soft);
  color: var(--app-ok);
  border-color: var(--app-ok);
}

.toast-error {
  background: var(--app-danger-soft);
  color: var(--app-danger);
  border-color: var(--app-danger);
}

.toast-warn {
  background: var(--app-warn-soft);
  color: var(--app-warn);
  border-color: var(--app-warn);
}

.toast-info {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  border-color: var(--app-accent);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
