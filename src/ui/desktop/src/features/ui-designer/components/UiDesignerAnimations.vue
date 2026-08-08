<script setup lang="ts">
import type { UiAnimationConfig, UiAnimationType, UiEasing, UiNode } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ designer: UiDesignerController; node: UiNode }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const types: UiAnimationType[] = ['none', 'fadeIn', 'fadeOut', 'slideFromTop', 'slideFromBottom', 'slideFromLeft', 'slideFromRight', 'scaleIn', 'scaleOut']
const easings: UiEasing[] = ['Linear', 'EaseIn', 'EaseOut', 'EaseInOut', 'Bounce']

const update = (phase: 'enterAnim' | 'exitAnim', patch: Partial<UiAnimationConfig>) => {
  const animation = props.node[phase]
  designer.setNodeAnimation(props.node.id, phase, { ...animation, ...patch })
}
</script>

<template>
  <section class="animations-panel">
    <div class="subhead">{{ t('enterAnimation') }} / {{ t('exitAnimation') }}</div>
    <div v-for="phase in ['enterAnim', 'exitAnim']" :key="phase" class="animation-card">
      <div class="animation-title">{{ phase === 'enterAnim' ? t('enterAnimation') : t('exitAnimation') }}</div>
      <el-select :model-value="props.node[phase].type" size="small" @update:model-value="update(phase, { type: $event })">
        <el-option v-for="type in types" :key="type" :label="type" :value="type" />
      </el-select>
      <el-input-number :model-value="props.node[phase].duration" :min="0" size="small" controls-position="right" @update:model-value="update(phase, { duration: $event ?? 0 })" />
      <el-select :model-value="props.node[phase].easing" size="small" @update:model-value="update(phase, { easing: $event })">
        <el-option v-for="easing in easings" :key="easing" :label="easing" :value="easing" />
      </el-select>
    </div>
  </section>
</template>

<style scoped>
.animations-panel { display: flex; flex-direction: column; gap: 9px; min-height: 0; overflow: auto; }
.subhead, .animation-title { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.animation-card { display: flex; flex-direction: column; gap: 7px; padding: 8px; border: 1px solid var(--app-border); border-radius: 5px; }
.animation-title { font-size: 10px; }
</style>
