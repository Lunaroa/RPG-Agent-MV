<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../i18n'

const route = useRoute()
const { t } = useI18n()

/**
 * A routed view (or one of its children) can throw during render/lifecycle. Without a
 * boundary that error unmounts the whole `<router-view>` subtree, leaving a blank main
 * area that survives tab switches. We surface the failure as a recoverable card instead:
 * the error is logged in full (never swallowed) and the app rail / search stay usable.
 */
const capturedError = ref<Error | null>(null)

onErrorCaptured((error) => {
  capturedError.value = error instanceof Error ? error : new Error(String(error))
  // Keep the real stack visible for diagnosis; the card only shows the message.
  console.error('[route-error-boundary] view crashed', error)
  return false
})

// A different destination mounts a fresh view, so navigating away clears the error.
watch(() => route.fullPath, () => {
  capturedError.value = null
})

function retry(): void {
  capturedError.value = null
}
</script>

<template>
  <div v-if="capturedError" class="route-error-boundary" data-ui-id="route-error-boundary">
    <div class="route-error-boundary__card">
      <p class="route-error-boundary__title">{{ t('app.viewCrashed') }}</p>
      <p class="route-error-boundary__message">{{ capturedError.message }}</p>
      <el-button size="small" type="primary" @click="retry">{{ t('app.retry') }}</el-button>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.route-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 24px;
}

.route-error-boundary__card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  max-width: 520px;
  padding: 20px 24px;
  border: 1px solid var(--el-color-danger-light-5, #f3b0b0);
  border-radius: var(--app-radius-md, 10px);
  background: var(--el-color-danger-light-9, #fef0f0);
}

.route-error-boundary__title {
  margin: 0;
  font-weight: 600;
  color: var(--el-color-danger, #c45656);
}

.route-error-boundary__message {
  margin: 0;
  font-family: var(--app-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-regular, #606266);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
