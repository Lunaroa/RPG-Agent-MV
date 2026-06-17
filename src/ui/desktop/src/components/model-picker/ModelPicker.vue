<template>
  <el-popover
    v-model:visible="visible"
    :placement="placement"
    :width="popoverWidth"
    trigger="click"
    :popper-class="popperClass"
  >
    <template #reference>
      <button
        type="button"
        class="model-picker-trigger"
        :class="[
          `model-picker-trigger--${variant}`,
          { 'is-placeholder': isPlaceholder },
        ]"
      >
        <span class="model-picker-trigger-label">{{ displayLabel }}</span>
        <span class="model-picker-trigger-chevron" aria-hidden="true">▾</span>
      </button>
    </template>

    <div class="model-picker-shell">
      <div class="model-picker-layout">
        <ModelPickerReasoning
          v-if="showReasoningPanel"
          :variants="variants"
          :thinking-level="thinkingLevel"
          :loading="reasoningLoading"
          :has-multiple-variants="hasMultipleVariants"
          @update:thinking-level="onThinkingLevelChange"
        />

        <ModelPickerPanel
          ref="panelRef"
          :providers="resolvedProviders"
          :selected-provider-id="selectedProvider"
          :selected-model-id="selectedModel"
          :allow-empty="allowEmpty"
          :empty-label="emptyLabel"
          :empty-configured-hint="emptyConfiguredHint"
          :show-group-titles="showGroupTitles"
          :show-settings-link="showSettingsLink"
          @select="onSelect"
          @clear="onClear"
        />
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import ModelPickerPanel from './ModelPickerPanel.vue'
import ModelPickerReasoning from './ModelPickerReasoning.vue'
import { useThinkingVariants } from '../../composables/useThinkingVariants'
import type { ModelPickerProvider, ModelPickerVariant } from './types'

const props = withDefaults(
  defineProps<{
    providers: ModelPickerProvider[]
    selectedProvider: string
    selectedModel: string
    variant?: ModelPickerVariant
    placement?: string
    allowEmpty?: boolean
    emptyLabel?: string
    emptyConfiguredHint?: string
    showReasoning?: boolean
    thinkingLevel?: string
    singleProviderId?: string
    placeholder?: string
    showSettingsLink?: boolean
  }>(),
  {
    variant: 'field',
    placement: 'bottom-start',
    allowEmpty: false,
    emptyLabel: '留空使用默认',
    emptyConfiguredHint: '当前没有可配置的模型',
    showReasoning: false,
    thinkingLevel: 'default',
    singleProviderId: '',
    placeholder: '选择模型',
    showSettingsLink: false,
  },
)

const emit = defineEmits<{
  select: [payload: { providerId: string; modelId: string }]
  clear: []
  'update:thinkingLevel': [value: string]
}>()

const visible = ref(false)
const panelRef = ref<InstanceType<typeof ModelPickerPanel> | null>(null)

const {
  variants,
  loading: reasoningLoading,
  currentLabel,
  hasMultipleVariants,
  showThinkingLevel,
} = useThinkingVariants(
  toRef(props, 'selectedProvider'),
  toRef(props, 'selectedModel'),
  toRef(props, 'thinkingLevel'),
  (value) => emit('update:thinkingLevel', value),
)

const resolvedProviders = computed(() => {
  if (!props.singleProviderId) return props.providers
  return props.providers.filter((p) => p.id === props.singleProviderId)
})

const showGroupTitles = computed(() => !props.singleProviderId && resolvedProviders.value.length > 1)

const showReasoningPanel = computed(
  () => props.showReasoning && showThinkingLevel.value && hasMultipleVariants.value,
)

const popoverWidth = computed(() => (showReasoningPanel.value ? 480 : 300))

const popperClass = computed(() =>
  showReasoningPanel.value
    ? 'model-picker-popper model-picker-popper--with-reasoning'
    : 'model-picker-popper',
)

const modelName = computed(() => {
  if (!props.selectedModel) return ''
  for (const provider of resolvedProviders.value) {
    if (provider.id !== props.selectedProvider) continue
    const model = provider.models.find((m) => m.id === props.selectedModel)
    if (model) return model.label || model.id
  }
  if (props.selectedModel) return `${props.selectedModel}（已隐藏）`
  return ''
})

const isPlaceholder = computed(() => !props.selectedModel)

const displayLabel = computed(() => {
  if (!props.selectedModel) {
    return props.allowEmpty ? props.emptyLabel : props.placeholder
  }
  const name = modelName.value || props.selectedModel
  if (
    props.showReasoning
    && props.thinkingLevel !== 'default'
    && hasMultipleVariants.value
    && showThinkingLevel.value
  ) {
    return `${name} · ${currentLabel.value}`
  }
  return name
})

function onThinkingLevelChange(value: string) {
  emit('update:thinkingLevel', value)
}

function onSelect(payload: { providerId: string; modelId: string }) {
  emit('select', payload)
  visible.value = false
}

function onClear() {
  emit('clear')
  visible.value = false
}

watch(visible, (open) => {
  if (!open) {
    panelRef.value?.resetSearch()
  }
})
</script>
