<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Expand, Fold } from '@element-plus/icons-vue';
import { PanelRightClose, PanelRightOpen, Minus, Play, Square, X as XIcon } from '@lucide/vue';
import { resolveUserDocsEntry } from '@contract/docs-path';
import type { InteractivePlaytestRun } from '@contract/types';
import { playtest, settings } from '../../api/client';
import { useSession } from '../../composables/useSession';
import { useI18n } from '../../i18n';
import { normalizeProductLanguage } from '../../i18n/messages';
import { useSettingsStore } from '../../stores/settings';
import { useProjectStore } from '../../stores/project';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { useWorkspaceStore } from '../../stores/workspace';

const ui = useWorkbenchUiStore();
const workspace = useWorkspaceStore();
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const router = useRouter();
const { t } = useI18n();
const { activeSession } = useSession();

/* ---------- Menu dropdowns ---------- */
const openMenu = ref<string | null>(null);
const maximized = ref(false);
const playtestRun = ref<InteractivePlaytestRun | null>(null);
const playtestBusy = ref(false);
let unsubscribePlaytestStatus: (() => void) | null = null;

const playtestLive = computed(() => (
  playtestRun.value !== null
  && ['starting', 'running', 'stopping', 'stop_failed'].includes(playtestRun.value.status)
));
const playtestTitle = computed(() => {
  if (playtestRun.value?.status === 'starting') return t('topbar.playtest.starting');
  if (playtestRun.value?.status === 'stopping') return t('topbar.playtest.stopping');
  if (!playtestLive.value && !projectStore.currentProject) return t('topbar.playtest.noProject');
  return playtestLive.value ? t('topbar.playtest.stop') : t('topbar.playtest.start');
});

type EditorCommand = 'undo' | 'redo' | 'save';
type MenuAction = () => void | Promise<void>;

function emitEditorCommand(command: EditorCommand) {
  if (router.currentRoute.value.path !== '/workbench' || !projectStore.currentProject) {
    ElMessage.info(t('topbar.editorUnavailable'));
    return;
  }
  window.dispatchEvent(new CustomEvent('agent-rpg:editor-command', { detail: { command } }));
}

async function openDocs() {
  try {
    const snapshot = await settings.getAgentCapabilities();
    const language = normalizeProductLanguage(settingsStore.ui.language);
    const docsEntry = resolveUserDocsEntry(snapshot.workflowRoot, language);
    await settings.openCapabilityPath(docsEntry);
  } catch (error) {
    ElMessage.error(t('topbar.openDocsFailed', { message: (error as Error).message }));
  }
}

function openTutorial() {
  window.dispatchEvent(new Event('agent-rpg:onboarding-tour:start'));
}

const menus = computed<{ key: string; label: string; items: { key: string; label: string; shortcut?: string; action: MenuAction }[] }[]>(() => [
  { key: 'file', label: t('topbar.menu.file'), items: [
    { key: 'save', label: t('topbar.menu.save'), shortcut: 'Ctrl+S', action: () => emitEditorCommand('save') },
  ]},
  { key: 'edit', label: t('topbar.menu.edit'), items: [
    { key: 'undo', label: t('topbar.menu.undo'), shortcut: 'Ctrl+Z', action: () => emitEditorCommand('undo') },
    { key: 'redo', label: t('topbar.menu.redo'), shortcut: 'Ctrl+Shift+Z', action: () => emitEditorCommand('redo') },
  ]},
  { key: 'help', label: t('topbar.menu.help'), items: [
    { key: 'tutorial', label: t('topbar.menu.tutorial'), action: openTutorial },
    { key: 'docs', label: t('topbar.menu.docs'), action: openDocs },
  ]},
]);

function toggleMenu(key: string) {
  openMenu.value = openMenu.value === key ? null : key;
}

function closeMenus() {
  openMenu.value = null;
}

function onMenuAction(action: MenuAction) {
  closeMenus();
  void action();
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!openMenu.value) return;
  const target = event.target as Element | null;
  if (target?.closest('.menu-item')) return;
  closeMenus();
}

async function refreshWindowState() {
  try {
    maximized.value = Boolean((await window.api.window.isMaximized()).maximized);
  } catch {
    maximized.value = false;
  }
}

function minimizeWindow() {
  void window.api.window.minimize();
}

async function toggleMaximizeWindow() {
  try {
    const result = await window.api.window.toggleMaximize();
    maximized.value = Boolean(result.maximized);
  } catch {
    maximized.value = false;
  }
}

async function closeWindow() {
  try {
    await workspace.flush();
  } catch {
    // Main process still saves window state; failed preference flush is logged by the store.
  }
  void window.api.window.close();
}

function applyPlaytestRun(run?: InteractivePlaytestRun): void {
  if (run) playtestRun.value = run;
}

async function togglePlaytest() {
  if (playtestBusy.value) return;
  if (playtestLive.value) {
    await stopPlaytest();
    return;
  }
  await startPlaytest();
}

