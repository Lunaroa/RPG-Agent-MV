<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { History } from '@lucide/vue';
import type { ProjectGitStatus } from '@contract/project-git';
import { projectGit, versionWindow } from '../../api/client';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';

const ui = useWorkbenchUiStore();
const projectStore = useProjectStore();
const { t } = useI18n();
const gitStatus = ref<ProjectGitStatus | null>(null);
let removeStatusListener: (() => void) | null = null;

async function loadGitStatus() {
  const project = projectStore.currentProject;
  if (!project) {
    gitStatus.value = null;
    return;
  }
  try {
    const result = await projectGit.status({ project });
    gitStatus.value = result.status === 'success' ? (result.value ?? null) : null;
  } catch {
    gitStatus.value = null;
  }
}

function openVersionWindow() {
  void versionWindow.open();
}

watch(() => projectStore.currentProject, () => {
  gitStatus.value = null;
  void versionWindow.notifyProjectChanged(projectStore.currentProject || '');
  void loadGitStatus();
});

onMounted(() => {
  void loadGitStatus();
  removeStatusListener = versionWindow.onStatusChanged((value) => {
    gitStatus.value = value;
  });
});

onUnmounted(() => {
  removeStatusListener?.();
  removeStatusListener = null;
});
</script>

<template>
  <footer class="statusbar">
    <span class="sb-item sb-map"><span class="sb-dot" />{{ ui.sbMapLabel || 'Luna RPG Agent' }}</span>
    <button
      v-if="projectStore.currentProject"
      type="button"
      class="sb-item sb-version"
      data-ui-id="status-project-version"
      :title="t('projectGit.status.open')"
      @click="openVersionWindow"
    >
      <History />
      <template v-if="gitStatus?.enabled">
        <span>{{ gitStatus.branch }}</span>
        <span v-if="gitStatus.changes.length" class="sb-version-count">· {{ gitStatus.changes.length }}</span>
      </template>
      <span v-else>{{ t('projectGit.status.label') }}</span>
    </button>
    <span v-if="ui.sbMode" class="sb-item sb-mode" :class="ui.sbMode">
      {{ ui.sbMode === 'map' ? t('status.mode.map') : ui.sbMode === 'preview' ? t('status.mode.preview') : t('status.mode.event') }}
    </span>
    <span v-if="ui.sbCursor" class="sb-item">{{ ui.sbCursor }}</span>
    <span class="sb-fill" />
    <span v-if="ui.sbContextText" class="sb-item">{{ ui.sbContextText }}</span>
    <span v-if="!ui.sbHideZoom" class="sb-item">{{ ui.sbZoom }}%</span>
    <span class="sb-item" :class="{ 'sb-warn': ui.sbStagingDirty }">
      {{ ui.sbStagingDirty ? t('status.staging.dirty') : t('status.staging.clean') }}
    </span>
    <span v-if="ui.sbPlacementActive && ui.sbPlacementHint" class="sb-item sb-placement">
      {{ ui.sbPlacementHint }}
    </span>
    <span v-if="ui.sbStatusText" class="sb-item sb-status" :class="ui.sbStatusKind">
      {{ ui.sbStatusText }}
    </span>
  </footer>
</template>

<style scoped>
.statusbar {
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 16px;
  background: var(--app-bg-page);
  color: var(--app-ink-muted);
  font-size: 11px;
  font-family: var(--app-font-mono);
}

.sb-item { white-space: nowrap; }
.sb-fill { flex: 1; }
.sb-map { display: inline-flex; align-items: center; gap: 7px; }
.sb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--app-ok); }
.sb-version {
  height: 22px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sb-version:hover { background: var(--app-bg-sunken); color: var(--app-ink-soft); }
.sb-version:focus-visible { outline: none; box-shadow: var(--app-ring); }
.sb-version svg { width: 13px; height: 13px; stroke-width: 1.8; }
.sb-version-count { color: var(--app-ink-soft); }
.sb-mode { font-weight: 600; color: var(--app-ink-soft); }
.sb-warn { font-weight: 600; color: var(--app-warn); }
.sb-placement { max-width: 42vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-status.sb-busy { color: var(--app-warn); }
.sb-status.sb-saved { color: var(--app-ok); }
.sb-status.sb-error { color: var(--app-danger); }
</style>
