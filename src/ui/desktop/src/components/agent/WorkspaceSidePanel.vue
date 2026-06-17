<script setup lang="ts">
import { computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useWorkbenchUiStore, type SidePanelKind } from '../../stores/workbenchUi'
import { useSession } from '../../composables/useSession'
import PlanPanel from './PlanPanel.vue'
import PlacementPanel from './PlacementPanel.vue'
import SubagentPanel from './SubagentPanel.vue'
import TaskBoardPanel from './TaskBoardPanel.vue'

const ui = useWorkbenchUiStore()
const { activeSession } = useSession()

type Tab = Exclude<SidePanelKind, null>
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'task', label: 'TASK' },
  { key: 'plan', label: 'PLAN' },
  { key: 'placement', label: '待放置事件' },
  { key: 'subagent', label: 'subagent' },
]

const active = computed<Tab>(() => (ui.sidePanel ?? 'task') as Tab)
const activeLabel = computed(() => TABS.find((tab) => tab.key === active.value)?.label ?? '')
</script>

<template>
  <aside v-if="ui.sidePanel" class="ws-side-panel" aria-label="工作面板">
    <header class="wsp-head">
      <h3 class="wsp-title">{{ activeLabel }}</h3>
      <button type="button" class="wsp-close" title="关闭" @click="ui.closeSidePanel()">
        <el-icon><Close /></el-icon>
      </button>
    </header>

    <div class="wsp-body">
      <TaskBoardPanel v-if="active === 'task'" :session-id="activeSession?.id" />
      <PlanPanel v-else-if="active === 'plan'" :session-id="activeSession?.id" />
      <PlacementPanel v-else-if="active === 'placement'" />
      <SubagentPanel v-else :session-id="activeSession?.id" />
    </div>
  </aside>
</template>

<style scoped>
.ws-side-panel {
  width: 320px;
  min-width: 320px;
  flex: 0 0 320px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
  border-radius: 12px;
  box-shadow: var(--app-shadow-1);
}

.wsp-head {
  flex: 0 0 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 8px;
  background: var(--app-bg-soft);
}

.wsp-title {
  margin: 0;
  min-width: 0;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.03em;
  color: var(--app-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wsp-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.wsp-close:hover {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
}

.wsp-close :deep(svg) {
  width: 14px;
  height: 14px;
}

.wsp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
