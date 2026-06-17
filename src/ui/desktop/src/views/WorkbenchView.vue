<script setup lang="ts">
import { watch } from 'vue';
import AgentPanel from '../components/agent/AgentPanel.vue';
import WorkspaceSidePanel from '../components/agent/WorkspaceSidePanel.vue';
import EditorView from './EditorView.vue';
import { useEventPlacementAskStore } from '../stores/eventPlacementAsk';
import { useProjectStore } from '../stores/project';
import { useWorkbenchUiStore } from '../stores/workbenchUi';

const projectStore = useProjectStore();
const eventPlacementAsk = useEventPlacementAskStore();
const ui = useWorkbenchUiStore();
let lastPlacementPendingCount = 0;

watch(
  () => eventPlacementAsk.pendingCount,
  (count) => {
    if (count > 0 && count > lastPlacementPendingCount) {
      ui.openSidePanel('placement');
    }
    lastPlacementPendingCount = count;
  },
  { immediate: true },
);
</script>

<template>
  <div class="workbench-view">
    <div v-if="!projectStore.currentProject" class="project-empty-state">
      <strong>还没有接入 RPG Maker MV 项目</strong>
      <span>先到控制台添加项目目录，编辑器和 Agent 写入能力才会启用。</span>
      <router-link class="project-empty-action" :to="{ path: '/console', query: { page: 'home' } }">去添加项目</router-link>
      <small v-if="projectStore.loadError">{{ projectStore.loadError }}</small>
    </div>
    <template v-else>
      <main class="workbench-main">
        <EditorView />
      </main>
      <AgentPanel />
      <WorkspaceSidePanel />
    </template>
  </div>
</template>

<style scoped>
.workbench-view {
  position: relative;
  min-height: 0;
  min-width: 0;
  display: flex;
  gap: 10px;
  overflow: hidden;
  background: var(--app-bg-page);
}

.workbench-main {
  min-width: 380px;
  min-height: 0;
  width: 0;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: var(--app-bg);
  box-shadow: var(--app-shadow-1);
}

.project-empty-state {
  width: min(520px, calc(100% - 48px));
  margin: auto;
  display: grid;
  gap: 10px;
  padding: 26px;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  background: var(--app-bg);
  color: var(--app-ink-soft);
  box-shadow: var(--app-shadow-1);
  text-align: center;
}

.project-empty-state strong {
  color: var(--app-ink);
  font-size: 18px;
  font-weight: 650;
}

.project-empty-state span,
.project-empty-state small {
  font-size: 13px;
  line-height: 1.55;
}

.project-empty-state small {
  color: var(--app-danger);
}

.project-empty-action {
  justify-self: center;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 9px;
  background: var(--app-accent);
  color: var(--app-accent-ink);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

</style>
