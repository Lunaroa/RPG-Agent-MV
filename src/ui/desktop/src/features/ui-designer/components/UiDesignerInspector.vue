<script setup lang="ts">
import { computed, isRef, ref, watch, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiNode, UiResourceEntry, UiRuntimeDiagnostic, UiValidationIssue } from '@contract/ui-designer'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import UiPropertyField from './UiPropertyField.vue'
import UiDesignerConditions from './UiDesignerConditions.vue'
import UiDesignerEvents from './UiDesignerEvents.vue'
import UiDesignerAnimations from './UiDesignerAnimations.vue'
import UiPaddingEditor from './UiPaddingEditor.vue'
import UiButtonStatesEditor from './UiButtonStatesEditor.vue'
import UiFrameListEditor from './UiFrameListEditor.vue'
import UiDesignerResourcePicker from './UiDesignerResourcePicker.vue'

interface FieldDescriptor {
  key: string
  kind: 'number' | 'text' | 'boolean' | 'color' | 'enum' | 'resource'
  help?: string
  multiline?: boolean
  resourceCategory?: 'image' | 'audio' | 'video' | 'font'
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
  step?: number
}

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const activeSection = defineModel<'properties' | 'events' | 'condition' | 'animation'>('activeSection', { default: 'properties' })
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const selectedNode = computed<UiNode | undefined>(() => unwrap(designer.selectedNode))
const selectedActionPolicy = computed(() => selectedNode.value ? designer.getNodeActionPolicy(selectedNode.value.id) : undefined)
const currentDocument = computed(() => unwrap(designer.document))
const validationReport = computed(() => unwrap(designer.validation))
const nodeValidationErrors = computed(() => selectedNode.value ? validationReport.value.errors.filter((issue) => issue.nodeId === selectedNode.value!.id || (issue.path ?? '').includes(selectedNode.value!.id)) : [])
const runtimeDiagnostics = computed<UiRuntimeDiagnostic[]>(() => unwrap(designer.previewDiagnostics))
const selectedRuntimeDiagnostics = computed(() => {
  const node = selectedNode.value
  if (!node) return []
  return runtimeDiagnostics.value.filter((diagnostic) => (!diagnostic.scene || diagnostic.scene === currentDocument.value.meta.sceneName) && (diagnostic.node === node.id || diagnostic.node === node.name))
})
const nodeNameDraft = ref('')
watch(selectedNode, (node) => { nodeNameDraft.value = node?.name ?? '' }, { immediate: true })
const resourcePickerVisible = ref(false)
const resourcePickerCategory = ref<UiResourceEntry['category']>('image')
const resourcePickerCurrentPath = ref('')
let resolveResourcePicker: ((path: string | null) => void) | undefined
const openResourcePicker = (category: FieldDescriptor['resourceCategory'] = 'image', currentPath = '') => new Promise<string | null>((resolve) => {
  resolveResourcePicker?.(null)
  resolveResourcePicker = resolve
  resourcePickerCategory.value = category ?? 'image'
  resourcePickerCurrentPath.value = currentPath
  resourcePickerVisible.value = true
})
const selectResource = (path: string) => {
  const resolve = resolveResourcePicker
  resolveResourcePicker = undefined
  resourcePickerVisible.value = false
  resolve?.(path)
}
const closeResourcePicker = (visible: boolean) => {
  resourcePickerVisible.value = visible
  if (!visible) {
    const resolve = resolveResourcePicker
    resolveResourcePicker = undefined
    resolve?.(null)
  }
}

