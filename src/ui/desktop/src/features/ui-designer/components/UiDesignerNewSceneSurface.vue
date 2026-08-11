<script setup lang="ts">
import { computed } from 'vue'
import { useUiDesignerI18n } from '../i18n'
import { isValidUiDesignerSceneName } from '../models/validation'

const props = defineProps<{
  modelValue: boolean
  draft: { name: string; width: number; height: number; sceneBase: string }
  template: string
  templateOptions: string[]
  templateLabel: (name: string) => string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'update:template': [value: string]; create: []; cancel: [] }>()
const { t } = useUiDesignerI18n()
const sceneNameValid = computed(() => isValidUiDesignerSceneName(props.draft.name))
const sceneNameError = computed(() => sceneNameValid.value ? '' : t('sceneNameInvalid'))
const close = (visible: boolean) => { if (!visible) emit('cancel'); emit('update:modelValue', visible) }
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('newScene')" width="min(620px, 92vw)" destroy-on-close @update:model-value="close">
    <el-form label-position="top">
      <el-form-item data-testid="ui-designer-new-scene-name" :label="t('sceneName')" :error="sceneNameError"><el-input v-model="props.draft.name" /></el-form-item>
      <el-form-item :label="t('sceneTemplates')"><el-select :model-value="props.template" @update:model-value="$emit('update:template', $event)"><el-option v-for="name in props.templateOptions" :key="name" :label="props.templateLabel(name)" :value="name" /></el-select></el-form-item>
      <el-form-item :label="t('width')"><el-input-number v-model="props.draft.width" :min="1" :max="8192" /></el-form-item>
      <el-form-item :label="t('height')"><el-input-number v-model="props.draft.height" :min="1" :max="8192" /></el-form-item>
      <el-form-item :label="t('sceneBase')"><el-input v-model="props.draft.sceneBase" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('cancel')">{{ t('lifecycleCancel') }}</el-button><el-button data-testid="ui-designer-new-confirm" type="primary" :disabled="!sceneNameValid" @click="emit('create')">{{ t('newScene') }}</el-button></template>
  </el-dialog>
</template>
