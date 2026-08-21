<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { UiDesignerLifecycleAdapter } from '@contract/ui-designer'
import type { UiDesignerController } from '../features/ui-designer/composables/useUiDesigner'
import UiDesignerShell from '../features/ui-designer/components/UiDesignerShell.vue'
import { createDesktopUiDesignerAdapters } from '../features/ui-designer/adapters'
import { useUiDesignerI18n } from '../features/ui-designer/i18n'
import { useProductPluginsStore } from '../stores/productPlugins'
import { productPluginDisabledRedirect } from '../utils/projectManagementRoute'
import { registerProductPluginLifecycleGuard } from '../utils/productPluginLifecycle'
import { useProjectStore } from '../stores/project'
import { maps as mapsApi } from '../api/client'
import { parseProjectStagingSummary } from '../utils/projectStaging'

const route = useRoute()
const router = useRouter()
const { t } = useUiDesignerI18n()
const productPlugins = useProductPluginsStore()
const projectStore = useProjectStore()
const desktopAdapters = computed(() => createDesktopUiDesignerAdapters(projectStore.currentProject || undefined))
const shellRef = ref<{
  designer: UiDesignerController
  setProjectContext: (path: string | undefined, adapters?: ReturnType<typeof createDesktopUiDesignerAdapters>) => Promise<boolean>
  disposePreview: (reason?: 'project-change' | 'unload' | 'shutdown') => Promise<boolean>
}>()
let projectSwitchBusy = false
let lastProjectPath = ''
let unregisterLifecycle: (() => void) | undefined

function collectStagedFiles(status: unknown, fallbackFiles: readonly string[]): string[] {
  if (!status || typeof status !== 'object') return [...new Set(fallbackFiles.filter(Boolean))]
  const source = status as { files?: unknown[] }
  const files = Array.isArray(source.files)
    ? source.files.flatMap((file) => {
      if (!file || typeof file !== 'object') return []
      const relativePath = (file as { relativePath?: unknown }).relativePath
      return typeof relativePath === 'string' && relativePath ? [relativePath] : []
    })
    : []
  const operationFiles = parseProjectStagingSummary(status).operations.flatMap((operation) => operation.files)
  return [...new Set([...files, ...operationFiles, ...fallbackFiles].filter(Boolean))]
}

async function applyProjectChanges(fallbackFiles: string[]): Promise<boolean> {
  const project = projectStore.currentProject
  if (!project) return false
  try {
    const status = await mapsApi.projectStaging(project)
    const summary = parseProjectStagingSummary(status)
    const files = collectStagedFiles(status, fallbackFiles)
    if (!summary.staged || !files.length) {
      ElMessage.info(t('noProjectChanges'))
      return false
    }
    await ElMessageBox.confirm(
      h('div', { class: 'ui-designer-project-review' }, [
        h('p', t('projectChangesBody')),
        h('ul', files.map((file) => h('li', { key: file }, file))),
      ]),
      t('projectChangesTitle'),
      {
        type: 'warning',
        confirmButtonText: t('applyProjectChanges'),
        cancelButtonText: t('lifecycleCancel'),
        closeOnClickModal: false,
      },
    )
    const result = await mapsApi.applyProjectStaging(
      project,
      summary.operations.map((operation) => operation.operationId),
    ) as { canceled?: boolean }
    if (result?.canceled) return false
    ElMessage.success(t('projectChangesApplied'))
    return true
  } catch (error) {
    const action = typeof error === 'string' ? error : (error as { action?: string } | null)?.action
    if (action === 'cancel' || action === 'close') return false
    ElMessage.error(error instanceof Error ? error.message : String(error))
    return false
  }
}

// The desktop host drives window closing: the main process asks the renderer
// to settle preview cleanup and unsaved scenes before it allows the close, so
// the browser beforeunload veto (which silently swallows Electron closes) is
// replaced by this adapter whenever the preload bridge is available.
const lifecycleAdapter = computed<UiDesignerLifecycleAdapter | undefined>(() => {
  const onCloseRequest = window.api?.lifecycle?.onCloseRequest
  if (typeof onCloseRequest !== 'function') return undefined
  return {
    registerGuard: (guard) => onCloseRequest(async () => {
      const designer = shellRef.value?.designer
      if (!designer) return true
      try {
        if (designer.isEditorPreviewing) designer.stopEditorPreview()
        if (designer.isPreviewing && !(await designer.stopPreview())) return false
        if (shellRef.value && !(await shellRef.value.disposePreview('unload'))) return false
        if (!designer.isDirty) return true
        return guard.confirmDiscard ? await guard.confirmDiscard() : false
      } catch {
        return false
      }
    }),
  }
})

