<script setup lang="ts">
import { computed } from 'vue'
import type { UiValidationIssue } from '@contract/ui-designer'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{
  kind: 'scene' | 'action' | 'condition'
  issues?: UiValidationIssue[]
}>()
const { t } = useUiDesignerI18n()
const contextKey: Record<typeof props.kind, UiDesignerMessageKey> = {
  scene: 'sceneScriptContext',
  action: 'actionScriptContext',
  condition: 'conditionScriptContext',
}
const exampleKey: Record<typeof props.kind, UiDesignerMessageKey> = {
  scene: 'sceneScriptExample',
  action: 'actionScriptExample',
  condition: 'conditionScriptExample',
}
const codeIssues = computed(() => (props.issues ?? []).filter((issue) => issue.code === 'invalid-code'))
</script>

<template>
  <div class="script-context" :data-ui-id="`ui-designer-${kind}-script-context`">
    <span>{{ t(contextKey[kind]) }} {{ t('scriptRuntimeApi') }}</span>
    <code>{{ t(exampleKey[kind]) }}</code>
    <span v-for="issue in codeIssues" :key="`${issue.path ?? ''}:${issue.message}`" class="script-error">
      {{ t('scriptErrorLocation') }}: {{ issue.path ?? t('document') }} · {{ issue.message }}
    </span>
  </div>
</template>

<style scoped>
.script-context { display: flex; flex-direction: column; gap: 3px; color: var(--app-ink-soft); font-size: 10px; line-height: 1.4; }
.script-context code { padding: 3px 5px; border-radius: 3px; background: color-mix(in srgb, var(--app-bg) 82%, var(--app-accent) 18%); color: var(--app-ink); overflow-wrap: anywhere; }
.script-error { color: var(--el-color-danger); }
</style>
