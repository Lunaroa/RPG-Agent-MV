<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Expand, Fold } from '@element-plus/icons-vue';
import { PanelRightClose, PanelRightOpen, Minus, Square, X as XIcon } from '@lucide/vue';
import { settings } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { useWorkspaceStore } from '../../stores/workspace';

const ui = useWorkbenchUiStore();
const workspace = useWorkspaceStore();
const projectStore = useProjectStore();
const router = useRouter();

/* ---------- Menu dropdowns ---------- */
const openMenu = ref<string | null>(null);
const maximized = ref(false);

type EditorCommand = 'undo' | 'redo' | 'save';
type MenuAction = () => void | Promise<void>;

function emitEditorCommand(command: EditorCommand) {
  if (router.currentRoute.value.path !== '/workbench' || !projectStore.currentProject) {
    ElMessage.info('当前页面没有编辑器操作');
    return;
  }
  window.dispatchEvent(new CustomEvent('agent-rpg:editor-command', { detail: { command } }));
}

async function openDocs() {
  try {
    const snapshot = await settings.getAgentCapabilities();
    await settings.openCapabilityPath(`${snapshot.workflowRoot}/docs`);
  } catch (error) {
    ElMessage.error(`打开文档失败：${(error as Error).message}`);
  }
}

const menus: { key: string; label: string; items: { key: string; label: string; shortcut?: string; action: MenuAction }[] }[] = [
  { key: 'file', label: '文件', items: [
    { key: 'save', label: '保存', shortcut: 'Ctrl+S', action: () => emitEditorCommand('save') },
  ]},
  { key: 'edit', label: '编辑', items: [
    { key: 'undo', label: '撤销', shortcut: 'Ctrl+Z', action: () => emitEditorCommand('undo') },
    { key: 'redo', label: '重做', shortcut: 'Ctrl+Shift+Z', action: () => emitEditorCommand('redo') },
  ]},
  { key: 'help', label: '帮助', items: [
    { key: 'docs', label: '文档', action: openDocs },
  ]},
];

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
  void refreshWindowState();
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', refreshWindowState);
  window.removeEventListener('focus', refreshWindowState);
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
      :title="ui.appRailOpen ? '收起导航' : '展开导航'"
      :aria-label="ui.appRailOpen ? '收起导航' : '展开导航'"
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

    <!-- Toggle auxiliary sidebar -->
    <button
      type="button"
      class="sidebar-toggle"
      data-ui-id="topbar-agent-panel-toggle"
      :aria-pressed="ui.agentPanelOpen"
      title="切换辅助侧栏 (Ctrl+L)"
      @click="ui.toggleAgentPanel"
    >
      <component :is="ui.agentPanelOpen ? PanelRightOpen : PanelRightClose" :size="15" :stroke-width="1.5" />
    </button>

    <div class="window-controls" aria-label="窗口控制">
      <button type="button" class="window-btn" data-ui-id="window-minimize" title="最小化" aria-label="最小化" @click="minimizeWindow"><Minus :size="15" :stroke-width="1.5" /></button>
      <button type="button" class="window-btn" data-ui-id="window-maximize-toggle" :title="maximized ? '还原' : '最大化'" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMaximizeWindow">
        <svg v-if="maximized" class="window-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8" y="4" width="12" height="12" rx="1.5" />
          <path d="M16 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3" />
        </svg>
        <Square v-else :size="15" :stroke-width="1.5" />
      </button>
      <button type="button" class="window-btn close" data-ui-id="window-close" title="关闭" aria-label="关闭" @click="closeWindow"><XIcon :size="15" :stroke-width="1.5" /></button>
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