async function startPlaytest() {
  const project = projectStore.currentProject;
  if (!project) {
    ElMessage.info(t('topbar.playtest.noProject'));
    return;
  }
  playtestBusy.value = true;
  let confirmedStagingHash: string | undefined;
  try {
    for (;;) {
      const result = await playtest.start({
        project,
        ...(activeSession.value?.id ? { sessionId: activeSession.value.id } : {}),
        ...(confirmedStagingHash ? { confirmedStagingHash } : {}),
      });
      if (result.confirmationRequired) {
        const summary = result.stagingSummary;
        if (!summary || !result.stagingSummaryHash) throw new Error(t('topbar.playtest.invalidResponse'));
        await ElMessageBox.confirm(
          `${t('topbar.playtest.confirmStaging', {
            files: summary.fileCount,
            operations: summary.operationCount,
          })}${summary.conflict ? t('topbar.playtest.confirmConflict') : ''}`,
          t('topbar.playtest.confirmTitle'),
          {
            type: 'warning',
            confirmButtonText: t('topbar.playtest.confirmAction'),
            cancelButtonText: t('topbar.playtest.confirmCancel'),
          },
        );
        confirmedStagingHash = result.stagingSummaryHash;
        continue;
      }
      if (result.error) throw new Error(result.error);
      if (!result.run) throw new Error(t('topbar.playtest.invalidResponse'));
      applyPlaytestRun(result.run);
      if (['failed', 'stop_failed'].includes(result.run.status)) {
        throw new Error(result.run.error || t('topbar.playtest.launchFailed'));
      }
      if (result.run.status !== 'running') return;
      ElMessage.warning(t('topbar.playtest.started'));
      return;
    }
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    const message = error instanceof Error ? error.message : String(error);
    ElMessage.error(t('topbar.playtest.failed', { message }));
  } finally {
    playtestBusy.value = false;
  }
}

async function stopPlaytest() {
  playtestBusy.value = true;
  try {
    const result = await playtest.stop();
    if (result.run) applyPlaytestRun(result.run);
    if (['failed', 'stop_failed'].includes(result.run?.status || '') || result.error) {
      throw new Error(result.run?.error || result.error || t('topbar.playtest.cleanupFailed'));
    }
    if (result.run?.status === 'stopped') ElMessage.success(t('topbar.playtest.stopped'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ElMessage.error(t('topbar.playtest.failed', { message }));
  } finally {
    playtestBusy.value = false;
  }
}

/* ---------- Keyboard shortcut ---------- */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openMenu.value) {
    closeMenus();
  } else if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    ui.toggleAgentPanel();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    emitEditorCommand('save');
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', refreshWindowState);
  window.addEventListener('focus', refreshWindowState);
  unsubscribePlaytestStatus = playtest.onStatus(applyPlaytestRun);
  void refreshWindowState();
  void playtest.current().then((result) => applyPlaytestRun(result.run)).catch(() => undefined);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', refreshWindowState);
  window.removeEventListener('focus', refreshWindowState);
  unsubscribePlaytestStatus?.();
  unsubscribePlaytestStatus = null;
});
</script>

<template>
  <header class="top-bar">
    <!-- Transparent backdrop: the title bar is a window drag region that swallows
         pointer events, so a no-drag overlay is needed to catch outside clicks. -->
    <div v-if="openMenu" class="menu-backdrop" aria-hidden="true" @pointerdown="closeMenus" />

    <button
      type="button"
      class="topbar-btn rail-toggle"
      data-ui-id="topbar-rail-toggle"
      :title="ui.appRailOpen ? t('topbar.collapseNavigation') : t('topbar.expandNavigation')"
      :aria-label="ui.appRailOpen ? t('topbar.collapseNavigation') : t('topbar.expandNavigation')"
      @click="ui.toggleAppRail"
    >
      <component :is="ui.appRailOpen ? Fold : Expand" />
    </button>

    <!-- Menu items -->
    <div
      v-for="menu in menus"
      :key="menu.key"
      class="menu-item"
      :data-ui-id="`topbar-menu-${menu.key}`"
      :class="{ open: openMenu === menu.key }"
      @click.stop="toggleMenu(menu.key)"
    >
      {{ menu.label }}
      <div v-if="openMenu === menu.key" class="dropdown">
        <div
          v-for="item in menu.items"
          :key="item.key"
          class="dd-item"
          :data-ui-id="`topbar-menu-${menu.key}-${item.key}`"
          @click.stop="onMenuAction(item.action)"
        >
          <span>{{ item.label }}</span>
          <span v-if="item.shortcut" class="dd-shortcut">{{ item.shortcut }}</span>
        </div>
      </div>
    </div>

    <div class="topbar-fill" />

    <button
      type="button"
      class="playtest-toggle"
      :class="{ live: playtestLive }"
      data-ui-id="topbar-playtest-toggle"
      :disabled="playtestBusy || (!playtestLive && !projectStore.currentProject)"
      :title="playtestTitle"
      :aria-label="playtestTitle"
      :aria-pressed="playtestLive"
      @click="togglePlaytest"
    >
      <Square v-if="playtestLive" :size="13" :stroke-width="1.8" />
      <Play v-else :size="14" :stroke-width="1.8" />
    </button>

    <!-- Toggle auxiliary sidebar -->
    <button
      type="button"
      class="sidebar-toggle"
      data-ui-id="topbar-agent-panel-toggle"
      :aria-pressed="ui.agentPanelOpen"
      :title="t('topbar.toggleAuxSidebar')"
      @click="ui.toggleAgentPanel"
    >
      <component :is="ui.agentPanelOpen ? PanelRightOpen : PanelRightClose" :size="15" :stroke-width="1.5" />
    </button>

    <div class="window-controls" :aria-label="t('topbar.windowControls')">
      <button type="button" class="window-btn" data-ui-id="window-minimize" :title="t('topbar.minimize')" :aria-label="t('topbar.minimize')" @click="minimizeWindow"><Minus :size="15" :stroke-width="1.5" /></button>
      <button type="button" class="window-btn" data-ui-id="window-maximize-toggle" :title="maximized ? t('topbar.restore') : t('topbar.maximize')" :aria-label="maximized ? t('topbar.restore') : t('topbar.maximize')" @click="toggleMaximizeWindow">
        <svg v-if="maximized" class="window-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8" y="4" width="12" height="12" rx="1.5" />
          <path d="M16 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3" />
        </svg>
        <Square v-else :size="15" :stroke-width="1.5" />
      </button>
      <button type="button" class="window-btn close" data-ui-id="window-close" :title="t('topbar.close')" :aria-label="t('topbar.close')" @click="closeWindow"><XIcon :size="15" :stroke-width="1.5" /></button>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  height: var(--app-titlebar-height);
  min-height: var(--app-titlebar-height);
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 0 0 3px;
  background: var(--app-bg-page);
  color: var(--app-ink);
  -webkit-app-region: drag;
  font-size: 12px;
  position: relative;
  z-index: 100;
}

