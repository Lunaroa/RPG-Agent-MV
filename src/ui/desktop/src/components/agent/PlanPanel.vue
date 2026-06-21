<script setup lang="ts">
import { computed, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { renderMarkdown } from '../../utils/markdown'
import { useSessionPlanStore } from '../../stores/sessionPlan'
import { useI18n } from '../../i18n'
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error'

const props = defineProps<{ sessionId: string | null | undefined }>()

const planStore = useSessionPlanStore()
const { language, t } = useI18n()
const plan = computed(() => planStore.planFor(props.sessionId))
const loading = computed(() => planStore.loadingFor(props.sessionId))
const error = computed(() => planStore.errorFor(props.sessionId))
const displayError = computed(() => error.value ? formatUserFacingErrorMessage(error.value, 'general', language.value) : '')
const displayPlanError = computed(() => plan.value?.error ? formatUserFacingErrorMessage(plan.value.error, 'general', language.value) : '')
const displayFeedback = computed(() => plan.value?.feedback ? formatUserFacingErrorMessage(plan.value.feedback, 'general', language.value) : '')

const statusText = computed(() => {
  const mode = plan.value?.mode || 'idle'
  if (mode === 'planning') return t('plan.status.planning')
  if (mode === 'approval_requested') return t('plan.status.approvalRequested')
  if (mode === 'approved') return t('plan.status.approved')
  if (mode === 'rejected') return t('plan.status.rejected')
  if (mode === 'error') return t('plan.status.error')
  return ''
})

function refresh(): void {
  if (!props.sessionId) return
  void planStore.loadFromBackend(props.sessionId)
}

watch(
  () => props.sessionId,
  (sessionId) => {
    if (sessionId) void planStore.loadFromBackend(sessionId)
  },
  { immediate: true },
)
</script>

<template>
  <div class="plan-panel">
    <div class="pp-toolbar">
      <span class="pp-state" :class="{ error: plan?.mode === 'error' || !!error }">
        {{ loading ? t('plan.loading') : displayError || statusText }}
      </span>
      <button type="button" class="pp-refresh" :title="t('plan.refresh')" :disabled="!sessionId || loading" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <div v-if="plan?.planMarkdown" class="pp-markdown markdown-body" v-html="renderMarkdown(plan.planMarkdown)" />
    <p v-else class="pp-empty">{{ t('plan.empty') }}</p>
    <p v-if="displayFeedback" class="pp-feedback">{{ t('plan.feedback', { feedback: displayFeedback }) }}</p>
    <p v-if="displayPlanError" class="pp-error">{{ displayPlanError }}</p>
  </div>
</template>

<style scoped>
.plan-panel {
  padding: 8px 10px 12px;
}

.pp-toolbar {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
}

.pp-state {
  min-width: 0;
  font-size: 11.5px;
  color: var(--app-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-state.error,
.pp-error {
  color: var(--app-danger);
}

.pp-refresh {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.pp-refresh:hover:not(:disabled) {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
}

.pp-refresh:disabled {
  opacity: 0.45;
  cursor: default;
}

.pp-refresh :deep(svg) {
  width: 13px;
  height: 13px;
}

.pp-markdown {
  font-size: 13px;
  line-height: 1.6;
  color: var(--app-ink);
}

.pp-empty,
.pp-feedback,
.pp-error {
  margin: 0;
  font-size: 12px;
}

.pp-empty {
  color: var(--app-ink-muted);
}

.pp-feedback {
  margin-top: 10px;
  color: var(--app-ink);
}
</style>
