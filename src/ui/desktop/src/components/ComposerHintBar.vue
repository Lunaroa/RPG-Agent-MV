<template>
  <div
    v-if="text"
    class="composer-hint"
    :class="variant"
    data-ui-id="composer-hint"
  >
    <span class="composer-hint-text">{{ text }}</span>
    <span v-if="primaryActionLabel || secondaryActionLabel" class="composer-hint-actions">
      <button v-if="primaryActionLabel" type="button" @click="$emit('primary-action')">
        {{ primaryActionLabel }}
      </button>
      <button v-if="secondaryActionLabel" type="button" class="primary" @click="$emit('secondary-action')">
        {{ secondaryActionLabel }}
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text: string
  variant?: 'info' | 'error'
  primaryActionLabel?: string
  secondaryActionLabel?: string
}>()

defineEmits<{
  'primary-action': []
  'secondary-action': []
}>()
</script>

<style scoped>
.composer-hint {
  margin: 0 0 var(--space-2);
  padding: 10px var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--el-border-color);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  pointer-events: auto;
}

.composer-hint-text {
  display: block;
}

.composer-hint-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.composer-hint-actions button {
  min-height: 30px;
  padding: 4px 12px;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.composer-hint-actions button.primary {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: var(--el-color-white);
}

.composer-hint.error .composer-hint-actions button.primary {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger);
}

.composer-hint.error {
  border-color: color-mix(in srgb, var(--el-color-danger) 45%, var(--el-border-color));
  background: color-mix(in srgb, var(--el-color-danger) 12%, transparent);
  color: var(--el-color-danger);
}
</style>
