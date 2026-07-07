<template>
  <div
    v-if="text"
    class="composer-hint"
    :class="variant"
    data-ui-id="composer-hint"
  >
    {{ text }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text: string
  variant?: 'info' | 'error'
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
}

.composer-hint.error {
  border-color: color-mix(in srgb, var(--el-color-danger) 45%, var(--el-border-color));
  background: color-mix(in srgb, var(--el-color-danger) 12%, transparent);
  color: var(--el-color-danger);
}
</style>
