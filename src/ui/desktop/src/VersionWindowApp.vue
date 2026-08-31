<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import type { ProjectGitStatus } from '@contract/project-git'
import ProjectVersionPanel from './components/project/ProjectVersionPanel.vue'
import { versionWindow } from './api/client'
import { useI18n, pickByLocale } from './i18n'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { useWorkspaceStore } from './stores/workspace'
import { applyUiTheme } from './utils/applyUiTheme'

const workspaceStore = useWorkspaceStore()
const settingsStore = useSettingsStore()
const projectStore = useProjectStore()
const { language, t } = useI18n()

const elementLocale = computed(() => pickByLocale(language.value, { 'zh-CN': zhCn, 'en-US': en }))

let removeProjectListener: (() => void) | null = null

function forwardStatus(status: ProjectGitStatus | null) {
  void versionWindow.notifyStatusChanged(status)
}

onMounted(async () => {
  document.title = t('projectGit.title')
  try {
    await workspaceStore.load()
    await settingsStore.loadUi()
    applyUiTheme(settingsStore.ui)
    await projectStore.load()
  } catch {
    // The panel surfaces its own error state when data is unavailable.
  }
  removeProjectListener = versionWindow.onProjectChanged(() => {
    void projectStore.load()
  })
})

onUnmounted(() => {
  removeProjectListener?.()
  removeProjectListener = null
})
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <div class="version-window" data-ui-id="version-window">
      <ProjectVersionPanel @status="forwardStatus" />
    </div>
  </ElConfigProvider>
</template>

<style scoped>
.version-window {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg-page);
  overflow: hidden;
}
</style>
