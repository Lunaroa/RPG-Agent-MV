<script setup lang="ts">
import type { UiAnimationConfig, UiAnimationType, UiEasing, UiNode } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{ designer: UiDesignerController; node: UiNode }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const types: UiAnimationType[] = ['none', 'fadeIn', 'fadeOut', 'slideFromTop', 'slideFromBottom', 'slideFromLeft', 'slideFromRight', 'scaleIn', 'scaleOut']
const easings: UiEasing[] = ['Linear', 'EaseIn', 'EaseOut', 'EaseInOut', 'Bounce']
const phases = (): Array<'enterAnim' | 'exitAnim' | 'focusAnim'> => props.node.type === 'button'
  ? ['enterAnim', 'exitAnim', 'focusAnim']
  : ['enterAnim', 'exitAnim']
const phaseLabel = (phase: 'enterAnim' | 'exitAnim' | 'focusAnim') => phase === 'enterAnim'
  ? t('enterAnimation')
  : phase === 'exitAnim' ? t('exitAnimation') : t('focusAnimation')
const typeLabels: Record<UiAnimationType, UiDesignerMessageKey> = {
  none: 'animationNone', fadeIn: 'animationFadeIn', fadeOut: 'animationFadeOut', slideFromTop: 'animationSlideFromTop', slideFromBottom: 'animationSlideFromBottom', slideFromLeft: 'animationSlideFromLeft', slideFromRight: 'animationSlideFromRight', scaleIn: 'animationScaleIn', scaleOut: 'animationScaleOut',
}

const update = (phase: 'enterAnim' | 'exitAnim' | 'focusAnim', patch: Partial<UiAnimationConfig>) => {
  const animation = props.node[phase]
  designer.setNodeAnimation(props.node.id, phase, { ...animation, ...patch })
}
</script>

<template>
  <section class="animations-panel">
    <div v-for="phase in phases()" :key="phase" class="animation-card">
      <div class="animation-title">{{ phaseLabel(phase) }}</div>
      <label class="animation-row">
        <span>{{ t('animationType') }}</span>
        <el-select :model-value="props.node[phase].type" size="small" @update:model-value="update(phase, { type: $event })">
          <el-option v-for="type in types" :key="type" :label="t(typeLabels[type])" :value="type" />
        </el-select>
      </label>
      <template v-if="props.node[phase].type !== 'none'">
        <label class="animation-row">
          <span>{{ t('animationDuration') }}</span>
          <el-input-number :model-value="props.node[phase].duration" :min="0" size="small" controls-position="right" @update:model-value="update(phase, { duration: $event ?? 0 })" />
        </label>
        <label class="animation-row">
          <span>{{ t('animationEasing') }}</span>
          <el-select :model-value="props.node[phase].easing" size="small" @update:model-value="update(phase, { easing: $event })">
            <el-option v-for="easing in easings" :key="easing" :label="easing" :value="easing" />
          </el-select>
        </label>
      </template>
    </div>
  </section>
</template>

<style scoped>
.animations-panel { display: flex; flex-direction: column; gap: 9px; min-height: 0; overflow: auto; }
.animation-title { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }
.animation-card { display: flex; flex-direction: column; gap: 7px; padding: 8px; border: 1px solid var(--app-border); border-radius: 5px; }
.animation-title { font-size: 10px; }
.animation-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 7px; color: var(--app-ink-soft); font-size: 11px; }
.animation-row :deep(.el-select), .animation-row :deep(.el-input-number) { width: 100%; }
</style>
