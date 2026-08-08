<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiFrame, UiResourceEntry } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ value: UiFrame[]; resources?: UiResourceEntry[]; loadFolder?: () => Promise<{ status: string; value?: UiResourceEntry[]; message: string } | null>; pickResource?: (currentPath?: string) => Promise<string | null>; resourcePickerDisabled?: boolean }>()
const emit = defineEmits<{ update: [value: UiFrame[]] }>()
const { t } = useUiDesignerI18n()
const error = ref('')
const errorDetail = ref('')
const imageResources = computed(() => (props.resources ?? []).filter((entry) => entry.category === 'image'))
const resourceByPath = computed(() => new Map(imageResources.value.flatMap((entry) => {
  const path = entry.relativePath ?? entry.path
  return [[path, entry], [`www/${path}`, entry]] as const
})))
const resourceForPath = (path: string) => {
  const normalized = path.replaceAll('\\', '/')
  return resourceByPath.value.get(normalized) ?? resourceByPath.value.get(normalized.replace(/^www\//, ''))
}
const update = (index: number, patch: Partial<UiFrame>) => emit('update', props.value.map((frame, itemIndex) => itemIndex === index ? { ...frame, ...patch } : frame))
const add = () => emit('update', [...props.value, { id: `frame_${String(props.value.length + 1).padStart(3, '0')}`, path: '', duration: 100 }])
const remove = (index: number) => emit('update', props.value.filter((_, itemIndex) => itemIndex !== index))
const copy = (index: number) => {
  const source = props.value[index]
  if (!source) return
  const used = new Set(props.value.map((frame) => frame.id))
  let suffix = props.value.length + 1
  let id = `${source.id || 'frame'}_copy`
  while (used.has(id)) id = `${source.id || 'frame'}_copy_${suffix++}`
  emit('update', [...props.value.slice(0, index + 1), { ...source, id }, ...props.value.slice(index + 1)])
}
const move = (index: number, direction: -1 | 1) => {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= props.value.length) return
  const frames = [...props.value]
  const [frame] = frames.splice(index, 1)
  frames.splice(nextIndex, 0, frame)
  emit('update', frames)
}
const importFolder = async () => {
  error.value = ''
  errorDetail.value = ''
  if (!props.loadFolder) { error.value = t('frameFolderUnavailable'); return }
  try {
    const result = await props.loadFolder()
    if (!result || result.status !== 'success' || !result.value) { error.value = t(result ? 'frameFolderImportFailed' : 'frameFolderCancelled'); errorDetail.value = result?.message ?? ''; return }
    const entries = result.value.filter((entry) => {
      const path = entry.relativePath ?? ''
      return entry.category === 'image' && Boolean(path) && !path.includes('://') && !path.startsWith('/') && !/^[A-Za-z]:\//.test(path)
    }).sort((a, b) => (a.relativePath ?? '').localeCompare(b.relativePath ?? ''))
    const frames = entries.map((entry, index) => ({ id: `frame_${String(props.value.length + index + 1).padStart(3, '0')}`, path: entry.relativePath!, duration: 100 }))
    if (!frames.length) { error.value = t('frameFolderEmpty'); return }
    emit('update', [...props.value, ...frames])
  } catch (importError) {
    error.value = t('frameFolderImportFailed')
    errorDetail.value = importError instanceof Error ? importError.message : String(importError)
  }
}
const chooseResource = async (index: number) => {
  const path = await props.pickResource?.(props.value[index]?.path)
  if (path !== null && path !== undefined) update(index, { path })
}
</script>

<template>
  <div class="frames-editor">
    <div class="frames-head"><span>{{ t('frames') }}</span><span><el-button size="small" text @click="add">＋</el-button><el-button size="small" text :disabled="!props.loadFolder" @click="void importFolder">{{ t('importFolder') }}</el-button></span></div>
    <span v-if="props.resourcePickerDisabled" class="resource-picker-hint">{{ t('noProject') }}</span>
    <div v-for="(frame, index) in value" :key="frame.id || index" class="frame-row">
      <el-input :model-value="frame.id" size="small" :placeholder="t('frameId')" @update:model-value="update(index, { id: $event })" />
      <img v-if="resourceForPath(frame.path)?.thumbnailUrl || resourceForPath(frame.path)?.previewUrl" class="frame-thumb" :src="resourceForPath(frame.path)?.thumbnailUrl ?? resourceForPath(frame.path)?.previewUrl" :alt="frame.id" />
      <div class="frame-resource-control"><el-input :model-value="frame.path" readonly size="small" :placeholder="props.resourcePickerDisabled ? t('noProject') : t('chooseResource')" /><el-button size="small" :disabled="!props.pickResource || props.resourcePickerDisabled" @click="void chooseResource(index)">{{ t('chooseResource') }}</el-button><el-button size="small" text :disabled="!frame.path" @click="update(index, { path: '' })">{{ t('clearResource') }}</el-button></div>
      <el-input-number :model-value="frame.duration" :min="0" size="small" @update:model-value="update(index, { duration: $event ?? 0 })" />
      <el-button-group><el-button size="small" text :disabled="index === 0" @click="move(index, -1)">↑</el-button><el-button size="small" text :disabled="index === value.length - 1" @click="move(index, 1)">↓</el-button><el-button size="small" text @click="copy(index)">{{ t('copyFrame') }}</el-button><el-button size="small" text type="danger" @click="remove(index)">×</el-button></el-button-group>
    </div>
    <span v-if="!value.length" class="empty">{{ t('emptyFrames') }}</span>
    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <details v-if="errorDetail" class="error-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ errorDetail }}</span></details>
  </div>
</template>

<style scoped>
.frames-editor { display: flex; flex-direction: column; gap: 5px; }.frames-head { display: flex; justify-content: space-between; align-items: center; color: var(--app-ink-soft); font-size: 11px; }.frame-row { display: grid; grid-template-columns: 24px 70px minmax(0, 1fr) 75px auto; gap: 4px; align-items: center; }.frame-row .el-button { padding: 3px; }.frame-thumb { width: 22px; height: 20px; object-fit: contain; border-radius: 2px; background: #0002; }.frame-resource-control { display: flex; align-items: center; min-width: 0; gap: 3px; }.frame-resource-control .el-input { min-width: 0; flex: 1; }.resource-picker-hint { color: var(--app-ink-soft); font-size: 10px; }.empty { color: var(--app-ink-soft); font-size: 10px; }.error-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
