<script setup lang="ts">
import { computed, watch } from 'vue'
import { Close, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useSubagentStore } from '../../stores/subagents'
import { subagentTimelineSegments } from '../../utils/subagentTimeline.ts'
import TurnSegment from '../TurnSegment.vue'
import type { SessionSubagentActivity, SessionSubagentItem, SessionSubagentStatus } from '@contract/types'

const props = defineProps<{ sessionId: string | null | undefined }>()

const subagents = useSubagentStore()
const items = computed(() => subagents.itemsFor(props.sessionId))
const loading = computed(() => subagents.loadingFor(props.sessionId))
const error = computed(() => subagents.errorFor(props.sessionId))

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
  if (status === 'running') return '运行中'
  if (status === 'completed') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已停止'
  if (status === 'timeout') return '超时'
  if (status === 'not_ready') return '未就绪'
  return '未知'
}

function canStop(item: SessionSubagentItem): boolean {
  return item.status === 'running' || item.status === 'not_ready' || item.status === 'unknown'
}

function latestActivity(item: SessionSubagentItem): SessionSubagentActivity | null {
  const activity = item.activity || []
  return activity.length ? activity[activity.length - 1] : null
}

function recentAction(item: SessionSubagentItem): string {
  const latest = latestActivity(item)
  if (latest?.title) return latest.title
  if (item.error) return item.error
  if (item.output) return '已有输出'
  if (item.outputFile) return '已有输出文件'
  return item.updatedAt ? '状态已更新' : ''
}

function hasDetails(item: SessionSubagentItem): boolean {
  return subagentTimelineSegments(item).length > 0
}

async function stop(item: SessionSubagentItem): Promise<void> {
  if (!props.sessionId) return
  try {
    const result = await subagents.stop(props.sessionId, item)
    if (!result.ok) {
      ElMessage.error(result.reason || '停止 subagent 失败')
      return
    }
    ElMessage.success('已请求停止 subagent')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '停止 subagent 失败')
  }
}
</script>

<template>
  <div class="subagent-panel">
    <div class="sp-toolbar">
      <span class="sp-state" :class="{ error: !!error }">
        {{ loading ? '读取中…' : error || (items.length ? `${items.length} 个 subagent` : '') }}
      </span>
      <button type="button" class="sp-icon-button" title="刷新" :disabled="!sessionId || loading" @click="refresh">
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
            v-if="canStop(item)"
            type="button"
            class="sp-stop"
            title="停止"
            :disabled="!!item.stopRequestId"
            @click.stop.prevent="stop(item)"
          >
            <el-icon><Close /></el-icon>
          </button>
        </summary>

        <div v-if="hasDetails(item)" class="sp-details">
          <TurnSegment
            v-for="segment in subagentTimelineSegments(item)"
            :key="segment.id"
            :segment="segment"
          />
        </div>
        <p v-else class="sp-empty-detail">暂无明细</p>
      </details>
    </div>

    <p v-else class="sp-empty">暂无 subagent。Agent 调用 opencode subagent 工具后会显示在这里。</p>
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
