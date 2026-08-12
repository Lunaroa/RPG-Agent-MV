<script setup lang="ts">
import { computed } from 'vue'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { UI_DESIGNER_LOCAL_SHORTCUTS, type UiDesignerShortcutDisplay } from '../composables/shortcutRegistry'

const props = defineProps<{
  modelValue: boolean
  surface: 'help' | 'shortcuts' | 'tour'
  tourStep: number
  shortcutBindings: UiDesignerShortcutDisplay[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'update:tourStep': [value: number]; complete: [] }>()
const { t } = useUiDesignerI18n()
const tourSteps: UiDesignerMessageKey[] = ['tourStep1', 'tourStep2', 'tourStep3', 'tourStep4', 'tourStep5']
const title = () => props.surface === 'help' ? t('help') : props.surface === 'shortcuts' ? t('shortcuts') : t('tour')
const close = (visible: boolean) => emit('update:modelValue', visible)
const finish = () => emit('complete')
const formatShortcut = (binding: UiDesignerShortcutDisplay) => [binding.ctrlOrMeta ? 'Ctrl/Cmd' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '', binding.key].filter(Boolean).join(' + ')
const allShortcutBindings = computed(() => [...props.shortcutBindings, ...UI_DESIGNER_LOCAL_SHORTCUTS])
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="title()" width="min(620px, 92vw)" destroy-on-close :data-ui-id="props.surface === 'tour' ? 'ui-designer-onboarding-dialog' : undefined" :data-testid="props.surface === 'tour' ? 'ui-designer-onboarding-dialog' : undefined" @update:model-value="close">
    <template v-if="props.surface === 'help'">
      <div class="dialog-copy"><p>{{ t('helpBody') }}</p><p>{{ t('resourcePathHelp') }}</p></div>
    </template>
    <template v-else-if="props.surface === 'shortcuts'">
      <dl class="shortcut-list"><template v-for="binding in allShortcutBindings" :key="`${formatShortcut(binding)}-${binding.description ?? ''}`"><dt>{{ formatShortcut(binding) }}</dt><dd>{{ binding.description ? t(binding.description as UiDesignerMessageKey) : t('shortcutCommand') }}</dd></template><dt>Ctrl/Cmd + click</dt><dd>{{ t('shortcutMulti') }}</dd><dt>Ctrl/Cmd + F</dt><dd>{{ t('shortcutSearch') }}</dd><dt>Ctrl/Cmd + H</dt><dd>{{ t('shortcutReplace') }}</dd><dt>Ctrl/Cmd + Space</dt><dd>{{ t('shortcutHint') }}</dd><dt>Wheel + Ctrl/Cmd</dt><dd>{{ t('shortcutZoom') }}</dd></dl>
    </template>
    <template v-else>
      <div class="tour-copy"><strong>{{ props.tourStep + 1 }}/{{ tourSteps.length }}</strong><p>{{ t(tourSteps[props.tourStep] ?? tourSteps[0]) }}</p><el-button-group><el-button :disabled="props.tourStep === 0" @click="emit('update:tourStep', Math.max(0, props.tourStep - 1))">←</el-button><el-button :disabled="props.tourStep === tourSteps.length - 1" @click="emit('update:tourStep', Math.min(tourSteps.length - 1, props.tourStep + 1))">→</el-button></el-button-group><div class="tour-actions"><el-button data-ui-id="ui-designer-onboarding-skip" data-testid="ui-designer-onboarding-skip" @click="finish">{{ t('skip') }}</el-button><el-button data-ui-id="ui-designer-onboarding-finish" data-testid="ui-designer-onboarding-finish" type="primary" @click="finish">{{ t('finish') }}</el-button></div></div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-copy, .tour-copy { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.dialog-copy p { margin: 0 0 10px; }.tour-copy p { min-height: 50px; }.shortcut-list { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin: 0; font-size: 12px; }.shortcut-list dt { color: var(--app-ink-soft); }.shortcut-list dd { margin: 0; }.tour-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