const labels: Record<string, UiDesignerMessageKey> = {
  x: 'x' as UiDesignerMessageKey, y: 'y' as UiDesignerMessageKey, width: 'width', height: 'height', scaleX: 'scaleX', scaleY: 'scaleY', rotate: 'rotate', opacity: 'opacity', visible: 'visible', anchorX: 'anchorX', anchorY: 'anchorY', zIndex: 'zIndex',
  content: 'content', path: 'path', backgroundPath: 'backgroundPath', fontSize: 'fontSize', textColor: 'textColor', backgroundColor: 'backgroundColor', fillColor: 'fillColor', currentValue: 'currentValue', maxValue: 'maxValue', imagePath: 'imagePath', velocityRandomX: 'velocityRandomX', velocityRandomY: 'velocityRandomY', rotationSpeed: 'rotationSpeed', lifetimeRandom: 'lifetimeRandom', startScale: 'startScale', endScale: 'endScale', startOpacity: 'startOpacity', endOpacity: 'endOpacity',
  fontFile: 'fontFile', fontWeight: 'fontWeight', italic: 'italic', letterSpacing: 'letterSpacing', strokeColor: 'strokeColor', strokeWidth: 'strokeWidth', shadowColor: 'shadowColor', shadowOffsetX: 'shadowOffsetX', shadowOffsetY: 'shadowOffsetY', shadowBlur: 'shadowBlur', align: 'align', verticalAlign: 'verticalAlign', wrapWidth: 'wrapWidth', richText: 'richText', fillMode: 'fillMode', repeatMode: 'repeatMode', blendMode: 'blendMode', backgroundFillMode: 'backgroundFillMode', backgroundRepeatMode: 'backgroundRepeatMode', clip: 'clip', scrollX: 'scrollX', scrollY: 'scrollY', borderTop: 'borderTop', borderRight: 'borderRight', borderBottom: 'borderBottom', borderLeft: 'borderLeft', showGuides: 'showGuides', defaultFrameDuration: 'defaultFrameDuration', loop: 'loop', speed: 'speed', initialFrame: 'initialFrame', fillDirection: 'fillDirection', animateValue: 'animateValue', clickThrough: 'clickThrough', autoplay: 'autoplay', muted: 'muted', playbackRate: 'playbackRate', posterPath: 'posterPath', maxParticles: 'maxParticles', emissionInterval: 'emissionInterval', emissionArea: 'emissionArea', shape: 'shape', velocityX: 'velocityX', velocityY: 'velocityY', gravityX: 'gravityX', gravityY: 'gravityY', lifetime: 'lifetime', startColor: 'startColor', endColor: 'endColor', trackImage: 'trackImage', fillImage: 'fillImage', trackColor: 'trackColor', borderColor: 'borderColor', borderWidth: 'borderWidth', borderRadius: 'borderRadius', pressedScale: 'pressedScale', hoverTint: 'hoverTint', disabledCondition: 'disabledCondition', focusColor: 'focusColor', focusWidth: 'focusWidth', hoverSe: 'hoverSe', clickSe: 'clickSe', tint: 'tint',
}

const labelFor = (key: string) => labels[key] ? t(labels[key]) : key
const performanceLabel = (rating: 'smooth' | 'moderate' | 'mayStutter') => t(rating === 'smooth' ? 'performanceSmooth' : rating === 'moderate' ? 'performanceModerate' : 'performanceMayStutter')
const performanceSuggestionLabel = (suggestion: string) => suggestion.startsWith('Consider merging') ? t('performanceSuggestionNodeCount') : suggestion.startsWith('Multiple particle') ? t('performanceSuggestionParticles') : suggestion.startsWith('Code-mode') ? t('performanceSuggestionCode') : suggestion.startsWith('onUpdate') ? t('performanceSuggestionUpdate') : t('operationError')
const validationLabels: Partial<Record<UiValidationIssue['code'], UiDesignerMessageKey>> = { 'invalid-value': 'invalidValue', 'invalid-code': 'invalidCode', 'invalid-reference': 'invalidReference', 'missing-resource': 'missingResource', 'invalid-document-shape': 'validationIssue', 'scene-name-empty': 'invalidValue', 'scene-name-invalid': 'invalidValue' }
const validationIssueLabel = (issue: UiValidationIssue) => t(validationLabels[issue.code] ?? 'validationIssue')
const issuesForField = (field: FieldDescriptor): UiValidationIssue[] => selectedNode.value ? nodeValidationErrors.value.filter((issue) => issue.path?.endsWith(`.${field.key}`) || issue.path?.endsWith(field.key)) : []
const baseFields: FieldDescriptor[] = [
  { key: 'x', kind: 'number' }, { key: 'y', kind: 'number' }, { key: 'width', kind: 'number', min: 0 }, { key: 'height', kind: 'number', min: 0 },
  { key: 'scaleX', kind: 'number', min: 0.1, max: 5, step: 0.05 }, { key: 'scaleY', kind: 'number', min: 0.1, max: 5, step: 0.05 }, { key: 'rotate', kind: 'number', min: -180, max: 180 }, { key: 'opacity', kind: 'number', min: 0, max: 255 }, { key: 'visible', kind: 'boolean' }, { key: 'anchorX', kind: 'number', min: 0, max: 1, step: 0.05 }, { key: 'anchorY', kind: 'number', min: 0, max: 1, step: 0.05 }, { key: 'zIndex', kind: 'number' },
]

