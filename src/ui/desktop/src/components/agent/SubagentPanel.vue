<script setup lang="ts">
import { computed, watch } from 'vue'
import { Close, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { canStopSubagent, useSubagentStore } from '../../stores/subagents'
import { localizeSubagentActivityTitle, subagentTimelineSegments } from '../../utils/subagentTimeline.ts'
import TurnSegment from '../TurnSegment.vue'
import type { SessionSubagentActivity, SessionSubagentItem, SessionSubagentStatus } from '@contract/types'
import { useI18n } from '../../i18n'
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error'

const props = defineProps<{ sessionId: string | null | undefined }>()

const subagents = useSubagentStore()
const { language, t } = useI18n()
const items = computed(() => subagents.itemsFor(props.sessionId))
const loading = computed(() => subagents.loadingFor(props.sessionId))
const error = computed(() => {
  const value = subagents.errorFor(props.sessionId)
  return value ? formatUserFacingErrorMessage(value, 'general', language.value) : ''
})

function refresh(): void {
  if (!props.sessionId) return
  void subagents.loadFromBackend(props.sessionId)
}

watch(
  () => props.sessionId,
  (sessionId) => {
    if (sessionId) void subagents.loadFromBackend(sessionId)
  },
  { immediate: true },
)

function statusText(status: SessionSubagentStatus): string {
  if (status === 'running') return t('subagent.status.running')
  if (status === 'completed') return t('subagent.status.completed')
  if (status === 'failed') return t('subagent.status.failed')
  if (status === 'stopped') return t('subagent.status.stopped')
  if (status === 'timeout') return t('subagent.status.timeout')
  if (status === 'not_ready') return t('subagent.status.notReady')
  return t('subagent.status.unknown')
}

function latestActivity(item: SessionSubagentItem): SessionSubagentActivity | null {
  const activity = item.activity || []
  return activity.length ? activity[activity.length - 1] : null
}

function recentAction(item: SessionSubagentItem): string {
  const latest = latestActivity(item)
  if (latest?.title) return localizeSubagentActivityTitle(latest.title, language.value)
  if (item.error) return formatUserFacingErrorMessage(item.error, 'general', language.value)
  if (item.output) return t('subagent.output')
  if (item.outputFile) return t('subagent.outputFile')
  return item.updatedAt ? t('subagent.updated') : ''
}

function hasDetails(item: SessionSubagentItem): boolean {
  return subagentTimelineSegments(item, language.value).length > 0
}

async function stop(item: SessionSubagentItem): Promise<void> {
  if (!props.sessionId) return
  try {
    const result = await subagents.stop(props.sessionId, item)
    if (!result.ok) {
      ElMessage.error(result.reason ? formatUserFacingErrorMessage(result.reason, 'general', language.value) : t('subagent.stopFailed'))
      return
    }
    ElMessage.success(t('subagent.stopRequested'))
  } catch (err) {
    ElMessage.error(formatUserFacingErrorMessage(err, 'general', language.value))
  }
}
</script>

<template>
  <div class="subagent-panel">
    <div class="sp-toolbar">
      <span class="sp-state" :class="{ error: !!error }">
        {{ loading ? t('subagent.loading') : error || (items.length ? t('subagent.count', { count: items.length }) : '') }}
      </span>
      <button type="button" class="sp-icon-button" :title="t('subagent.refresh')" :disabled="!sessionId || loading" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <div v-if="items.length" class="sp-list">
      <details v-for="item in items" :key="item.id" class="sp-item">
        <summary class="sp-summary">
          <span class="sp-caret" aria-hidden="true"></span>
          <span class="sp-head">
            <span class="sp-row">
              <strong class="sp-title">{{ item.description || item.id }}</strong>
              <span class="sp-badge" :class="item.status">{{ statusText(item.status) }}</span>
            </span>
            <span v-if="recentAction(item)" class="sp-recent">{{ recentAction(item) }}</span>
          </span>
          <button
            v-if="canStopSubagent(item)"
            type="button"
            class="sp-stop"
            :title="t('subagent.stop')"
            :disabled="!!item.stopRequestId"
            @click.stop.prevent="stop(item)"
          >
            <el-icon><Close /></el-icon>
          </button>
        </summary>

        <div v-if="hasDetails(item)" class="sp-details">
          <TurnSegment
            v-for="segment in subagentTimelineSegments(item, language)"
            :key="segment.id"
            :segment="segment"
          />
        </div>
        <p v-else class="sp-empty-detail">{{ t('subagent.emptyDetail') }}</p>
      </details>
    </div>

    <p v-else class="sp-empty">{{ t('subagent.empty') }}</p>
  </div>
</template>

<style scoped>
.subagent-panel {
  padding: 8px 10px 12px;
}

.sp-toolbar {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
}

.sp-state {
  min-width: 0;
  font-size: 11.5px;
  color: var(--app-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-state.error,
.sp-error {
  color: var(--app-danger);
}

.sp-icon-button,
.sp-stop {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.sp-icon-button {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
}

.sp-stop {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}

.sp-icon-button:hover:not(:disabled),
.sp-stop:hover:not(:disabled) {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
}

.sp-icon-button:disabled,
.sp-stop:disabled {
  opacity: 0.45;
  cursor: default;
}

.sp-icon-button :deep(svg),
.sp-stop :deep(svg) {
  width: 13px;
  height: 13px;
}

.sp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-item {
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
}

.sp-summary {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 7px 8px;
  border-radius: var(--app-radius-md);
  cursor: pointer;
  list-style: none;
  transition:
    color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease);
}

.sp-summary::-webkit-details-marker {
  display: none;
}

.sp-caret {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--app-ink-muted);
  transform-origin: 45% 50%;
  transition: transform 120ms ease;
}

.sp-item[open] .sp-caret {
  transform: rotate(90deg);
}

.sp-summary:hover,
.sp-item[open] .sp-summary {
  background: var(--app-bg-soft);
}

.sp-head {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sp-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sp-title {
  min-width: 0;
  flex: 1;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--app-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-recent {
  min-width: 0;
  color: var(--app-ink-muted);
  font-size: 11.5px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-badge {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--app-ink-muted);
}

.sp-badge.running,
.sp-badge.not_ready {
  color: var(--app-accent);
}

.sp-badge.completed {
  color: var(--app-success);
}

.sp-badge.failed,
.sp-badge.timeout {
  color: var(--app-danger);
}

.sp-error,
.sp-meta,
.sp-empty,
.sp-empty-detail {
  margin: 0;
  font-size: 12px;
}

.sp-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 4px 12px 26px;
  border-left: 2px solid var(--app-border);
  margin-left: 13px;
}

.sp-error,
.sp-meta {
  margin-top: 6px;
  line-height: 1.45;
  word-break: break-word;
}

.sp-meta {
  color: var(--app-ink-muted);
}

.sp-empty,
.sp-empty-detail {
  color: var(--app-ink-muted);
}

.sp-empty-detail {
  padding: 0 8px 8px 26px;
}
</style>
