import { computed, ref, watch, type Ref } from 'vue'
import {
  normalizeStoredThinkingLevel,
  resolveThinkingVariantsForModel,
  type ThinkingVariant,
} from '@contract/model-reasoning-registry'

export type { ThinkingVariant }

const DEFAULT_VARIANTS: ThinkingVariant[] = [{ id: 'default', label: '默认' }]

export function useThinkingVariants(
  selectedProvider: Ref<string>,
  selectedModel: Ref<string>,
  thinkingLevel: Ref<string>,
  onThinkingLevelChange: (value: string) => void
) {
  const variants = ref<ThinkingVariant[]>([...DEFAULT_VARIANTS])

  const currentLabel = computed(() => {
    const match = variants.value.find((v) => v.id === thinkingLevel.value)
    return match?.label || '默认'
  })

  const hasMultipleVariants = computed(() => variants.value.length > 1)

  /** 已选 provider/model 且模型有多档官方推理参数时展示左栏。 */
  const showThinkingLevel = computed(
    () => Boolean(selectedProvider.value && selectedModel.value && hasMultipleVariants.value)
  )

  function applyLocalVariants() {
    if (!selectedProvider.value || !selectedModel.value) {
      variants.value = [...DEFAULT_VARIANTS]
      return
    }
    variants.value = resolveThinkingVariantsForModel(
      selectedProvider.value,
      selectedModel.value,
    )
    const normalized = normalizeStoredThinkingLevel(
      selectedProvider.value,
      selectedModel.value,
      thinkingLevel.value,
    )
    if (normalized !== thinkingLevel.value) {
      onThinkingLevelChange(normalized)
    }
  }

  watch(
    () => [selectedProvider.value, selectedModel.value] as const,
    () => {
      applyLocalVariants()
    },
    { immediate: true }
  )

  return {
    variants,
    loading: ref(false),
    currentLabel,
    hasMultipleVariants,
    showThinkingLevel,
    loadVariants: applyLocalVariants,
  }
}
