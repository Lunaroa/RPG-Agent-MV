<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'
import type { UiDesignerMessageKey } from '../i18n'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
type ResourceCategory = 'all' | 'image' | 'audio' | 'video' | 'font' | 'sceneData'
const resourceCategory = ref<ResourceCategory>('all')
const categoryLabels: Record<ResourceCategory, UiDesignerMessageKey> = {
  all: 'resourceAll', image: 'resourceImage', audio: 'resourceAudio', video: 'resourceVideo', font: 'resourceFont', sceneData: 'resourceSceneData',
}
const visibleResources = computed(() => {
  const resources = designer.filteredResources
  return resourceCategory.value === 'all' ? resources : resources.filter((resource) => resource.category === resourceCategory.value)
})

onMounted(() => { void designer.loadResources() })

const resourceDrag = (event: DragEvent, path: string, category: string) => {
  if (!event.dataTransfer) return
  const normalizedPath = path.replaceAll('\\', '/').trim()
  if (normalizedPath.includes('://') || normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath)) {
    event.preventDefault()
    return
  }
  event.dataTransfer.setData('text/ui-resource-path', normalizedPath)
  event.dataTransfer.setData('text/ui-resource-category', category)
  event.dataTransfer.effectAllowed = 'copy'
}
const importSceneData = async (path: string) => {
  try {
    await ElMessageBox.confirm(t('sceneDataReadOnly'), t('sceneDataImportTitle'), { type: 'warning', distinguishCancelAndClose: true, confirmButtonText: t('importSceneData'), cancelButtonText: t('lifecycleCancel'), closeOnClickModal: false })
    await designer.importSceneData(path, true)
  } catch {
    // Cancel and close are intentionally silent; adapter failures remain in
    // the controller status area for a recoverable retry.
  }
}
</script>

<template>
  <section class="resource-panel">
    <div class="panel-heading">
      <span>{{ t('resources') }}</span>
      <el-button size="small" text :disabled="!designer.canLoadResources" @click="void designer.loadResources()">↻</el-button>
    </div>
    <el-input v-model="designer.searchTerm" size="small" clearable :placeholder="t('resourceSearch')" />
    <el-select v-model="resourceCategory" size="small" :aria-label="t('resourceCategory')">
      <el-option v-for="(label, value) in categoryLabels" :key="value" :value="value" :label="t(label)" />
    </el-select>
    <el-alert v-if="designer.resourceStatus === 'unavailable'" type="info" :closable="false" :title="designer.hasProject ? t('unavailable') : t('noProject')">
      <details v-if="designer.resourceMessage" class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ designer.resourceMessage }}</span></details>
    </el-alert>
    <div v-if="!designer.resourceCatalog" class="resource-empty">
      <span>{{ t('noProject') }}</span>
    </div>
    <div v-else-if="visibleResources.length === 0" class="resource-empty">
      <span>{{ t('noResources') }}</span>
    </div>
    <ul v-else class="resource-list">
      <li
        v-for="resource in visibleResources"
        :key="resource.id"
        class="resource-item"
        :draggable="resource.category !== 'sceneData'"
        :class="{ missing: !resource.exists }"
        :title="resource.category === 'sceneData' ? t('sceneDataReadOnly') : (resource.relativePath ?? resource.path)"
        @dragstart="resource.category !== 'sceneData' && resourceDrag($event, resource.relativePath ?? resource.path, resource.category)"
      >
        <img v-if="(resource.category === 'image' || resource.category === 'video') && (resource.thumbnailUrl || resource.previewUrl)" class="resource-thumb" :src="resource.thumbnailUrl ?? resource.previewUrl" :alt="resource.name" />
        <audio v-else-if="resource.category === 'audio' && resource.previewUrl" class="resource-audio" controls preload="metadata" :src="resource.previewUrl" />
        <span v-else-if="resource.category === 'font'" class="resource-font-preview">Aa</span>
        <span class="resource-category">{{ t(categoryLabels[resource.category]) }}</span>
        <span class="resource-name">{{ resource.name }}</span>
        <span v-if="resource.category === 'sceneData'" class="resource-scene-meta" :title="resource.diagnostic ?? t('sceneDataReadOnly')"><span>{{ resource.compatibility ?? t('sceneDataRuntimeOnly') }}</span><el-button size="small" text :disabled="!resource.exists || resource.compatibility !== 'compatible' || !designer.hasProject" @click.stop="void importSceneData(resource.relativePath ?? resource.path)">{{ t('importSceneData') }}</el-button></span>
        <span v-else-if="!resource.exists" class="resource-ref resource-missing">{{ t('missing') }}</span>
        <span v-else-if="resource.referenced" class="resource-ref">✓</span>
        <span v-else class="resource-ref">·</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.resource-panel { display: flex; flex-direction: column; gap: 9px; min-height: 0; height: 100%; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.resource-empty { display: grid; place-items: center; min-height: 150px; padding: 18px; color: var(--app-ink-soft); font-size: 12px; text-align: center; line-height: 1.5; }
.resource-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; overflow: auto; list-style: none; }
.resource-item { display: flex; align-items: center; gap: 7px; padding: 6px 7px; border: 1px solid transparent; border-radius: 4px; cursor: grab; font-size: 12px; }
.resource-item:hover { border-color: var(--app-border); background: color-mix(in srgb, var(--app-accent) 9%, transparent); }
.resource-item.missing { opacity: .55; }
.resource-category { min-width: 48px; color: var(--app-ink-soft); font-size: 10px; text-transform: uppercase; }
.resource-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-ref { margin-left: auto; color: var(--el-color-success); }.resource-missing { color: var(--el-color-danger); font-size: 10px; }.resource-scene-meta { margin-left: auto; color: var(--app-ink-soft); font-size: 10px; }
.resource-thumb { width: 28px; height: 22px; object-fit: contain; border-radius: 2px; background: #0002; }.resource-audio { width: 92px; height: 22px; }.resource-font-preview { display: grid; place-items: center; width: 28px; color: var(--app-accent); font-family: serif; font-size: 15px; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