onMounted(async () => {
  await productPlugins.load()
  lastProjectPath = projectStore.currentProject
  unregisterLifecycle = registerProductPluginLifecycleGuard('ui-designer', {
    isDirty: () => Boolean(shellRef.value?.designer.isDirty || shellRef.value?.designer.isEditorPreviewing || shellRef.value?.designer.isPreviewing || shellRef.value?.designer.previewCleanupPending || shellRef.value?.designer.previewDisposalInFlight),
    save: async () => {
      const designer = shellRef.value?.designer
      if (!designer) return false
      if (designer.isEditorPreviewing) designer.stopEditorPreview()
      if (designer.isPreviewing && !(await designer.stopPreview())) return false
      if (shellRef.value && !(await shellRef.value.disposePreview('unload'))) return false
      const success = await designer.saveAllDirtyScenes()
      return Boolean(success)
    },
    discard: async () => {
      const designer = shellRef.value?.designer
      if (!designer) return false
      if (designer.isEditorPreviewing) designer.stopEditorPreview()
      if (designer.isPreviewing && !(await designer.stopPreview())) return false
      if (shellRef.value && !(await shellRef.value.disposePreview('unload'))) return false
      const success = await designer.discardAllDirtyScenes()
      return Boolean(success)
    },
  })
  if (!productPlugins.isEnabled('ui-designer')) {
    await router.replace(productPluginDisabledRedirect('ui-designer', route.fullPath))
  }
})

watch(
  () => projectStore.currentProject,
  async (next, previous) => {
    if (projectSwitchBusy || next === previous || next === lastProjectPath) return
    projectSwitchBusy = true
    const accepted = await shellRef.value?.setProjectContext(next || undefined, createDesktopUiDesignerAdapters(next || undefined))
    if (!accepted) {
      try { if (previous) await projectStore.switchProject(previous); else await projectStore.clearCurrentProject() } catch { /* the project store reports the persistent selection error */ }
    } else lastProjectPath = next
    projectSwitchBusy = false
  },
)

onBeforeUnmount(() => {
  unregisterLifecycle?.()
  unregisterLifecycle = undefined
})

onBeforeRouteLeave(async () => {
  const designer = shellRef.value?.designer
  if (!designer) return true
  if (designer.isEditorPreviewing) designer.stopEditorPreview()
  if (designer.isPreviewing && !(await designer.stopPreview())) return false
  if (shellRef.value && !(await shellRef.value.disposePreview('unload'))) return false
  if (!designer.isDirty) return true
  try {
    await ElMessageBox.confirm(
      t('lifecycleMessage'),
      t('lifecycleTitle'),
      {
        type: 'warning',
        distinguishCancelAndClose: true,
        confirmButtonText: t('lifecycleSave'),
        cancelButtonText: t('lifecycleDiscard'),
        closeOnClickModal: false,
      },
    )
    if (await designer.saveAllDirtyScenes()) return true
    return false
  } catch (action) {
    const value = typeof action === 'string' ? action : (action as { action?: string } | null)?.action
    if (value === 'cancel') return Boolean(await designer.discardAllDirtyScenes())
    return false
  }
})

watch(
  () => productPlugins.isEnabled('ui-designer'),
  (enabled) => {
    if (!enabled && route.path === '/ui-designer') {
      void router.replace(productPluginDisabledRedirect('ui-designer', route.fullPath))
    }
  },
)
</script>

<template>
  <UiDesignerShell ref="shellRef" :adapters="desktopAdapters" :project-path="projectStore.currentProject || undefined" :lifecycle-adapter="lifecycleAdapter" :manage-project-context="false" :apply-project-changes="applyProjectChanges" />
</template>

<style scoped>
</style>
