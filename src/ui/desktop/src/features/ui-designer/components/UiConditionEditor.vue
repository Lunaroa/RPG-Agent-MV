<script setup lang="ts">
import { computed, isRef, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiDesignerDocument, UiNode, UiValidationReport, UiVisibilityCondition } from '@contract/ui-designer'
import { UI_DESIGNER_NODE_SCRIPT_COMPLETIONS } from '@contract/ui-designer-script'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import UiNamedEntryField from './UiNamedEntryField.vue'
import UiScriptContextHint from './UiScriptContextHint.vue'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = withDefaults(defineProps<{ condition: UiVisibilityCondition; designer: UiDesignerController; path?: string }>(), { path: 'condition' })
const emit = defineEmits<{ update: [condition: UiVisibilityCondition] }>()
const { t } = useUiDesignerI18n()
const conditionLabels: Record<UiVisibilityCondition['type'], UiDesignerMessageKey> = { none: 'conditionNone', switch_on: 'conditionSwitchOn', switch_off: 'conditionSwitchOff', variable: 'conditionVariable', code: 'conditionCode', and: 'conditionAnd', or: 'conditionOr' }
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const designerDocument = computed(() => unwrap<UiDesignerDocument>(props.designer.document))
const selectedNode = computed(() => unwrap<UiNode | undefined>(props.designer.selectedNode))
const scriptCompletionItems = computed(() => [...UI_DESIGNER_NODE_SCRIPT_COMPLETIONS, ...designerDocument.value.nodes.flatMap((node) => [node.id, node.name])])
const codeIssues = computed(() => unwrap<UiValidationReport>(props.designer.validation).issues.filter((issue) => issue.code === 'invalid-code' && issue.nodeId === selectedNode.value?.id && issue.path === props.path))

const liveCondition = (): UiVisibilityCondition => {
  let condition = selectedNode.value?.condition
  if (!condition || props.path === 'condition') return condition ?? props.condition
  const segments = props.path.split('.').slice(1)
  for (let index = 0; index < segments.length; index += 2) {
    if (segments[index] !== 'children' || (condition.type !== 'and' && condition.type !== 'or')) return props.condition
    const childIndex = Number(segments[index + 1])
    if (!Number.isInteger(childIndex) || !condition.children[childIndex]) return props.condition
    condition = condition.children[childIndex]
  }
  return condition
}
const update = (patch: Partial<UiVisibilityCondition>, base: UiVisibilityCondition = liveCondition()) => emit('update', { ...base, ...patch } as UiVisibilityCondition)
const setConditionType = (type: UiVisibilityCondition['type']) => {
  props.designer.flushDrafts(props.designer.activeSceneId)
  const current = liveCondition()
  if (type === 'none') update({ type }, current)
  else if (type === 'switch_on' || type === 'switch_off') update({ type, switchId: 1 }, current)
  else if (type === 'variable') update({ type, variableId: 1, operator: '>=', value: 0 }, current)
  else if (type === 'code') update({ type, code: 'true' }, current)
  else update({ type, children: [{ type: 'none' }] }, current)
}
const updateChild = (index: number, child: UiVisibilityCondition) => {
  const current = liveCondition()
  if (current.type !== 'and' && current.type !== 'or') return
  emit('update', { ...current, children: current.children.map((item, itemIndex) => itemIndex === index ? child : item) })
}
const removeChild = (index: number) => {
  if (props.condition.type !== 'and' && props.condition.type !== 'or') return
  props.designer.flushDrafts(props.designer.activeSceneId)
  const current = liveCondition()
  if (current.type !== 'and' && current.type !== 'or') return
  emit('update', { ...current, children: current.children.filter((_, itemIndex) => itemIndex !== index) })
}
const addChild = () => {
  if (props.condition.type !== 'and' && props.condition.type !== 'or') return
  props.designer.flushDrafts(props.designer.activeSceneId)
  const current = liveCondition()
  if (current.type !== 'and' && current.type !== 'or') return
  emit('update', { ...current, children: [...current.children, { type: 'none' }] })
}
</script>

<template>
  <div class="condition-editor">
    <el-select :model-value="condition.type" size="small" @update:model-value="setConditionType">
      <el-option v-for="type in ['none', 'switch_on', 'switch_off', 'variable', 'code', 'and', 'or']" :key="type" :label="t(conditionLabels[type as UiVisibilityCondition['type']])" :value="type" />
    </el-select>
    <UiNamedEntryField v-if="condition.type === 'switch_on' || condition.type === 'switch_off'" kind="switch" :model-value="condition.switchId" :ui-id="`ui-designer-condition-${path}-switch`" @update:model-value="update({ switchId: $event })" />
    <div v-else-if="condition.type === 'variable'" class="condition-fields">
      <UiNamedEntryField kind="variable" :model-value="condition.variableId" :ui-id="`ui-designer-condition-${path}-variable`" @update:model-value="update({ variableId: $event })" />
      <el-select :model-value="condition.operator" size="small" @update:model-value="update({ operator: $event })"><el-option v-for="operator in ['==', '>=', '<=', '>', '<', '!=']" :key="operator" :label="operator" :value="operator" /></el-select>
      <el-input-number :model-value="condition.value" size="small" @update:model-value="update({ value: $event ?? 0 })" />
    </div>
    <template v-else-if="condition.type === 'code'">
      <UiCodeMirrorEditor :adapter="designer.adapters.code" :model-value="condition.code" :rows="3" resizable :debounce-ms="1000" :format-on-blur="Boolean(designer.preferences.autoFormat)" :font-family="designer.preferences.codeFontFamily" :font-size="designer.preferences.codeFontSize" :completion-items="scriptCompletionItems" :scene-id="designer.activeSceneId" :draft-coordinator="designer.draftCoordinator" @update:model-value="update({ code: $event })" />
      <UiScriptContextHint kind="condition" :issues="codeIssues" />
    </template>
    <div v-else-if="condition.type === 'and' || condition.type === 'or'" class="condition-children">
      <div v-for="(child, index) in condition.children" :key="index" class="condition-child">
        <UiConditionEditor :data-ui-id="`ui-designer-condition-${path}-child-${index}`" :condition="child" :designer="designer" :path="`${path}.children.${index}`" @update="updateChild(index, $event)" />
        <el-button size="small" text type="danger" @click="removeChild(index)">×</el-button>
      </div>
      <el-button data-ui-id="ui-designer-condition-add-child" size="small" text @click="addChild">＋ {{ t('child') }}</el-button>
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
