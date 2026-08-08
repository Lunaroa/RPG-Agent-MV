<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import type { UiDesignerResourceRequest, UiResourceEntry } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{
  modelValue: boolean
  designer: UiDesignerController
  category: UiResourceEntry['category']
  currentPath?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [path: string]
}>()
const { t } = useUiDesignerI18n()
const unwrap = <T,>(value: T | Ref<T>): T => value && typeof value === 'object' && 'value' in (value as object) ? (value as Ref<T>).value : value as T
const query = ref('')
const offset = ref(0)
const page = ref<UiResourceEntry[]>([])
const MAX_RENDERED_RESOURCES = 200
const previewEntry = ref<UiResourceEntry | null>(null)
const loading = ref(false)
const error = ref('')
const categoryLabels: Record<UiResourceEntry['category'], UiDesignerMessageKey> = {
  image: 'resourceImage', audio: 'resourceAudio', video: 'resourceVideo', font: 'resourceFont', sceneData: 'resourceSceneData',
}
const designerStatus = computed(() => unwrap(props.designer.resourceStatus))
const designerMessage = computed(() => unwrap(props.designer.resourceMessage))
const hasProject = computed(() => Boolean(unwrap(props.designer.hasProject)))
const canLoad = computed(() => hasProject.value && Boolean(unwrap(props.designer.canLoadResources)))
const total = ref(0)
const hasMore = ref(false)
const canLoadMore = computed(() => hasMore.value && page.value.length < MAX_RENDERED_RESOURCES)
const categoryLabel = computed(() => t(categoryLabels[props.category]))
const safePath = (value: string) => {
  const normalized = value.replaceAll('\\', '/').trim()
  return Boolean(normalized) && !normalized.includes('://') && !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) ? normalized : ''
}

const load = async (reset: boolean) => {
  if (!canLoad.value) return
  if (reset) { offset.value = 0; page.value = []; previewEntry.value = null }
  loading.value = true
  error.value = ''
  const request: UiDesignerResourceRequest = { category: props.category, query: query.value.trim(), offset: offset.value, limit: 100 }
  try {
    const catalog = await props.designer.loadResources(request)
    if (!catalog) {
      error.value = designerMessage.value || t('resourceLoadFailed')
      return
    }
    const incoming = catalog.resources.filter((entry) => entry.category === props.category)
    page.value = reset ? incoming : [...page.value, ...incoming].slice(0, MAX_RENDERED_RESOURCES)
    offset.value = Number(catalog.offset ?? offset.value) + incoming.length
    total.value = Number(catalog.total ?? page.value.length)
    hasMore.value = Boolean(catalog.hasMore)
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError)
  } finally {
    loading.value = false
  }
}
const submitSearch = () => { void load(true) }
const retry = () => { void load(false) }
const loadMore = async () => {
  if (!canLoadMore.value || loading.value) return
  await load(false)
}
const select = (entry: UiResourceEntry) => {
  const path = safePath(entry.relativePath ?? entry.path)
  if (!path) return
  emit('select', path)
  emit('update:modelValue', false)
}
const clear = () => {
  emit('select', '')
  emit('update:modelValue', false)
}
const close = (visible: boolean) => emit('update:modelValue', visible)
const preview = (entry: UiResourceEntry) => { previewEntry.value = entry.category === 'audio' && entry.previewUrl ? entry : null }
watch(() => [props.modelValue, props.category] as const, ([visible]) => {
  if (visible) {
    query.value = ''
    offset.value = 0
    total.value = 0
    hasMore.value = false
    void load(true)
  }
})
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    :title="`${t('chooseResource')} · ${categoryLabel}`"
    width="min(640px, 92vw)"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <div class="picker-stack">
      <el-alert v-if="!hasProject" type="info" :closable="false" :title="t('noProject')" />
      <el-alert v-else-if="designerStatus === 'error' || error" type="error" :closable="false" :title="error || designerMessage || t('resourceLoadFailed')">
        <el-button size="small" @click="retry">{{ t('retry') }}</el-button>
      </el-alert>
      <div class="picker-search">
        <el-input v-model="query" size="small" clearable :placeholder="t('resourceSearch')" @keydown.enter.prevent="submitSearch" />
        <el-button size="small" type="primary" :loading="loading" :disabled="!canLoad" @click="submitSearch">{{ t('searchAction') }}</el-button>
      </div>
      <div class="picker-meta"><span>{{ total ? `${total}` : t('noResources') }}</span><span>{{ t('resourcePathHelp') }}</span></div>
      <el-scrollbar class="picker-list" max-height="360px">
        <div v-for="entry in page" :key="entry.id" class="picker-item" :class="{ selected: (entry.relativePath ?? entry.path) === props.currentPath, missing: !entry.exists }" role="button" tabindex="0" @click="select(entry)" @keydown.enter.prevent="select(entry)">
          <img v-if="entry.category === 'image' && (entry.thumbnailUrl || entry.previewUrl)" :src="entry.thumbnailUrl ?? entry.previewUrl" :alt="entry.name" class="picker-thumb" />
          <span v-else class="picker-kind">{{ t(categoryLabels[entry.category]) }}</span>
          <span class="picker-name" :title="entry.relativePath ?? entry.path">{{ entry.relativePath ?? entry.path }}</span>
          <el-button v-if="entry.category === 'audio' && entry.previewUrl" size="small" text @click.stop="preview(entry)">{{ t('previewResource') }}</el-button>
          <span v-if="!entry.exists" class="picker-missing">{{ t('missing') }}</span>
        </div>
        <div v-if="!loading && !page.length" class="picker-empty">{{ t('noResources') }}</div>
      </el-scrollbar>
      <audio v-if="previewEntry?.previewUrl" controls preload="metadata" class="picker-audio" :src="previewEntry.previewUrl" />
      <div class="picker-footer">
        <el-button size="small" :disabled="!canLoad || !canLoadMore || loading" @click="void loadMore()">{{ t('loadMore') }}</el-button>
        <span>{{ t('resourceBoundedHint') }}</span>
        <el-button size="small" text @click="clear">{{ t('clearResource') }}</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.picker-stack { display: flex; flex-direction: column; gap: 9px; color: var(--app-ink); font-size: 12px; }
.picker-search, .picker-footer, .picker-meta { display: flex; align-items: center; gap: 8px; }
.picker-search .el-input { flex: 1; }.picker-meta, .picker-footer { justify-content: space-between; color: var(--app-ink-soft); font-size: 10px; }
.picker-list { min-height: 100px; border: 1px solid var(--app-border); border-radius: 5px; }
.picker-item { display: flex; align-items: center; width: 100%; gap: 8px; padding: 6px 8px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent); background: transparent; color: var(--app-ink); cursor: pointer; text-align: left; }
.picker-item:hover, .picker-item.selected { background: color-mix(in srgb, var(--app-accent) 12%, transparent); }.picker-item.missing { color: var(--el-color-danger); }
.picker-thumb { width: 30px; height: 24px; object-fit: contain; border-radius: 2px; background: #0002; }.picker-kind { width: 42px; color: var(--app-ink-soft); font-size: 10px; text-transform: uppercase; }.picker-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.picker-missing { color: var(--el-color-danger); font-size: 10px; }.picker-empty { display: grid; min-height: 100px; place-items: center; color: var(--app-ink-soft); }.picker-audio { width: 100%; height: 28px; }
</style>
