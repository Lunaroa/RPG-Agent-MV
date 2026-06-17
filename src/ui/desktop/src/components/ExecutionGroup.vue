<template>
  <section class="execution-group">
    <button
      type="button"
      class="execution-group-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <el-icon class="execution-group-chevron" :class="{ open: expanded }"><ArrowRight /></el-icon>
      <span v-if="stateLabel" class="execution-group-state" :class="summary.state">{{ stateLabel }} ·</span>
      <span class="execution-group-summary">{{ summary.text }}</span>
    </button>

    <div v-show="expanded" class="execution-group-body">
      <TurnSegment
        v-for="segment in visibleSegments"
        :key="segment.id"
        :segment="segment"
        :stream-plain="segment.id === liveSegmentId"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { summarizeExecutionGroup, visibleExecutionGroupSegments, type ExecutionGroup } from '../utils/chatTurns'
import TurnSegment from './TurnSegment.vue'

const props = defineProps<{
  group: ExecutionGroup
  liveSegmentId?: string | null
}>()

const expanded = ref(false)
const summary = computed(() => summarizeExecutionGroup(props.group))
const visibleSegments = computed(() => visibleExecutionGroupSegments(props.group))
const stateLabel = computed(() => {
  if (summary.value.state === 'failed') return '执行失败'
  if (summary.value.state === 'blocked') return '执行受阻'
  if (summary.value.state === 'stopped') return '已停止'
  return ''
})
</script>

<style scoped>
.execution-group {
  min-width: 0;
}

.execution-group-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 34px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-ink-muted);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease);
}

.execution-group-toggle:hover,
.execution-group-toggle:focus-visible {
  color: var(--app-ink);
  background: var(--app-bg-soft);
}

.execution-group-toggle:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.execution-group-chevron {
  flex: 0 0 auto;
  font-size: 12px;
  transition: transform var(--app-dur) var(--app-ease);
}

.execution-group-chevron.open {
  transform: rotate(90deg);
}

.execution-group-state {
  flex: 0 0 auto;
  color: var(--app-ink-soft);
  font-weight: 500;
}

.execution-group-state.failed {
  color: var(--el-color-danger);
}

.execution-group-state.blocked {
  color: var(--el-color-warning);
}

.execution-group-state.stopped {
  color: var(--app-ink-soft);
}

.execution-group-summary {
  min-width: 0;
  color: var(--app-ink-muted);
  line-height: 1.5;
}

.execution-group-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0 4px 14px;
  padding: 8px 0 8px 14px;
  border-left: 2px solid var(--app-border);
}

@media (prefers-reduced-motion: reduce) {
  .execution-group-chevron,
  .execution-group-toggle {
    transition: none;
  }
}
</style>
