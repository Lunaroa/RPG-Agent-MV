<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ modelValue: boolean; designer: UiDesignerController }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; open: [path: string] }>()
const { t, language } = useUiDesignerI18n()
const close = (visible: boolean) => emit('update:modelValue', visible)
const formatDate = (value?: string) => {
  if (!value) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(language.value) : value
}
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('openSceneTitle')" width="min(680px, 94vw)" destroy-on-close @update:model-value="close">
    <div v-if="designer.sceneFiles.length" class="scene-list">
      <button v-for="item in designer.sceneFiles" :key="item.sourcePath" type="button" class="scene-row" @click="emit('open', item.sourcePath)">
        <span class="scene-thumbnail">
          <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="" />
          <span v-else>UI</span>
        </span>
        <span class="scene-copy"><strong>{{ item.sceneName }}</strong><small>{{ formatDate(item.modifiedAt) }}</small></span>
      </button>
    </div>
    <el-empty v-else :description="t('noProjectScenes')" />
  </el-dialog>
</template>

<style scoped>
.scene-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.scene-row { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 8px; border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-bg); color: var(--app-ink); cursor: pointer; text-align: left; }
.scene-row:hover { border-color: var(--app-accent); }
.scene-thumbnail { display: grid; place-items: center; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 5px; background: var(--app-bg-soft); color: var(--app-ink-soft); font-weight: 700; }
.scene-thumbnail img { width: 100%; height: 100%; object-fit: cover; }
.scene-copy { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.scene-copy strong, .scene-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-copy small { color: var(--app-ink-soft); }
</style>
