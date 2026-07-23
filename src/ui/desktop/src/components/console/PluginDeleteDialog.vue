<script setup lang="ts">
import { useI18n } from '../../i18n';

defineProps<{
  visible: boolean;
  busy: boolean;
  pluginName: string;
  pluginPath: string;
}>();

defineEmits<{
  close: [];
  removeConfiguration: [];
  deleteFile: [];
}>();

const { t } = useI18n();
</script>

<template>
  <el-dialog
    data-ui-id="plugin-delete-dialog"
    :model-value="visible"
    :title="t('plugins.deleteTitle')"
    width="min(520px, 92vw)"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @close="$emit('close')"
  >
    <div class="delete-message">
      <p>{{ t('plugins.deleteChoiceMessage', { name: pluginName }) }}</p>
      <div class="delete-choice">
        <strong>{{ t('plugins.removeConfigOnly') }}</strong>
        <span>{{ t('plugins.removeConfigOnlyDescription') }}</span>
      </div>
      <div class="delete-choice destructive">
        <strong>{{ t('plugins.deleteFileAndConfig') }}</strong>
        <span>{{ t('plugins.deleteFileAndConfigDescription', { path: pluginPath }) }}</span>
      </div>
      <p class="staging-note">{{ t('plugins.deleteStagingNotice') }}</p>
    </div>
    <template #footer>
      <el-button :disabled="busy" @click="$emit('close')">
        {{ t('editor.mapProperties.cancel') }}
      </el-button>
      <el-button :disabled="busy" @click="$emit('removeConfiguration')">
        {{ t('plugins.removeConfigOnly') }}
      </el-button>
      <el-button type="danger" :disabled="busy" @click="$emit('deleteFile')">
        {{ t('plugins.deleteFileAndConfig') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.delete-message {
  display: grid;
  gap: 10px;
  color: var(--console-text-soft, #5a5247);
  font-size: 12px;
  line-height: 1.7;
}
.delete-message p {
  margin: 0;
}
.delete-choice {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 8px;
  background: var(--console-paper-soft, #faf5ec);
}
.delete-choice strong {
  color: var(--console-text, #211d17);
}
.delete-choice.destructive {
  border-color: color-mix(in srgb, var(--app-danger) 38%, var(--console-border, #e4dcce));
  background: var(--app-danger-soft);
}
.delete-choice.destructive strong {
  color: var(--app-danger);
}
.staging-note {
  color: var(--console-text-muted, #9a8e7e);
  font-size: 11px;
}
</style>
