<script setup lang="ts">
import { useUiDesignerI18n } from '../i18n'

defineProps<{
  modelValue: boolean
  busy?: boolean
}>()
const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
const { t } = useUiDesignerI18n()
</script>

<template>
  <el-dialog :model-value="modelValue" append-to-body :title="t('runtimeReplacementTitle')" width="min(500px, 92vw)" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false">
    <div class="runtime-replacement-copy">
      <p>{{ t('runtimeReplacementBody') }}</p>
      <p>{{ t('runtimeReplacementBackupHint') }}</p>
    </div>
    <template #footer>
      <el-button data-testid="ui-designer-runtime-replacement-cancel" :disabled="busy" @click="emit('cancel')">{{ t('lifecycleCancel') }}</el-button>
      <el-button data-testid="ui-designer-runtime-replacement-confirm" type="danger" :loading="busy" @click="emit('confirm')">{{ t('runtimeReplacementConfirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.runtime-replacement-copy { color: var(--app-ink-soft); font-size: 13px; line-height: 1.6; }
.runtime-replacement-copy p { margin: 0; }
.runtime-replacement-copy p + p { margin-top: 8px; }
</style>