.menu-item,
.topbar-btn,
.playtest-toggle,
.sidebar-toggle,
.window-controls,
.window-btn {
  -webkit-app-region: no-drag;
}

.rail-toggle {
  margin-right: 3px;
}

.rail-toggle :deep(svg) {
  width: 13px;
  height: 13px;
}

/* ---------- Menu items ---------- */
/* Catches clicks anywhere in the window (including the drag region) to close an
   open menu. no-drag so the OS does not consume the pointer event. */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  -webkit-app-region: no-drag;
}

.menu-item {
  padding: 0 8px;
  height: 26px;
  display: flex;
  align-items: center;
  color: var(--app-ink-soft);
  border-radius: var(--app-radius-sm);
  cursor: pointer;
  position: relative;
  z-index: 60;
  user-select: none;
}

.menu-item:hover,
.menu-item.open {
  background: var(--app-bg-soft);
  color: var(--app-ink);
}

.topbar-fill {
  flex: 1;
}

.playtest-toggle {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  transition: background-color var(--app-dur) var(--app-ease), color var(--app-dur) var(--app-ease);
}

.playtest-toggle:hover:not(:disabled) {
  color: var(--app-success, #2f8f64);
  background: color-mix(in srgb, var(--app-success, #2f8f64) 10%, transparent);
}

.playtest-toggle.live {
  color: var(--app-danger);
}

.playtest-toggle.live:hover:not(:disabled) {
  color: var(--app-danger);
  background: color-mix(in srgb, var(--app-danger) 10%, transparent);
}

.playtest-toggle:disabled {
  cursor: default;
  opacity: 0.4;
}

/* ---------- Dropdown ---------- */
.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  padding: 4px;
  border-radius: var(--app-radius-md);
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-3);
  z-index: 300;
}

.dd-item {
  padding: 5px 10px;
  border-radius: var(--app-radius-sm);
  font-size: 12px;
  color: var(--app-ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dd-item:hover {
  background: var(--app-bg-soft);
  color: var(--app-ink);
}

.dd-shortcut {
  margin-left: auto;
  font-size: 10px;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono);
}

.topbar-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--app-ink-soft);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--app-dur) var(--app-ease), color var(--app-dur) var(--app-ease);
}

.topbar-btn:hover {
  background: color-mix(in srgb, var(--app-ink) 7%, transparent);
  color: var(--app-ink);
}

/* ---------- Sidebar toggle ---------- */
.sidebar-toggle {
  height: 28px;
  width: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  transition: background-color var(--app-dur) var(--app-ease), color var(--app-dur) var(--app-ease);
}

.sidebar-toggle :deep(svg) {
  width: 15px;
  height: 15px;
}

.sidebar-toggle:hover {
  background: color-mix(in srgb, var(--app-ink) 7%, transparent);
  color: var(--app-ink);
}

.window-controls {
  align-self: stretch;
  display: flex;
  margin-left: 8px;
}

.window-btn {
  width: 42px;
  height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  transition: background-color var(--app-dur) var(--app-ease), color var(--app-dur) var(--app-ease);
}

.window-btn :deep(svg) {
  width: 15px;
  height: 15px;
}

.window-icon {
  width: 15px;
  height: 15px;
  display: block;
}

.window-btn:hover {
  background: var(--app-bg-soft);
  color: var(--app-ink);
}

.window-btn.close:hover {
  background: var(--app-danger);
  color: #fff;
}
</style>
