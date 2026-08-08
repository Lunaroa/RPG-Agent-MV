<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiVisibilityCondition } from '@contract/ui-designer'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{ condition: UiVisibilityCondition; designer: UiDesignerController }>()
const emit = defineEmits<{ update: [condition: UiVisibilityCondition] }>()
const { t } = useUiDesignerI18n()
const conditionLabels: Record<UiVisibilityCondition['type'], UiDesignerMessageKey> = { none: 'conditionNone', switch_on: 'conditionSwitchOn', switch_off: 'conditionSwitchOff', variable: 'conditionVariable', code: 'conditionCode', and: 'conditionAnd', or: 'conditionOr' }

const update = (patch: Partial<UiVisibilityCondition>) => emit('update', { ...props.condition, ...patch } as UiVisibilityCondition)
const updateChild = (index: number, child: UiVisibilityCondition) => {
  if (props.condition.type !== 'and' && props.condition.type !== 'or') return
  emit('update', { ...props.condition, children: props.condition.children.map((item, itemIndex) => itemIndex === index ? child : item) })
}
const removeChild = (index: number) => {
  if (props.condition.type !== 'and' && props.condition.type !== 'or') return
  emit('update', { ...props.condition, children: props.condition.children.filter((_, itemIndex) => itemIndex !== index) })
}
const addChild = () => {
  if (props.condition.type !== 'and' && props.condition.type !== 'or') return
  emit('update', { ...props.condition, children: [...props.condition.children, { type: 'none' }] })
}
</script>

<template>
  <div class="condition-editor">
    <el-select :model-value="condition.type" size="small" @update:model-value="(type: UiVisibilityCondition['type']) => {
      if (type === 'none') update({ type })
      else if (type === 'switch_on' || type === 'switch_off') update({ type, switchId: 1 })
      else if (type === 'variable') update({ type, variableId: 1, operator: '>=', value: 0 })
      else if (type === 'code') update({ type, code: 'true' })
      else update({ type, children: [{ type: 'none' }] })
    }">
      <el-option v-for="type in ['none', 'switch_on', 'switch_off', 'variable', 'code', 'and', 'or']" :key="type" :label="t(conditionLabels[type as UiVisibilityCondition['type']])" :value="type" />
    </el-select>
    <el-input-number v-if="condition.type === 'switch_on' || condition.type === 'switch_off'" :model-value="condition.switchId" :min="1" size="small" @update:model-value="update({ switchId: $event ?? 1 })" />
    <div v-else-if="condition.type === 'variable'" class="condition-fields">
      <el-input-number :model-value="condition.variableId" :min="1" size="small" @update:model-value="update({ variableId: $event ?? 1 })" />
      <el-select :model-value="condition.operator" size="small" @update:model-value="update({ operator: $event })"><el-option v-for="operator in ['==', '>=', '<=', '>', '<', '!=']" :key="operator" :label="operator" :value="operator" /></el-select>
      <el-input-number :model-value="condition.value" size="small" @update:model-value="update({ value: $event ?? 0 })" />
    </div>
    <UiCodeMirrorEditor v-else-if="condition.type === 'code'" :adapter="designer.adapters.code" :model-value="condition.code" :rows="3" :debounce-ms="1000" :scene-id="designer.activeSceneId" :draft-coordinator="designer.draftCoordinator" @update:model-value="update({ code: $event })" />
    <div v-else-if="condition.type === 'and' || condition.type === 'or'" class="condition-children">
      <div v-for="(child, index) in condition.children" :key="index" class="condition-child">
        <UiConditionEditor :condition="child" :designer="designer" @update="updateChild(index, $event)" />
        <el-button size="small" text type="danger" @click="removeChild(index)">×</el-button>
      </div>
      <el-button size="small" text @click="addChild">＋ {{ t('child') }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.condition-editor { display: flex; flex-direction: column; gap: 7px; padding: 7px; border: 1px solid var(--app-border); border-radius: 5px; }
.condition-fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
.condition-children { display: flex; flex-direction: column; gap: 6px; }
.condition-child { display: flex; align-items: flex-start; gap: 4px; }
.condition-child > .condition-editor { flex: 1; }
</style>
