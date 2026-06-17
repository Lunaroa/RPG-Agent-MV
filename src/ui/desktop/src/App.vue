<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppRail from './components/layout/AppRail.vue'
import TopBar from './components/layout/TopBar.vue'
import StatusBar from './components/layout/StatusBar.vue'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { useWorkbenchUiStore } from './stores/workbenchUi'
import { useWorkspaceStore } from './stores/workspace'
import { applyUiTheme } from './utils/applyUiTheme'
import {
  getEditorUiControlState,
  openEditorEventFromUiControl,
  type UiControlCommand,
  type UiControlEnvelope,
} from './utils/uiControl'

const projectStore = useProjectStore()
const settingsStore = useSettingsStore()
const workspaceStore = useWorkspaceStore()
const workbenchUi = useWorkbenchUiStore()
const route = useRoute()
const router = useRouter()
const booting = ref(true)
const bootError = ref('')
let removeUiControlListener: (() => void) | null = null

const consolePage = computed(() => {
  if (route.path !== '/console') return null
  return String(route.query.page || 'home')
})

async function settleUiControlView() {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function uiControlState(extra: Record<string, unknown> = {}) {
  return {
    route: {
      path: route.path,
      query: { ...route.query },
      fullPath: route.fullPath,
    },
    page: route.path === '/console' ? 'console' : route.path === '/workbench' ? 'workbench' : 'other',
    consolePage: consolePage.value,
    project: projectStore.currentProject || '',
    booting: booting.value,
    bootError: bootError.value,
    appRailOpen: workbenchUi.appRailOpen,
    agentPanelOpen: workbenchUi.agentPanelOpen,
    editor: getEditorUiControlState(),
    ...extra,
  }
}

async function navigateUiControlTarget(target: string) {
  const routes: Record<string, { path: string; query?: Record<string, string> }> = {
    workbench: { path: '/workbench' },
    'console-home': { path: '/console', query: { page: 'home' } },
    'console-assets': { path: '/console', query: { page: 'assets' } },
    'console-story': { path: '/console', query: { page: 'story' } },
    'console-plugins': { path: '/console', query: { page: 'plugins' } },
    'console-logs': { path: '/console', query: { page: 'logs' } },
    'console-settings': { path: '/console', query: { page: 'settings' } },
  }
  const next = routes[target]
  if (!next) throw new Error(`不支持的 UI 导航目标：${target}`)
  await router.push(next)
  await router.isReady()
  await settleUiControlView()
  return uiControlState({ target })
}

async function handleUiControlCommand(command: UiControlCommand) {
  if (booting.value) throw new Error('应用仍在启动，暂时不能执行 UI 控制命令。')
  if (bootError.value) throw new Error(`应用启动失败：${bootError.value}`)
  if (command.type === 'state') return uiControlState()
  if (command.type === 'navigate') {
    if (!command.target) throw new Error('缺少导航目标。')
    return navigateUiControlTarget(command.target)
  }
  if (command.type === 'open-event-editor') {
    if (!projectStore.currentProject) throw new Error('当前没有接入 RPG Maker MV 项目。')
    if (!Number.isInteger(command.mapId) || Number(command.mapId) < 1) throw new Error('缺少有效地图 ID。')
    if (!Number.isInteger(command.eventId) || Number(command.eventId) < 1) throw new Error('缺少有效事件 ID。')
    await router.push({
      path: '/workbench',
      query: { mapId: String(command.mapId), eventId: String(command.eventId) },
    })
    await router.isReady()
    await settleUiControlView()
    const editor = await openEditorEventFromUiControl(Number(command.mapId), Number(command.eventId))
    await settleUiControlView()
    return uiControlState({ editor })
  }
  if (command.type === 'capture-current') return uiControlState()
  throw new Error(`不支持的 UI 控制命令：${command.type}`)
}

function handleUiControlEnvelope(raw: unknown) {
  const envelope = (raw || {}) as UiControlEnvelope
  const id = String(envelope.id || '')
  const command = envelope.command
  if (!id) return
  if (!command) {
    window.api.uiControl.sendResult({ id, ok: false, error: '缺少 UI 控制命令。' })
    return
  }
  void handleUiControlCommand(command)
    .then((result) => window.api.uiControl.sendResult({ id, ok: true, result }))
    .catch((error) => window.api.uiControl.sendResult({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      result: uiControlState(),
    }))
}

onMounted(async () => {
  removeUiControlListener = window.api.uiControl.onCommand(handleUiControlEnvelope)
  try {
    await workspaceStore.load()
    await workspaceStore.migrateFromBrowserStorage()
    await settingsStore.loadUi()
    applyUiTheme(settingsStore.ui)
    workspaceStore.hydrateWorkbenchLayout()
    workspaceStore.bindWorkbenchLayoutPersistence()
    await projectStore.load()
  } catch (error) {
    bootError.value = error instanceof Error ? error.message : '应用启动失败'
  } finally {
    booting.value = false
  }
})

onUnmounted(() => {
  removeUiControlListener?.()
  removeUiControlListener = null
})
</script>

<template>
  <div class="app-layout">
    <TopBar />
    <div class="workspace-shell">
      <AppRail v-if="workbenchUi.appRailOpen" />
      <main class="main-content">
        <div v-if="booting" class="app-state-card">正在读取项目…</div>
        <div v-else-if="bootError" class="app-state-card error">{{ bootError }}</div>
        <router-view v-else />
      </main>
    </div>
    <StatusBar />
  </div>
</template>

<style scoped>
.app-layout {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  background: var(--app-bg-page);
  overflow: hidden;
}

.workspace-shell {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  gap: 10px;
  padding: 0 10px 0 0;
}

.main-content {
  padding: 0;
  background: var(--app-bg-page);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  flex: 1 1 auto;
}

.main-content :deep(> *) {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.app-state-card {
  align-self: center;
  margin: auto;
  min-width: min(420px, calc(100vw - 80px));
  padding: 22px 24px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  background: var(--app-bg);
  box-shadow: var(--app-shadow-1);
  color: var(--app-ink-soft);
  font-size: 13px;
  text-align: center;
}

.app-state-card.error {
  border-color: var(--app-danger);
  background: var(--app-danger-soft);
  color: var(--app-danger);
}
</style>
