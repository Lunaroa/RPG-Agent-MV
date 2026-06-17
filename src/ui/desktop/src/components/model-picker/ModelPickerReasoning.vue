<template>
  <aside class="model-picker-reasoning" aria-label="推理强度">
    <div class="model-picker-reasoning-title">推理强度</div>
    <div v-if="loading" class="model-picker-reasoning-empty">加载推理档位…</div>
    <div v-else-if="!hasMultipleVariants" class="model-picker-reasoning-empty">
      该模型不支持调节推理强度
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

defineProps<{
  variants: ThinkingVariant[]
  thinkingLevel: string
  loading: boolean
  hasMultipleVariants: boolean
}>()

const emit = defineEmits<{
  'update:thinkingLevel': [value: string]
}>()
</script>
