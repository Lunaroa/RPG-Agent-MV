<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: string
  placeholder: string
  selectLabel: string
  clearLabel: string
  selectDisabled?: boolean
  valueUiId?: string
  selectUiId?: string
  clearUiId?: string
}>()
const emit = defineEmits<{ select: []; clear: [] }>()
</script>

<template>
  <el-input
    :model-value="props.modelValue"
    readonly
    size="small"
    :placeholder="props.placeholder"
    :data-ui-id="props.valueUiId"
    :data-testid="props.valueUiId"
  >
    <template #append>
      <span class="resource-actions">
        <el-button
          :data-ui-id="props.selectUiId"
          :data-testid="props.selectUiId"
          size="small"
          :disabled="props.selectDisabled"
          @click="emit('select')"
        >{{ props.selectLabel }}</el-button>
        <el-tooltip v-if="props.modelValue" :content="props.clearLabel" placement="top">
          <el-button
            class="resource-clear"
            :data-ui-id="props.clearUiId"
            :data-testid="props.clearUiId"
            size="small"
            :aria-label="props.clearLabel"
            @click="emit('clear')"
          >
            <el-icon><Close /></el-icon>
          </el-button>
        </el-tooltip>
      </span>
    </template>
  </el-input>
</template>

<style scoped>
.resource-actions { display: inline-flex; align-items: stretch; height: 100%; margin-left: -20px; margin-right: -20px; }
.resource-actions .el-button { height: 100%; margin: 0; border: 0; border-radius: 0; }
.resource-actions .el-button + .el-button { border-left: 1px solid var(--el-border-color); }
.resource-clear { width: 28px; padding: 0; }
</style>
