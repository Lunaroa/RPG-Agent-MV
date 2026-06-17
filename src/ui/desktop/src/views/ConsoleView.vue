<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import {
  assetLibrary,
  projectManagement,
  sessions as sessionsApi,
  type AssetLibraryCatalog,
  type ProjectOverview,
  type SessionSummary,
} from '../api/client';
import { useProjectStore } from '../stores/project';
import type { ConsolePage } from '../stores/workbenchUi';
import ConsoleAssetsPane from '../components/console/ConsoleAssetsPane.vue';
import ConsoleHome from '../components/console/ConsoleHome.vue';
import ConsoleLogsPane from '../components/console/ConsoleLogsPane.vue';
import ConsolePluginsPane from '../components/console/ConsolePluginsPane.vue';
import ConsoleSettingsPane from '../components/console/ConsoleSettingsPane.vue';
import ConsoleStoryPane from '../components/console/ConsoleStoryPane.vue';
import StoryProjectIdentityControl from '../components/console/StoryProjectIdentityControl.vue';
import ProjectAccessControl from '../components/console/ProjectAccessControl.vue';

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const allowedPages: ConsolePage[] = ['home', 'assets', 'story', 'plugins', 'logs', 'settings'];
const currentPage = computed<ConsolePage>(() => {
  const page = String(route.query.page || 'home') as ConsolePage;
  return allowedPages.includes(page) ? page : 'home';
});
const titles: Record<ConsolePage, string> = {
  home: '控制台',
  assets: '资产库',
  story: '项目管理',
  plugins: '插件管理',
  logs: '运行日志',
  settings: '设置',
};
const catalog = ref<AssetLibraryCatalog | null>(null);
const assetsLoading = ref(false);
const assetsError = ref<string | null>(null);
const sessions = ref<SessionSummary[]>([]);
const logsLoading = ref(false);
const logsError = ref<string | null>(null);
const projectOverview = ref<ProjectOverview | null>(null);
const projectStatsError = ref<string | null>(null);

const currentProjectSessions = computed(() =>
  sessions.value.filter((session) => session.project === projectStore.currentProject),
);

function go(page: ConsolePage) {
  void router.push({ path: '/console', query: page === 'home' ? { page: 'home' } : { page } });
}

function reloadProjectBoundData() {
  sessions.value = [];
  projectOverview.value = null;
  logsError.value = null;
  if (!projectStore.currentProject) return;
  void loadLogs();
  void loadProjectOverview();
}

async function loadAssets() {
  assetsLoading.value = true; assetsError.value = null;
  try { catalog.value = await assetLibrary.catalog(); }
  catch (error) { assetsError.value = (error as Error).message; }
  finally { assetsLoading.value = false; }
}

async function loadLogs() {
  logsLoading.value = true; logsError.value = null;
  try {
    const result = await sessionsApi.list() as { sessions?: SessionSummary[] } | SessionSummary[];
    sessions.value = Array.isArray(result) ? result : (result.sessions || []);
  } catch (error) { logsError.value = (error as Error).message; }
  finally { logsLoading.value = false; }
}

async function loadProjectOverview() {
  if (!projectStore.currentProject) return;
  projectStatsError.value = null;
  try {
    projectOverview.value = await projectManagement.overview(projectStore.currentProject);
  } catch (error) {
    projectOverview.value = null;
    projectStatsError.value = (error as Error).message;
  }
}

const assetCount = computed(() => {
  return catalog.value?.totalEntries || 0;
});

const databaseCount = computed(() => {
  const database = projectOverview.value?.scan.database || {};
  return Object.values(database).reduce((sum, group) => sum + (group.count || 0), 0);
});

const audioCount = computed(() => {
  const audio = projectOverview.value?.assets.audio || {};
  return Object.values(audio).reduce((sum, bucket) => sum + (bucket.count || 0), 0);
});

const projectItemCount = computed(() => {
  const scan = projectOverview.value?.scan;
  if (!scan) return 0;
  const namedSwitches = scan.switches.filter((item) => item.name).length;
  const namedVariables = scan.variables.filter((item) => item.name).length;
  const eventCount = scan.maps.reduce((sum, map) => sum + map.eventCount, 0);
  return scan.maps.length + eventCount + namedSwitches + namedVariables + scan.commonEvents.length + databaseCount.value + audioCount.value;
});

