<script setup lang="ts">
import { computed, watch } from 'vue'
import { Check, Close, Refresh } from '@element-plus/icons-vue'
import { useTaskBoardStore, type TaskItem } from '../../stores/taskBoard'

const props = defineProps<{ sessionId: string | null | undefined }>()

const taskBoard = useTaskBoardStore()

const tasks = computed<TaskItem[]>(() => taskBoard.tasksFor(props.sessionId))
const loading = computed(() => taskBoard.loadingFor(props.sessionId))
const error = computed(() => taskBoard.errorFor(props.sessionId))

function refresh(): void {
  if (!props.sessionId) return
  void taskBoard.loadFromBackend(props.sessionId)
}

watch(
  () => props.sessionId,
  (sessionId) => {
    if (sessionId) void taskBoard.loadFromBackend(sessionId)
  },
  { immediate: true },
)

function toggle(task: TaskItem): void {
  if (!props.sessionId) return
  void taskBoard.toggleComplete(props.sessionId, task)
}

function remove(task: TaskItem): void {
  if (!props.sessionId) return
  void taskBoard.remove(props.sessionId, task.id)
}
</script>

<template>
  <div class="task-board">
    <div class="tb-toolbar">
      <span v-if="loading" class="tb-state">读取中…</span>
      <span v-else-if="error" class="tb-error">{{ error }}</span>
      <span v-else class="tb-state">{{ tasks.length ? `${tasks.length} 项` : '' }}</span>
      <button type="button" class="tb-refresh" title="刷新" :disabled="!sessionId || loading" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>
    <ul v-if="tasks.length" class="tb-list">
      <li v-for="task in tasks" :key="task.id" class="tb-item" :class="{ done: task.status === 'completed' }">
        <button
          type="button"
          class="tb-check"
          :class="{ checked: task.status === 'completed', active: task.status === 'in_progress' }"
          :title="task.status === 'completed' ? '标记为未完成' : '标记为完成'"
          @click="toggle(task)"
        >
          <el-icon v-if="task.status === 'completed'"><Check /></el-icon>
        </button>
        <span class="tb-subject" :title="task.description || task.subject">{{ task.subject }}</span>
        <button type="button" class="tb-remove" title="删除" @click="remove(task)">
          <el-icon><Close /></el-icon>
        </button>
      </li>
    </ul>
    <p v-else-if="!loading" class="tb-empty">暂无待办，Agent 拆分任务后会出现在这里。</p>
  </div>
</template>

<style scoped>
.task-board {
  padding: 8px 10px;
}

.tb-toolbar {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
}

.tb-state,
.tb-error {
  min-width: 0;
  font-size: 11.5px;
  color: var(--app-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-error {
  color: var(--app-danger);
}

.tb-refresh {
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

.tb-refresh:hover:not(:disabled) {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
}

.tb-refresh:disabled {
  opacity: 0.45;
  cursor: default;
}

.tb-refresh :deep(svg) {
  width: 13px;
  height: 13px;
}

.tb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px;
  border-radius: var(--app-radius-sm);
}

.tb-item:hover {
  background: var(--app-bg-elevated);
}

.tb-check {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1.5px solid var(--app-border-strong, var(--app-border));
  border-radius: 5px;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.tb-check.checked {
  background: var(--app-accent);
  border-color: var(--app-accent);
}

.tb-check.active {
  border-color: var(--app-accent);
}

.tb-check :deep(svg) {
  width: 11px;
  height: 11px;
}

.tb-subject {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--app-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-item.done .tb-subject {
  color: var(--app-ink-muted);
  text-decoration: line-through;
}

.tb-remove {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 2px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  opacity: 0;
  cursor: pointer;
}

.tb-item:hover .tb-remove {
  opacity: 1;
}

.tb-remove:hover {
  color: var(--app-danger);
}

.tb-remove :deep(svg) {
  width: 12px;
  height: 12px;
}

.tb-empty {
  margin: 0;
  font-size: 12px;
  color: var(--app-ink-muted);
}
</style>
