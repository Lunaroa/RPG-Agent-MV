<script setup lang="ts">
import { computed, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { renderMarkdown } from '../../utils/markdown'
import { useSessionPlanStore } from '../../stores/sessionPlan'

const props = defineProps<{ sessionId: string | null | undefined }>()

const planStore = useSessionPlanStore()
const plan = computed(() => planStore.planFor(props.sessionId))
const loading = computed(() => planStore.loadingFor(props.sessionId))
const error = computed(() => planStore.errorFor(props.sessionId))

const statusText = computed(() => {
  const mode = plan.value?.mode || 'idle'
  if (mode === 'planning') return '计划中'
  if (mode === 'approval_requested') return '等待审批'
  if (mode === 'approved') return '已批准'
  if (mode === 'rejected') return '需修改'
  if (mode === 'error') return '异常'
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
        {{ loading ? '读取中…' : error || statusText }}
      </span>
      <button type="button" class="pp-refresh" title="刷新" :disabled="!sessionId || loading" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <div v-if="plan?.planMarkdown" class="pp-markdown markdown-body" v-html="renderMarkdown(plan.planMarkdown)" />
    <p v-else class="pp-empty">暂无计划。Agent 在计划模式下写入当前对话的计划文件后会显示在这里。</p>
    <p v-if="plan?.feedback" class="pp-feedback">反馈：{{ plan.feedback }}</p>
    <p v-if="plan?.error" class="pp-error">{{ plan.error }}</p>
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
