<template>
  <aside class="model-picker-reasoning" :aria-label="t('modelPicker.reasoning.title')">
    <div class="model-picker-reasoning-title">{{ t('modelPicker.reasoning.title') }}</div>
    <div v-if="loading" class="model-picker-reasoning-empty">{{ t('modelPicker.reasoning.loading') }}</div>
    <div v-else-if="!hasMultipleVariants" class="model-picker-reasoning-empty">
      {{ t('modelPicker.reasoning.unsupported') }}
    </div>
    <template v-else>
      <button
        v-for="variant in variants"
        :key="variant.id"
        type="button"
        class="model-picker-reasoning-row"
        :class="{ 'is-selected': variant.id === thinkingLevel }"
        @click="emit('update:thinkingLevel', variant.id)"
      >
        <span class="model-picker-reasoning-row-label">{{ variant.label }}</span>
        <el-icon v-if="variant.id === thinkingLevel" class="model-picker-check">
          <Check />
        </el-icon>
      </button>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import type { ThinkingVariant } from '../../composables/useThinkingVariants'
import { useI18n } from '../../i18n'

defineProps<{
  variants: ThinkingVariant[]
  thinkingLevel: string
  loading: boolean
  hasMultipleVariants: boolean
}>()

const emit = defineEmits<{
  'update:thinkingLevel': [value: string]
}>()

const { t } = useI18n()
</script>
