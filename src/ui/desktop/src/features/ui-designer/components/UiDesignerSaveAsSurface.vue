<script setup lang="ts">
import { ref } from 'vue'
import { useUiDesignerI18n } from '../i18n'
import { isValidUiDesignerSceneName } from '../models/validation'

const props = defineProps<{ modelValue: boolean; initialName: string; busy?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; save: [sceneName: string] }>()
const { t } = useUiDesignerI18n()
const sceneName = ref(props.initialName)
const submit = () => {
  const value = sceneName.value.trim()
  if (isValidUiDesignerSceneName(value)) emit('save', value)
}
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('saveAsTitle')" width="min(460px, 92vw)" destroy-on-close :close-on-click-modal="false" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item :label="t('sceneName')" :error="sceneName && !isValidUiDesignerSceneName(sceneName.trim()) ? t('sceneNameInvalid') : ''">
        <el-input v-model="sceneName" autofocus @keydown.enter.prevent="submit" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="props.busy" @click="emit('update:modelValue', false)">{{ t('lifecycleCancel') }}</el-button>
      <el-button type="primary" :loading="props.busy" :disabled="!isValidUiDesignerSceneName(sceneName.trim())" @click="submit">{{ t('saveAs') }}</el-button>
    </template>
  </el-dialog>
</template>