const enumLabels: Record<string, UiDesignerMessageKey> = {
  none: 'optionNone', stretch: 'optionStretch', cover: 'optionCover', contain: 'optionContain', tile: 'optionTile', horizontal: 'optionHorizontal', vertical: 'optionVertical', both: 'optionBoth', normal: 'optionNormal', add: 'optionAdd', multiply: 'optionMultiply', screen: 'optionScreen', overlay: 'optionOverlay', bold: 'optionBold', light: 'optionLight', left: 'optionLeft', center: 'optionCenter', right: 'optionRight', top: 'optionTop', middle: 'optionMiddle', bottom: 'optionBottom', point: 'optionPoint', rectangle: 'optionRectangle', circle: 'optionCircle', square: 'optionSquare', star: 'optionStar', leftToRight: 'optionLeftToRight', rightToLeft: 'optionRightToLeft', bottomToTop: 'optionBottomToTop', topToBottom: 'optionTopToBottom',
}
const enumOptions = (values: string[]): Array<{ label: string; value: string }> => values.map((value) => ({ label: enumLabels[value] ? t(enumLabels[value]) : value, value }))
const commonText: FieldDescriptor[] = [
  { key: 'content', kind: 'text', multiline: true }, { key: 'wrapWidth', kind: 'number', min: 0 }, { key: 'richText', kind: 'boolean' }, { key: 'fontFile', kind: 'resource', resourceCategory: 'font' }, { key: 'fontSize', kind: 'number', min: 1 }, { key: 'fontWeight', kind: 'enum', options: enumOptions(['normal', 'bold', 'light']) }, { key: 'italic', kind: 'boolean' }, { key: 'letterSpacing', kind: 'number' }, { key: 'textColor', kind: 'color' }, { key: 'strokeColor', kind: 'color' }, { key: 'strokeWidth', kind: 'number', min: 0 }, { key: 'shadowColor', kind: 'color' }, { key: 'shadowOffsetX', kind: 'number' }, { key: 'shadowOffsetY', kind: 'number' }, { key: 'shadowBlur', kind: 'number', min: 0 }, { key: 'align', kind: 'enum', options: enumOptions(['left', 'center', 'right']) }, { key: 'verticalAlign', kind: 'enum', options: enumOptions(['top', 'middle', 'bottom']) }, { key: 'backgroundColor', kind: 'color' },
]
const fields = computed<FieldDescriptor[]>(() => {
  const node = selectedNode.value
  if (!node) return []
  const special: Record<UiNode['type'], FieldDescriptor[]> = {
    container: [{ key: 'backgroundPath', kind: 'resource', resourceCategory: 'image' }, { key: 'backgroundFillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }, { key: 'backgroundRepeatMode', kind: 'enum', options: enumOptions(['none', 'horizontal', 'vertical', 'both']) }, { key: 'clip', kind: 'boolean' }],
    sprite: [{ key: 'path', kind: 'resource', resourceCategory: 'image' }, { key: 'fillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }, { key: 'repeatMode', kind: 'enum', options: enumOptions(['none', 'horizontal', 'vertical', 'both']) }, { key: 'tint', kind: 'color' }, { key: 'blendMode', kind: 'enum', options: enumOptions(['normal', 'add', 'multiply', 'screen', 'overlay']) }, { key: 'scrollX', kind: 'number' }, { key: 'scrollY', kind: 'number' }],
    nineSlice: [{ key: 'path', kind: 'resource', resourceCategory: 'image' }, { key: 'borderTop', kind: 'number', min: 0 }, { key: 'borderRight', kind: 'number', min: 0 }, { key: 'borderBottom', kind: 'number', min: 0 }, { key: 'borderLeft', kind: 'number', min: 0 }, { key: 'showGuides', kind: 'boolean' }],
    frameAnimation: [{ key: 'defaultFrameDuration', kind: 'number', min: 0 }, { key: 'loop', kind: 'boolean' }, { key: 'speed', kind: 'number', min: 0.1 }, { key: 'initialFrame', kind: 'number', min: 0 }, { key: 'fillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }],
    button: [...commonText.map((field) => field.key === 'content' ? { ...field, multiline: false } : field), { key: 'borderColor', kind: 'color' }, { key: 'borderWidth', kind: 'number', min: 0 }, { key: 'borderRadius', kind: 'number', min: 0 }, { key: 'hoverTint', kind: 'color' }, { key: 'pressedScale', kind: 'number', min: 0 }, { key: 'disabledCondition', kind: 'text' }, { key: 'focusColor', kind: 'color' }, { key: 'focusWidth', kind: 'number', min: 0 }, { key: 'hoverSe', kind: 'resource', resourceCategory: 'audio' }, { key: 'clickSe', kind: 'resource', resourceCategory: 'audio' }],
    text: commonText,
    progressBar: [{ key: 'trackImage', kind: 'resource' }, { key: 'trackColor', kind: 'color' }, { key: 'trackRadius', kind: 'number', min: 0 }, { key: 'fillImage', kind: 'resource' }, { key: 'fillColor', kind: 'color' }, { key: 'fillRadius', kind: 'number', min: 0 }, { key: 'fillDirection', kind: 'enum', options: enumOptions(['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom']) }, { key: 'currentValue', kind: 'number', min: 0 }, { key: 'maxValue', kind: 'number', min: 1 }, { key: 'animateValue', kind: 'boolean' }],
    overlay: [{ key: 'fillColor', kind: 'color' }, { key: 'clickThrough', kind: 'boolean' }],
    video: [{ key: 'path', kind: 'resource', resourceCategory: 'video' }, { key: 'autoplay', kind: 'boolean' }, { key: 'loop', kind: 'boolean' }, { key: 'muted', kind: 'boolean' }, { key: 'playbackRate', kind: 'number', min: 0.1 }, { key: 'posterPath', kind: 'resource', resourceCategory: 'image' }],
    particle: [{ key: 'maxParticles', kind: 'number', min: 1, max: 500, step: 1 }, { key: 'emissionInterval', kind: 'number', min: 0, step: 1 }, { key: 'emissionArea', kind: 'enum', options: enumOptions(['point', 'rectangle', 'circle']) }, { key: 'imagePath', kind: 'resource', resourceCategory: 'image' }, { key: 'shape', kind: 'enum', options: enumOptions(['circle', 'square', 'star']) }, { key: 'velocityX', kind: 'number', step: 0.1 }, { key: 'velocityY', kind: 'number', step: 0.1 }, { key: 'velocityRandomX', kind: 'number', min: 0, step: 0.1 }, { key: 'velocityRandomY', kind: 'number', min: 0, step: 0.1 }, { key: 'gravityX', kind: 'number', step: 0.1 }, { key: 'gravityY', kind: 'number', step: 0.1 }, { key: 'rotationSpeed', kind: 'number', step: 0.1 }, { key: 'lifetime', kind: 'number', min: 0, step: 1 }, { key: 'lifetimeRandom', kind: 'number', min: 0, step: 1 }, { key: 'startScale', kind: 'number', min: 0, step: 0.05 }, { key: 'endScale', kind: 'number', min: 0, step: 0.05 }, { key: 'startOpacity', kind: 'number', min: 0, max: 255, step: 1 }, { key: 'endOpacity', kind: 'number', min: 0, max: 255, step: 1 }, { key: 'startColor', kind: 'color' }, { key: 'endColor', kind: 'color' }, { key: 'blendMode', kind: 'enum', options: enumOptions(['normal', 'add', 'screen']) }, { key: 'glow', kind: 'number', min: 0, step: 0.1 }],
  }
  const known = new Set([...baseFields, ...special[node.type]].map((field) => field.key))
  const inferred = Object.entries(node.props as unknown as Record<string, unknown>).filter(([key, value]) => !known.has(key) && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')).map(([key, value]): FieldDescriptor => ({ key, kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : key.toLowerCase().includes('color') ? 'color' : 'text' }))
  return [...baseFields, ...special[node.type], ...inferred].map((field) => ({ ...field, help: field.help ?? t('propertyHelpGeneric') }))
})

const propValue = (key: string): unknown => selectedNode.value ? (selectedNode.value.props as unknown as Record<string, unknown>)[key] : undefined
const propMode = (key: string) => selectedNode.value?.propModes[key] ?? 'value'
const propCode = (key: string) => selectedNode.value?.propCodes[key] ?? ''

const updateProperty = (key: string, value: unknown) => { if (selectedNode.value) designer.updateNodeProperty(selectedNode.value.id, key, value) }
const updateMode = (key: string, mode: 'value' | 'code') => { if (selectedNode.value) designer.setPropertyMode(selectedNode.value.id, key, mode) }
const updateCode = (key: string, code: string, sceneId?: string, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.setPropertyCode(targetId, key, code, sceneId)
}
const commitNodeName = () => { if (selectedNode.value) designer.renameNode(selectedNode.value.id, nodeNameDraft.value) }
const loadFrameFolder = () => designer.adapters.resource.selectFrameFolder?.() ?? Promise.resolve(null)
</script>

<template>
  <aside class="inspector-panel">
    <div class="inspector-head">
      <div>
        <span class="inspector-title">{{ t('inspector') }}</span>
        <span v-if="selectedNode" class="inspector-node">{{ selectedNode.name }}</span>
      </div>
      <el-button v-if="selectedNode" size="small" text :disabled="!selectedActionPolicy?.allowed.duplicate" @click="designer.duplicateSelected()">{{ t('duplicateNode') }}</el-button>
    </div>
    <div v-if="selectedNode" class="inspector-tabs">
      <el-button size="small" text :class="{ active: activeSection === 'properties' }" @click="activeSection = 'properties'">{{ t('value') }}</el-button>
      <el-button size="small" text :class="{ active: activeSection === 'events' }" @click="activeSection = 'events'">{{ t('events') }}</el-button>
      <el-button size="small" text :class="{ active: activeSection === 'condition' }" @click="activeSection = 'condition'">{{ t('condition') }}</el-button>
      <el-button size="small" text :class="{ active: activeSection === 'animation' }" @click="activeSection = 'animation'">{{ t('enterAnimation') }}</el-button>
    </div>
    <el-alert v-if="nodeValidationErrors.length" class="inspector-validation" type="error" :closable="false" :title="`${nodeValidationErrors.length} ${t('validationErrors')}`"><ul><li v-for="issue in nodeValidationErrors" :key="`${issue.path}:${issue.message}`"><span>{{ validationIssueLabel(issue) }}<template v-if="issue.path"> · {{ issue.path }}</template></span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details></li></ul></el-alert>
    <el-alert v-if="selectedRuntimeDiagnostics.length" class="inspector-validation" type="warning" :closable="false" :title="`${t('runtimeDiagnostics')} · ${selectedRuntimeDiagnostics.length}`"><ul><li v-for="diagnostic in selectedRuntimeDiagnostics" :key="`${diagnostic.sessionId}:${diagnostic.code}:${diagnostic.message}`"><span>{{ t('runtimeDiagnostic') }}<template v-if="diagnostic.count > 1"> ×{{ diagnostic.count }}</template></span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ diagnostic.label }}: {{ diagnostic.message }}</span></details></li></ul></el-alert>
    <div v-if="!selectedNode" class="inspector-empty">{{ t('noSelection') }}</div>
    <div v-else-if="activeSection === 'properties'" class="properties-scroll">
      <el-input v-model="nodeNameDraft" size="small" :placeholder="t('nodeNamePlaceholder')" @blur="commitNodeName" @keydown.enter.prevent="commitNodeName" />
      <div class="property-grid">
        <UiPropertyField
          v-for="field in fields"
          :key="field.key"
          :label="labelFor(field.key)"
          :help="field.help"
          :multiline="field.multiline"
          :value="propValue(field.key)"
          :mode="propMode(field.key)"
          :code="propCode(field.key)"
          :kind="field.kind"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :options="field.options"
          :resource-category="field.resourceCategory"
          :resource-picker="field.kind === 'resource' ? () => openResourcePicker(field.resourceCategory, String(propValue(field.key) ?? '')) : undefined"
          :resource-picker-disabled="field.kind === 'resource' && !designer.hasProject"
          :issues="issuesForField(field)"
          :code-adapter="designer.adapters.code"
          :draft-coordinator="designer.draftCoordinator"
          :scene-id="designer.activeSceneId"
          :node-id="selectedNode.id"
          :completion-items="designer.document.nodes.flatMap((node) => [node.id, node.name])"
          @value="updateProperty(field.key, $event)"
          @mode="updateMode(field.key, $event)"
          @code="(code, sceneId, nodeId) => updateCode(field.key, code, sceneId, nodeId)"
        />
      </div>
      <UiPaddingEditor
        v-if="selectedNode.type === 'text' || selectedNode.type === 'button'"
        :value="selectedNode.props.padding"
        @update="updateProperty('padding', $event)"
      />
      <UiButtonStatesEditor
        v-if="selectedNode.type === 'button'"
        :value="selectedNode.props.imageStates"
        @update="updateProperty('imageStates', $event)"
      />
      <UiFrameListEditor
        v-if="selectedNode.type === 'frameAnimation'"
        :value="selectedNode.props.frames"
        :resources="designer.resourceCatalog?.resources ?? []"
        :load-folder="loadFrameFolder"
        :pick-resource="designer.hasProject ? (currentPath) => openResourcePicker('image', currentPath) : undefined"
        :resource-picker-disabled="!designer.hasProject"
        @update="updateProperty('frames', $event)"
      />
      <el-divider />
      <div class="inspector-section-title">{{ t('performance') }}</div>
      <el-popover placement="top" width="320" trigger="click">
        <template #reference><button type="button" class="performance-line"><span>{{ performanceLabel(designer.performance.rating) }}</span><span>{{ designer.performance.nodeCount }} {{ t('nodes') }}</span></button></template>
        <div class="performance-details">
          <div>{{ designer.performance.particleSystems }} · {{ designer.performance.maxParticleTotal }} {{ t('particles') }}</div>
          <div>{{ designer.performance.frameCount }} {{ t('frames') }} · {{ designer.performance.codeModeProperties }} {{ t('codeProperties') }}</div>
          <ul v-if="designer.performance.suggestions.length"><li v-for="suggestion in designer.performance.suggestions" :key="suggestion"><span>{{ performanceSuggestionLabel(suggestion) }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ suggestion }}</span></details></li></ul>
          <span v-else>{{ t('valid') }}</span>
        </div>
      </el-popover>
    </div>
    <UiDesignerEvents v-else-if="activeSection === 'events'" :designer="designer" :node="selectedNode" />
    <UiDesignerConditions v-else-if="activeSection === 'condition'" :designer="designer" :node="selectedNode" />
    <UiDesignerAnimations v-else :designer="designer" :node="selectedNode" />
    <UiDesignerResourcePicker
      :model-value="resourcePickerVisible"
      :designer="designer"
      :category="resourcePickerCategory"
      :current-path="resourcePickerCurrentPath"
      @update:model-value="closeResourcePicker"
      @select="selectResource"
    />
  </aside>
</template>

<style scoped>
.inspector-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 9px; padding: 10px; background: var(--app-bg); }
.inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.inspector-title { display: block; font-size: 13px; font-weight: 650; }
.inspector-node { display: block; max-width: 210px; overflow: hidden; text-overflow: ellipsis; color: var(--app-ink-soft); font-size: 11px; }
.inspector-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--app-border); }
.inspector-tabs .el-button { margin: 0; padding: 5px 7px; border-radius: 0; color: var(--app-ink-soft); font-size: 11px; }
.inspector-tabs .el-button.active { border-bottom: 2px solid var(--app-accent); color: var(--app-accent); }
.inspector-validation { margin-bottom: 2px; }.inspector-validation ul { margin: 4px 0 0; padding-left: 16px; }
.properties-scroll { min-height: 0; overflow: auto; padding-right: 3px; }
.property-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 8px; margin-top: 10px; }
.property-grid :deep(.property-field:first-child), .property-grid :deep(.property-field:nth-child(2)) { grid-column: span 1; }
.inspector-empty { display: grid; place-items: center; flex: 1; min-height: 180px; color: var(--app-ink-soft); font-size: 12px; text-align: center; }
.inspector-section-title { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.performance-line { display: flex; justify-content: space-between; width: 100%; padding: 0; border: 0; background: transparent; color: var(--app-ink-soft); cursor: pointer; font-size: 11px; text-align: left; }.performance-details { color: var(--app-ink); font-size: 11px; line-height: 1.5; }.performance-details ul { margin: 6px 0 0; padding-left: 16px; }.performance-details li { margin-bottom: 4px; }.performance-details .status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
