import { computed, ref, watch, type Ref } from 'vue'
import {
  normalizeStoredThinkingLevel,
  resolveThinkingVariantsForModel,
  type ThinkingVariant,
} from '@contract/model-reasoning-registry'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export type { ThinkingVariant }

const DEFAULT_VARIANTS: ThinkingVariant[] = [{ id: 'default', label: 'default' }]

export function useThinkingVariants(
  selectedProvider: Ref<string>,
  selectedModel: Ref<string>,
  thinkingLevel: Ref<string>,
  onThinkingLevelChange: (value: string) => void,
  productLanguage?: Ref<ProductLanguage>,
) {
  const rawVariants = ref<ThinkingVariant[]>([...DEFAULT_VARIANTS])
  const variants = computed(() => rawVariants.value.map((variant) => localizeThinkingVariant(variant, productLanguage?.value)))

  const currentLabel = computed(() => {
    const match = variants.value.find((v) => v.id === thinkingLevel.value)
    return match?.label || localizeThinkingVariantLabel('default', 'default', productLanguage?.value)
  })

  const hasMultipleVariants = computed(() => variants.value.length > 1)

  /** 已选 provider/model 且模型有多档官方推理参数时展示左栏。 */
  const showThinkingLevel = computed(
    () => Boolean(selectedProvider.value && selectedModel.value && hasMultipleVariants.value)
  )

  function applyLocalVariants() {
    if (!selectedProvider.value || !selectedModel.value) {
      rawVariants.value = [...DEFAULT_VARIANTS]
      return
    }
    rawVariants.value = resolveThinkingVariantsForModel(
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

function localizeThinkingVariant(variant: ThinkingVariant, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): ThinkingVariant {
  language = normalizeProductLanguage(language)
  const label = localizeThinkingVariantLabel(variant.id, variant.label, language)
  return label === variant.label ? variant : { ...variant, label }
}

function localizeThinkingVariantLabel(id: string, label: string, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  if (id === 'default') return translate('thinking.default', language)
  return label
}
