<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { UiDesignerController } from '../features/ui-designer/composables/useUiDesigner'
import UiDesignerShell from '../features/ui-designer/components/UiDesignerShell.vue'
import { createDesktopUiDesignerAdapters } from '../features/ui-designer/adapters'
import { useUiDesignerI18n } from '../features/ui-designer/i18n'
import { useProductPluginsStore } from '../stores/productPlugins'
import { productPluginDisabledRedirect } from '../utils/projectManagementRoute'
import { registerProductPluginLifecycleGuard } from '../utils/productPluginLifecycle'
import { useProjectStore } from '../stores/project'

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
  <UiDesignerShell ref="shellRef" :adapters="desktopAdapters" :project-path="projectStore.currentProject || undefined" :manage-project-context="false" />
</template>

<style scoped>
</style>
