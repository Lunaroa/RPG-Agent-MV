<script setup lang="ts">
import { computed } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiNode, UiVisibilityCondition } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'
import UiConditionEditor from './UiConditionEditor.vue'

const props = defineProps<{ designer: UiDesignerController; node: UiNode }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const condition = computed(() => props.node.condition)
const update = (next: UiVisibilityCondition) => designer.setNodeCondition(props.node.id, next)
</script>

<template>
  <section class="condition-panel">
    <div class="subhead">{{ t('condition') }}</div>
    <label class="frequency-field">
      <span>{{ t('conditionFrequency') }}</span>
      <el-select :model-value="node.conditionFrequency" size="small" @update:model-value="designer.setNodeConditionFrequency(node.id, $event)">
        <el-option :label="t('perFrame')" value="per-frame" />
        <el-option :label="t('every10Frames')" value="every-10-frames" />
        <el-option :label="t('perSecond')" value="per-second" />
      </el-select>
    </label>
    <UiConditionEditor :condition="condition" :designer="designer" @update="update" />
  </section>
</template>

<style scoped>
.condition-panel { display: flex; flex-direction: column; gap: 9px; min-height: 0; overflow: auto; }
.subhead { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.frequency-field { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 7px; color: var(--app-ink-soft); font-size: 11px; }
.composite-condition { display: flex; flex-direction: column; gap: 5px; }
.condition-child { padding: 6px 8px; border: 1px solid var(--app-border); border-radius: 4px; color: var(--app-ink-soft); font-size: 11px; }
.hint { margin: 3px 0 0; color: var(--app-ink-soft); font-size: 10px; line-height: 1.4; }
</style>