watch(currentPage, (page) => {
  if (!projectStore.currentProject) return;
  if ((page === 'home' || page === 'assets') && !catalog.value && !assetsLoading.value) void loadAssets();
  if ((page === 'home' || page === 'logs') && !sessions.value.length && !logsLoading.value) void loadLogs();
  if (page === 'home') {
    void loadProjectOverview();
  }
}, { immediate: true });

watch(() => projectStore.currentProject, (project, previous) => {
  if (project === previous) return;
  reloadProjectBoundData();
});

onMounted(async () => {
  if (!route.query.page) void router.replace({ path: '/console', query: { page: 'home' } });
  if (!projectStore.loaded) {
    await projectStore.load();
  }
});
</script>

<template>
  <div class="console-view">
    <ConsoleHome
      v-if="currentPage === 'home'"
      :asset-count="assetCount"
      :session-count="currentProjectSessions.length"
      :project-item-count="projectItemCount"
      :database-count="databaseCount"
      :audio-count="audioCount"
      :project-stats-error="projectStatsError"
      @navigate="go"
    />
    <section v-else class="console-page">
      <nav class="console-breadcrumb" aria-label="控制台路径">
        <button type="button" class="back-button" @click="go('home')"><ArrowLeft /><span>控制台</span></button>
        <span>/</span>
        <strong>{{ titles[currentPage] }}</strong>
      </nav>
      <header class="console-page-heading">
        <h2>{{ titles[currentPage] }}</h2>
        <div class="project-control">
          <ProjectAccessControl compact @changed="reloadProjectBoundData" />
          <StoryProjectIdentityControl v-if="projectStore.currentProject" :project="projectStore.currentProject" />
        </div>
      </header>
      <ConsoleAssetsPane v-if="currentPage === 'assets'" :catalog="catalog" :loading="assetsLoading" :error="assetsError" />
      <ConsoleStoryPane v-else-if="currentPage === 'story'" />
      <ConsolePluginsPane v-else-if="currentPage === 'plugins'" />
      <ConsoleLogsPane v-else-if="currentPage === 'logs'" :sessions="sessions" :loading="logsLoading" :error="logsError" :current-project="projectStore.currentProject" />
      <ConsoleSettingsPane v-else />
    </section>
  </div>
</template>

<style scoped>
.console-view {
  --console-page: #f4efe7;
  --console-paper: #fffdfa;
  --console-paper-soft: #faf5ec;
  --console-border: #e4dcce;
  --console-border-strong: #ddd3c2;
  --console-text: #211d17;
  --console-text-soft: #5a5247;
  --console-text-muted: #9a8e7e;
  --console-text-faint: #b3a795;
  --console-accent: #be5630;
  --console-accent-hover: #a8481f;
  --console-accent-soft: #f6e3d7;
  --console-shadow: 0 14px 30px -18px rgba(80, 50, 25, .4);
}

.console-view,
.console-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--console-page);
  color: var(--console-text);
}

.console-breadcrumb {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 16px 40px 0;
  color: var(--console-text-muted);
  font-size: 13px;
}

.console-breadcrumb strong {
  color: var(--console-text-soft);
  font-weight: 650;
}

.console-page-heading {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 40px 0;
}

.console-page-heading h2 {
  margin: 0;
  color: var(--console-text);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -.01em;
}

.console-page > :deep(.console-subpage),
.console-page > :deep(.logs),
.console-page > :deep(.settings-pane) {
  flex: 1;
  min-height: 0;
}

.project-control {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.back-button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--console-text-muted);
  font: inherit;
  cursor: pointer;
}

.back-button:hover {
  color: var(--console-accent);
}

.back-button:focus-visible,
.page-project-select:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.back-button :deep(svg) {
  width: 15px;
}

.page-project-select {
  height: 34px;
  min-width: 180px;
  border: 1px solid var(--console-border-strong);
  border-radius: 9px;
  background: var(--console-paper);
  color: var(--console-text-soft);
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.page-project-name {
  max-width: 220px;
  overflow: hidden;
  color: var(--console-text-soft);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .console-page-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .project-control {
    width: 100%;
    justify-content: flex-start;
  }

  .page-project-select,
  .page-project-name {
    width: 100%;
    max-width: none;
  }
}

.console-state {
  display: grid;
  place-items: center;
  flex: 1;
  margin: 34px 40px;
  border: 1px solid var(--console-border);
  border-radius: 14px;
  background: var(--console-paper);
  color: var(--console-text-muted);
  font-size: 13px;
}

.console-state.error {
  border-color: var(--app-danger);
  background: var(--app-danger-soft);
  color: var(--app-danger);
}
</style>
