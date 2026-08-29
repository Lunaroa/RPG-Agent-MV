<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiNode, UiRuntimeDiagnostic, UiValidationIssue } from '@contract/ui-designer'
import type { UiDesignerManagedAssetKind } from '@contract/ui-designer-resources'
import { UI_DESIGNER_NODE_SCRIPT_COMPLETIONS } from '@contract/ui-designer-script'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import UiPropertyField from './UiPropertyField.vue'
import UiDesignerConditions from './UiDesignerConditions.vue'
import UiDesignerEvents from './UiDesignerEvents.vue'
import UiDesignerAnimations from './UiDesignerAnimations.vue'
import UiPaddingEditor from './UiPaddingEditor.vue'
import { normalizeUiSingleLineText } from '../fabric/uiSingleLineText'
import UiButtonStatesEditor from './UiButtonStatesEditor.vue'
import UiFrameListEditor from './UiFrameListEditor.vue'
import ProjectAssetsWorkspace from '../../../components/ProjectAssetsWorkspace.vue'
import { resizeDialogFromEdge, type UiDialogRect, type UiDialogResizeEdge } from '../models/dialog-edge-resize'

type InspectorPurpose = 'identity' | 'geometry' | 'contentResources' | 'appearance' | 'behavior' | 'advanced'

interface FieldDescriptor {
  key: string
  kind: 'number' | 'text' | 'boolean' | 'color' | 'enum' | 'resource' | 'numberList'
  help?: string
  unit?: string
  multiline?: boolean
  resourceCategory?: UiDesignerManagedAssetKind
  purpose?: InspectorPurpose
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
  step?: number
}

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const activeSection = defineModel<'properties' | 'events' | 'condition' | 'animation'>('activeSection', { default: 'properties' })
const inspectorElement = ref<HTMLElement>()
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
let nodeNamePending = false
const previewNodeName = (value: string) => {
  nodeNameDraft.value = value
  nodeNamePending = value !== (selectedNode.value?.name ?? '')
}
const commitNodeName = () => {
  const node = selectedNode.value
  if (!nodeNamePending || !node) return
  const value = nodeNameDraft.value
  nodeNamePending = false
  if (value !== node.name) designer.renameNode(node.id, value)
}
const cancelNodeName = () => {
  nodeNamePending = false
  nodeNameDraft.value = selectedNode.value?.name ?? ''
}
const unregisterNodeNameDraft = designer.draftCoordinator.register(commitNodeName, {
  cancel: cancelNodeName,
  sceneId: () => designer.activeSceneId,
  pending: () => nodeNamePending,
})
watch(selectedNode, (node) => {
  nodeNamePending = false
  nodeNameDraft.value = node?.name ?? ''
}, { immediate: true })
const resourceWorkspaceVisible = ref(false)
const resourceWorkspaceCategory = ref<UiDesignerManagedAssetKind>('image')
const resourceWorkspaceCurrentPath = ref('')
const resourceWorkspaceMultiple = ref(false)
const resourceWorkspaceRequest = ref(0)
const resourceWorkspaceSize = ref({ width: 1180, height: 760 })
const resourceWorkspacePosition = ref<{ left: number; top: number }>()
const resourceWorkspaceDialogElement = ref<HTMLElement>()
const resourceWorkspaceChromeHeight = ref(0)
const resourceWorkspaceResizeEdges: UiDialogResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const resourceWorkspaceDialogStyle = computed(() => resourceWorkspacePosition.value
  ? { position: 'fixed', margin: '0', left: `${resourceWorkspacePosition.value.left}px`, top: `${resourceWorkspacePosition.value.top}px` }
  : undefined)
const resourceWorkspaceResizeFrameStyle = computed(() => resourceWorkspacePosition.value
  ? {
      left: `${resourceWorkspacePosition.value.left}px`,
      top: `${resourceWorkspacePosition.value.top}px`,
      width: `${resourceWorkspaceSize.value.width}px`,
      height: `${resourceWorkspaceSize.value.height + resourceWorkspaceChromeHeight.value}px`,
    }
  : undefined)
let resourceWorkspaceResize: {
  edge: UiDialogResizeEdge
  startX: number
  startY: number
  rect: UiDialogRect
  chromeHeight: number
} | undefined
const clampResourceWorkspaceSize = (width: number, height: number) => {
  const maxWidth = Math.max(1, Math.floor(window.innerWidth * 0.94))
  const maxHeight = Math.max(1, Math.floor(window.innerHeight * 0.82))
  return {
    width: Math.min(maxWidth, Math.max(Math.min(720, maxWidth), Math.round(width))),
    height: Math.min(maxHeight, Math.max(Math.min(520, maxHeight), Math.round(height))),
  }
}
const moveResourceWorkspaceResize = (event: PointerEvent) => {
  if (!resourceWorkspaceResize) return
  const { edge, startX, startY, rect, chromeHeight } = resourceWorkspaceResize
  const next = resizeDialogFromEdge(rect, edge, event.clientX - startX, event.clientY - startY, {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    minWidth: Math.min(720, Math.max(1, window.innerWidth - 16)),
    minHeight: Math.min(chromeHeight + 520, Math.max(1, window.innerHeight - 16)),
    margin: 8,
  })
  resourceWorkspacePosition.value = { left: next.left, top: next.top }
  resourceWorkspaceSize.value = { width: next.width, height: Math.max(1, next.height - chromeHeight) }
}
const endResourceWorkspaceResize = () => {
  resourceWorkspaceResize = undefined
  window.removeEventListener('pointermove', moveResourceWorkspaceResize)
  window.removeEventListener('pointerup', endResourceWorkspaceResize)
  window.removeEventListener('pointercancel', endResourceWorkspaceResize)
}
const beginResourceWorkspaceResize = (event: PointerEvent, edge: UiDialogResizeEdge) => {
  event.preventDefault()
  event.stopPropagation()
  const dialog = resourceWorkspaceDialogElement.value
  if (!dialog) return
  endResourceWorkspaceResize()
  const bounds = dialog.getBoundingClientRect()
  resourceWorkspaceResize = {
    edge,
    startX: event.clientX,
    startY: event.clientY,
    rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
    chromeHeight: Math.max(0, bounds.height - resourceWorkspaceSize.value.height),
  }
  window.addEventListener('pointermove', moveResourceWorkspaceResize)
  window.addEventListener('pointerup', endResourceWorkspaceResize)
  window.addEventListener('pointercancel', endResourceWorkspaceResize)
}
const handleResourceWorkspaceOpened = async () => {
  await nextTick()
  const dialog = document.querySelector<HTMLElement>('.el-dialog[data-ui-id="ui-designer-resource-workspace-dialog"]')
  if (!dialog) return
  const bounds = dialog.getBoundingClientRect()
  resourceWorkspaceDialogElement.value = dialog
  resourceWorkspaceChromeHeight.value = Math.max(0, bounds.height - resourceWorkspaceSize.value.height)
  resourceWorkspacePosition.value = { left: Math.round(bounds.left), top: Math.round(bounds.top) }
}
const handleResourceWorkspaceClosed = () => {
  endResourceWorkspaceResize()
  resourceWorkspaceDialogElement.value = undefined
  resourceWorkspacePosition.value = undefined
}
watch(resourceWorkspaceVisible, (visible) => {
  if (visible) void handleResourceWorkspaceOpened()
})
interface ResourceWorkspaceSelection {
  path: string
  width?: number
  height?: number
}
let resolveResourceWorkspace: ((value: ResourceWorkspaceSelection | string[] | null) => void) | undefined
const openResourceWorkspace = (category: UiDesignerManagedAssetKind = 'image', currentPath = '') => new Promise<ResourceWorkspaceSelection | null>((resolve) => {
  resolveResourceWorkspace?.(null)
  resolveResourceWorkspace = (value) => resolve(value && !Array.isArray(value) ? value : null)
  resourceWorkspaceRequest.value += 1
  resourceWorkspaceCategory.value = category
  resourceWorkspaceCurrentPath.value = currentPath
  resourceWorkspaceMultiple.value = false
  resourceWorkspaceSize.value = clampResourceWorkspaceSize(resourceWorkspaceSize.value.width, resourceWorkspaceSize.value.height)
  resourceWorkspacePosition.value = undefined
  resourceWorkspaceDialogElement.value = undefined
  resourceWorkspaceVisible.value = true
})
const openMultiResourceWorkspace = (category: UiDesignerManagedAssetKind = 'image') => new Promise<string[] | null>((resolve) => {
  resolveResourceWorkspace?.(null)
  resolveResourceWorkspace = (value) => resolve(Array.isArray(value) ? value : null)
  resourceWorkspaceRequest.value += 1
  resourceWorkspaceCategory.value = category
  resourceWorkspaceCurrentPath.value = ''
  resourceWorkspaceMultiple.value = true
  resourceWorkspaceSize.value = clampResourceWorkspaceSize(resourceWorkspaceSize.value.width, resourceWorkspaceSize.value.height)
  resourceWorkspacePosition.value = undefined
  resourceWorkspaceDialogElement.value = undefined
  resourceWorkspaceVisible.value = true
})
const pickResourcePath = async (category: UiDesignerManagedAssetKind = 'image', currentPath = '') => (await openResourceWorkspace(category, currentPath))?.path ?? null
const settleResourceWorkspace = (value: string | string[] | null, details?: { width: number; height: number }) => {
  const resolve = resolveResourceWorkspace
  resolveResourceWorkspace = undefined
  resourceWorkspaceVisible.value = false
  resolve?.(typeof value === 'string' ? { path: value, ...details } : value)
}
const closeResourceWorkspace = (visible: boolean) => {
  resourceWorkspaceVisible.value = visible
  if (!visible && resolveResourceWorkspace) settleResourceWorkspace(null)
}
onBeforeUnmount(() => {
  endResourceWorkspaceResize()
  commitNodeName()
  unregisterNodeNameDraft()
  settleResourceWorkspace(null)
})

const labels: Record<string, UiDesignerMessageKey> = {
  x: 'x' as UiDesignerMessageKey, y: 'y' as UiDesignerMessageKey, width: 'width', height: 'height', scaleX: 'scaleX', scaleY: 'scaleY', rotate: 'rotate', opacity: 'opacity', visible: 'visible', anchorX: 'anchorX', anchorY: 'anchorY', zIndex: 'zIndex',
  content: 'content', path: 'path', backgroundPath: 'backgroundPath', fontSize: 'fontSize', textColor: 'textColor', backgroundColor: 'backgroundColor', fillColor: 'fillColor', currentValue: 'currentValue', maxValue: 'maxValue', imagePath: 'imagePath', velocityRandomX: 'velocityRandomX', velocityRandomY: 'velocityRandomY', rotationSpeed: 'rotationSpeed', lifetimeRandom: 'lifetimeRandom', startScale: 'startScale', endScale: 'endScale', startOpacity: 'startOpacity', endOpacity: 'endOpacity', glow: 'glow',
  fontFile: 'fontFile', fontWeight: 'fontWeight', italic: 'italic', letterSpacing: 'letterSpacing', strokeColor: 'strokeColor', strokeWidth: 'strokeWidth', shadowColor: 'shadowColor', shadowOffsetX: 'shadowOffsetX', shadowOffsetY: 'shadowOffsetY', shadowBlur: 'shadowBlur', align: 'align', verticalAlign: 'verticalAlign', wrapWidth: 'wrapWidth', richText: 'richText', fillMode: 'fillMode', repeatMode: 'repeatMode', blendMode: 'blendMode', backgroundFillMode: 'backgroundFillMode', backgroundRepeatMode: 'backgroundRepeatMode', clip: 'clip', scrollX: 'scrollX', scrollY: 'scrollY', borderTop: 'borderTop', borderRight: 'borderRight', borderBottom: 'borderBottom', borderLeft: 'borderLeft', showGuides: 'showGuides', defaultFrameDuration: 'defaultFrameDuration', loop: 'loop', speed: 'speed', initialFrame: 'initialFrame', fillDirection: 'fillDirection', animateValue: 'animateValue', clickThrough: 'clickThrough', autoplay: 'autoplay', muted: 'muted', playbackRate: 'playbackRate', posterPath: 'posterPath', maxParticles: 'maxParticles', emissionInterval: 'emissionInterval', emissionArea: 'emissionArea', shape: 'shape', velocityX: 'velocityX', velocityY: 'velocityY', gravityX: 'gravityX', gravityY: 'gravityY', lifetime: 'lifetime', startColor: 'startColor', endColor: 'endColor', trackImage: 'trackImage', fillImage: 'fillImage', trackColor: 'trackColor', borderColor: 'borderColor', borderWidth: 'borderWidth', borderRadius: 'borderRadius', pressedScale: 'pressedScale', hoverTint: 'hoverTint', disabledCondition: 'disabledCondition', focusColor: 'focusColor', focusWidth: 'focusWidth', hoverSe: 'hoverSe', clickSe: 'clickSe', tint: 'tint',
  dataSource: 'dataSource', columns: 'columns', rows: 'rows', autoFlow: 'autoFlow', columnGap: 'columnGap', rowGap: 'rowGap', justifyItems: 'justifyItems', alignItems: 'alignItems', maxItems: 'maxItems', columnWidths: 'columnWidths', rowHeights: 'rowHeights', maxWidth: 'maxWidth', maxHeight: 'maxHeight',
}

const labelFor = (key: string) => labels[key] ? t(labels[key]) : key
const fieldLabel = (field: FieldDescriptor) => {
  const node = selectedNode.value
  if (node?.type === 'list' && field.key === 'width') return t('itemWidth')
  if (node?.type === 'list' && field.key === 'height') return t('itemHeight')
  if (node?.type === 'sprite' && field.key === 'path') return t('imageResource')
  if (node?.type === 'video' && field.key === 'path') return t('videoResource')
  if (node?.type === 'video' && field.key === 'posterPath') return t('videoPosterOptional')
  if (node?.type === 'particle' && field.key === 'imagePath') return t('particleImageOptional')
  if (node?.type === 'progressBar' && field.key === 'trackImage') return t('trackImageOptional')
  if (node?.type === 'progressBar' && field.key === 'fillImage') return t('fillImageOptional')
  return labelFor(field.key)
}
const validationLabels: Partial<Record<UiValidationIssue['code'], UiDesignerMessageKey>> = { 'invalid-value': 'invalidValue', 'invalid-code': 'invalidCode', 'invalid-reference': 'invalidReference', 'missing-resource': 'missingResource', 'invalid-document-shape': 'validationIssue', 'scene-name-empty': 'invalidValue', 'scene-name-invalid': 'invalidValue' }
const validationIssueLabel = (issue: UiValidationIssue) => t(validationLabels[issue.code] ?? 'validationIssue')
const issuesForField = (field: FieldDescriptor): UiValidationIssue[] => selectedNode.value ? nodeValidationErrors.value.filter((issue) => issue.path?.endsWith(`.${field.key}`) || issue.path?.endsWith(field.key)) : []
const baseFields: FieldDescriptor[] = [
  { key: 'x', kind: 'number', unit: 'px' }, { key: 'y', kind: 'number', unit: 'px' }, { key: 'width', kind: 'number', min: 0, unit: 'px' }, { key: 'height', kind: 'number', min: 0, unit: 'px' },
  { key: 'scaleX', kind: 'number', min: 0.1, max: 5, step: 0.05 }, { key: 'scaleY', kind: 'number', min: 0.1, max: 5, step: 0.05 }, { key: 'rotate', kind: 'number' }, { key: 'opacity', kind: 'number', min: 0, max: 255 }, { key: 'visible', kind: 'boolean' }, { key: 'anchorX', kind: 'number', min: 0, max: 1, step: 0.05 }, { key: 'anchorY', kind: 'number', min: 0, max: 1, step: 0.05 }, { key: 'zIndex', kind: 'number' },
]

const GEOMETRY_FIELDS = new Set(['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotate', 'anchorX', 'anchorY', 'zIndex'])
const CONTENT_RESOURCE_FIELDS = new Set(['content', 'richText', 'currentValue', 'maxValue'])
const BEHAVIOR_FIELDS = new Set(['visible', 'clip', 'scrollX', 'scrollY', 'loop', 'clickThrough', 'autoplay', 'muted', 'disabledCondition'])
const ADVANCED_FIELDS = new Set([
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'showGuides',
  'defaultFrameDuration', 'speed', 'initialFrame', 'trackRadius', 'fillRadius', 'fillDirection', 'animateValue',
  'pressedScale', 'focusWidth', 'playbackRate',
  'maxParticles', 'emissionInterval', 'emissionArea', 'shape', 'velocityX', 'velocityY', 'velocityRandomX', 'velocityRandomY',
  'gravityX', 'gravityY', 'rotationSpeed', 'lifetime', 'lifetimeRandom', 'startScale', 'endScale', 'startOpacity', 'endOpacity', 'glow',
  'columns', 'rows', 'autoFlow', 'columnGap', 'rowGap', 'justifyItems', 'alignItems', 'maxItems', 'columnWidths', 'rowHeights', 'maxWidth', 'maxHeight',
])
const FIELD_HELP_KEYS: Record<string, UiDesignerMessageKey> = {
  focusWidth: 'helpFocusWidth',
  wrapWidth: 'helpWrapWidth',
  pressedScale: 'helpPressedScale',
}
const purposeForField = (field: FieldDescriptor): InspectorPurpose => {
  if (field.purpose) return field.purpose
  if (field.kind === 'resource') return 'contentResources'
  if (GEOMETRY_FIELDS.has(field.key)) return 'geometry'
  if (CONTENT_RESOURCE_FIELDS.has(field.key)) return 'contentResources'
  if (BEHAVIOR_FIELDS.has(field.key)) return 'behavior'
  if (ADVANCED_FIELDS.has(field.key)) return 'advanced'
  return 'appearance'
}

const enumLabels: Record<string, UiDesignerMessageKey> = {
  none: 'optionNone', stretch: 'optionStretch', cover: 'optionCover', contain: 'optionContain', tile: 'optionTile', horizontal: 'optionHorizontal', vertical: 'optionVertical', both: 'optionBoth', normal: 'optionNormal', add: 'optionAdd', multiply: 'optionMultiply', screen: 'optionScreen', overlay: 'optionOverlay', bold: 'optionBold', light: 'optionLight', left: 'optionLeft', center: 'optionCenter', right: 'optionRight', top: 'optionTop', middle: 'optionMiddle', bottom: 'optionBottom', point: 'optionPoint', rectangle: 'optionRectangle', circle: 'optionCircle', square: 'optionSquare', star: 'optionStar', leftToRight: 'optionLeftToRight', rightToLeft: 'optionRightToLeft', bottomToTop: 'optionBottomToTop', topToBottom: 'optionTopToBottom', row: 'optionRow', column: 'optionColumn', start: 'optionStart', end: 'optionEnd',
}
const enumOptions = (values: string[]): Array<{ label: string; value: string }> => values.map((value) => ({ label: enumLabels[value] ? t(enumLabels[value]) : value, value }))
const commonText: FieldDescriptor[] = [
  { key: 'content', kind: 'text', multiline: true }, { key: 'richText', kind: 'boolean' }, { key: 'fontFile', kind: 'resource', resourceCategory: 'font' }, { key: 'fontSize', kind: 'number', min: 1 }, { key: 'fontWeight', kind: 'enum', options: enumOptions(['normal', 'bold', 'light']) }, { key: 'italic', kind: 'boolean' }, { key: 'letterSpacing', kind: 'number' }, { key: 'textColor', kind: 'color' }, { key: 'strokeColor', kind: 'color' }, { key: 'strokeWidth', kind: 'number', min: 0 }, { key: 'shadowColor', kind: 'color' }, { key: 'shadowOffsetX', kind: 'number' }, { key: 'shadowOffsetY', kind: 'number' }, { key: 'shadowBlur', kind: 'number', min: 0 }, { key: 'align', kind: 'enum', options: enumOptions(['left', 'center', 'right']) }, { key: 'verticalAlign', kind: 'enum', options: enumOptions(['top', 'middle', 'bottom']) }, { key: 'backgroundColor', kind: 'color' },
]
const fields = computed<FieldDescriptor[]>(() => {
  const node = selectedNode.value
  if (!node) return []
  const special: Record<UiNode['type'], FieldDescriptor[]> = {
    container: [{ key: 'backgroundPath', kind: 'resource', resourceCategory: 'image' }, { key: 'backgroundFillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }, { key: 'backgroundRepeatMode', kind: 'enum', options: enumOptions(['none', 'horizontal', 'vertical', 'both']) }, { key: 'clip', kind: 'boolean' }],
    list: [{ key: 'dataSource', kind: 'text', purpose: 'contentResources' }, { key: 'columns', kind: 'number', min: 1, max: 100, step: 1 }, { key: 'rows', kind: 'number', min: 0, max: 100, step: 1 }, { key: 'autoFlow', kind: 'enum', options: enumOptions(['row', 'column']) }, { key: 'columnGap', kind: 'number', min: 0 }, { key: 'rowGap', kind: 'number', min: 0 }, { key: 'columnWidths', kind: 'numberList' }, { key: 'rowHeights', kind: 'numberList' }, { key: 'maxWidth', kind: 'number', min: 0 }, { key: 'maxHeight', kind: 'number', min: 0 }, { key: 'justifyItems', kind: 'enum', options: enumOptions(['start', 'center', 'end', 'stretch']) }, { key: 'alignItems', kind: 'enum', options: enumOptions(['start', 'center', 'end', 'stretch']) }, { key: 'maxItems', kind: 'number', min: 0, max: 1000, step: 1 }],
    sprite: [{ key: 'path', kind: 'resource', resourceCategory: 'image' }, { key: 'fillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }, { key: 'repeatMode', kind: 'enum', options: enumOptions(['none', 'horizontal', 'vertical', 'both']) }, { key: 'tint', kind: 'color' }, { key: 'blendMode', kind: 'enum', options: enumOptions(['normal', 'add', 'multiply', 'screen', 'overlay']) }, { key: 'scrollX', kind: 'number' }, { key: 'scrollY', kind: 'number' }],
    nineSlice: [{ key: 'path', kind: 'resource', resourceCategory: 'image' }, { key: 'borderTop', kind: 'number', min: 0 }, { key: 'borderRight', kind: 'number', min: 0 }, { key: 'borderBottom', kind: 'number', min: 0 }, { key: 'borderLeft', kind: 'number', min: 0 }, { key: 'showGuides', kind: 'boolean' }],
    frameAnimation: [{ key: 'defaultFrameDuration', kind: 'number', min: 0 }, { key: 'loop', kind: 'boolean' }, { key: 'speed', kind: 'number', min: 0.1 }, { key: 'initialFrame', kind: 'number', min: 0 }, { key: 'fillMode', kind: 'enum', options: enumOptions(['stretch', 'cover', 'contain', 'tile']) }],
    button: [...commonText.map((field) => field.key === 'content' ? { ...field, multiline: false } : field), { key: 'borderColor', kind: 'color' }, { key: 'borderWidth', kind: 'number', min: 0 }, { key: 'borderRadius', kind: 'number', min: 0 }, { key: 'hoverTint', kind: 'color' }, { key: 'disabledCondition', kind: 'text' }, { key: 'focusColor', kind: 'color' }, { key: 'focusWidth', kind: 'number', min: 0 }, { key: 'hoverSe', kind: 'resource', resourceCategory: 'audio' }, { key: 'clickSe', kind: 'resource', resourceCategory: 'audio' }],
    text: commonText,
    progressBar: [{ key: 'trackImage', kind: 'resource', resourceCategory: 'image' }, { key: 'trackColor', kind: 'color' }, { key: 'trackRadius', kind: 'number', min: 0 }, { key: 'fillImage', kind: 'resource', resourceCategory: 'image' }, { key: 'fillColor', kind: 'color' }, { key: 'fillRadius', kind: 'number', min: 0 }, { key: 'fillDirection', kind: 'enum', options: enumOptions(['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom']) }, { key: 'currentValue', kind: 'number', min: 0 }, { key: 'maxValue', kind: 'number', min: 1 }, { key: 'animateValue', kind: 'boolean' }],
    overlay: [{ key: 'fillColor', kind: 'color' }, { key: 'clickThrough', kind: 'boolean' }],
    video: [{ key: 'path', kind: 'resource', resourceCategory: 'video' }, { key: 'autoplay', kind: 'boolean' }, { key: 'loop', kind: 'boolean' }, { key: 'muted', kind: 'boolean' }, { key: 'playbackRate', kind: 'number', min: 0.1 }, { key: 'posterPath', kind: 'resource', resourceCategory: 'image' }],
    particle: [{ key: 'maxParticles', kind: 'number', min: 1, max: 500, step: 1 }, { key: 'emissionInterval', kind: 'number', min: 0, step: 1 }, { key: 'emissionArea', kind: 'enum', options: enumOptions(['point', 'rectangle', 'circle']) }, { key: 'imagePath', kind: 'resource', resourceCategory: 'image' }, { key: 'shape', kind: 'enum', options: enumOptions(['circle', 'square', 'star']) }, { key: 'velocityX', kind: 'number', step: 0.1 }, { key: 'velocityY', kind: 'number', step: 0.1 }, { key: 'velocityRandomX', kind: 'number', min: 0, step: 0.1 }, { key: 'velocityRandomY', kind: 'number', min: 0, step: 0.1 }, { key: 'gravityX', kind: 'number', step: 0.1 }, { key: 'gravityY', kind: 'number', step: 0.1 }, { key: 'rotationSpeed', kind: 'number', step: 0.1 }, { key: 'lifetime', kind: 'number', min: 0, step: 1 }, { key: 'lifetimeRandom', kind: 'number', min: 0, step: 1 }, { key: 'startScale', kind: 'number', min: 0, step: 0.05 }, { key: 'endScale', kind: 'number', min: 0, step: 0.05 }, { key: 'startOpacity', kind: 'number', min: 0, max: 255, step: 1 }, { key: 'endOpacity', kind: 'number', min: 0, max: 255, step: 1 }, { key: 'startColor', kind: 'color' }, { key: 'endColor', kind: 'color' }, { key: 'blendMode', kind: 'enum', options: enumOptions(['normal', 'add', 'screen']) }, { key: 'glow', kind: 'number', min: 0, step: 0.1 }],
  }
  const known = new Set([...baseFields, ...special[node.type]].map((field) => field.key))
  const inferred = Object.entries(node.props as unknown as Record<string, unknown>).filter(([key, value]) => !known.has(key) && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')).map(([key, value]): FieldDescriptor => ({ key, kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : key.toLowerCase().includes('color') ? 'color' : 'text', purpose: 'advanced' }))
  return [...baseFields, ...special[node.type], ...inferred].map((field) => ({ ...field, purpose: purposeForField(field), help: field.help ?? (FIELD_HELP_KEYS[field.key] ? t(FIELD_HELP_KEYS[field.key]) : t('propertyHelpGeneric')) }))
})

const PURPOSE_ORDER: InspectorPurpose[] = ['advanced', 'identity', 'contentResources', 'geometry', 'appearance', 'behavior']
const expandedPurposes = ref<InspectorPurpose[]>([...PURPOSE_ORDER])
const purposeLabelKey: Record<InspectorPurpose, UiDesignerMessageKey> = {
  identity: 'inspectorGroupIdentity',
  geometry: 'inspectorGroupGeometry',
  contentResources: 'inspectorGroupContentResources',
  appearance: 'inspectorGroupAppearance',
  behavior: 'inspectorGroupBehavior',
  advanced: 'inspectorGroupAdvanced',
}
const fieldGroups = computed(() => PURPOSE_ORDER.map((purpose) => ({
  purpose,
  label: t(purposeLabelKey[purpose]),
  fields: fields.value.filter((field) => field.purpose === purpose),
})))

const propValue = (key: string): unknown => {
  const node = selectedNode.value
  if (!node) return undefined
  const draftRect = unwrap(designer.draftRects)[node.id]
  if (draftRect && (key === 'x' || key === 'y' || key === 'width' || key === 'height')) {
    const scaleX = Math.max(Math.abs(Number.isFinite(node.props.scaleX) ? node.props.scaleX : 1), 0.0001)
    const scaleY = Math.max(Math.abs(Number.isFinite(node.props.scaleY) ? node.props.scaleY : 1), 0.0001)
    if (key === 'x') return draftRect.x + draftRect.width * node.props.anchorX
    if (key === 'y') return draftRect.y + draftRect.height * node.props.anchorY
    if (key === 'width') return draftRect.width / scaleX
    return draftRect.height / scaleY
  }
  const draftPosition = unwrap(designer.draftPositions)[node.id]
  if (draftPosition && (key === 'x' || key === 'y')) return draftPosition[key]
  const draftRotation = unwrap(designer.draftRotations)[node.id]
  if (draftRotation !== undefined && key === 'rotate') return draftRotation
  return (node.props as unknown as Record<string, unknown>)[key]
}
const propMode = (key: string) => selectedNode.value?.propModes[key] ?? 'value'
const propCode = (key: string) => selectedNode.value?.propCodes[key] ?? ''
const buttonFieldUiId = (field: FieldDescriptor) => {
  if (selectedNode.value?.type !== 'button') return undefined
  if (field.key === 'content') return 'ui-designer-inspector-button-content'
  if (field.key === 'hoverSe' || field.key === 'clickSe') return `ui-designer-inspector-button-${field.key}`
  return undefined
}
const revealPurpose = (purpose: InspectorPurpose) => {
  activeSection.value = 'properties'
  if (!expandedPurposes.value.includes(purpose)) expandedPurposes.value = [...expandedPurposes.value, purpose]
}
const primaryResourceField: Partial<Record<UiNode['type'], string>> = {
  sprite: 'path',
  nineSlice: 'path',
  video: 'path',
  particle: 'imagePath',
}
const revealPrimaryControl = async (selector: string, activate = false) => {
  revealPurpose('contentResources')
  await nextTick()
  const root = inspectorElement.value?.querySelector<HTMLElement>(selector)
  if (!root) return false
  root.scrollIntoView({ block: 'center', inline: 'nearest' })
  if (activate) {
    root.click()
    return true
  }
  const editable = root.matches('input, textarea') ? root : root.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
  editable?.focus()
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) editable.select()
  return Boolean(editable)
}
const editPrimaryNode = async (nodeId: string) => {
  const node = selectedNode.value
  if (!node || node.id !== nodeId) return
  if (node.type === 'text' || node.type === 'button') {
    await revealPrimaryControl('[data-ui-id="ui-designer-property-content-input"]')
    return
  }
  if (node.type === 'frameAnimation') {
    await revealPrimaryControl('[data-ui-id="ui-designer-frames-select-many"]', true)
    return
  }
  const resourceField = primaryResourceField[node.type]
  if (resourceField) {
    await revealPrimaryControl(`[data-ui-id="ui-designer-resource-${resourceField}-select"]`, true)
    return
  }
  revealPurpose(node.type === 'progressBar' ? 'contentResources' : 'appearance')
}
defineExpose({ editPrimaryNode })

const presentationPropertyValue = (targetId: string, key: string, value: unknown) => {
  const node = currentDocument.value.nodes.find((candidate) => candidate.id === targetId)
  return key === 'content' && (node?.type === 'text' || node?.type === 'button') ? normalizeUiSingleLineText(value) : value
}
const updateProperty = (key: string, value: unknown, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.updateNodeProperty(targetId, key, presentationPropertyValue(targetId, key, value))
}
const previewProperty = (key: string, value: unknown, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.previewNodeProperty(targetId, key, presentationPropertyValue(targetId, key, value))
}
const commitProperty = (key: string, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.commitNodePropertyPreview(targetId, key)
}
const cancelProperty = (key: string, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.cancelNodePropertyPreview(targetId, key)
}
const pickFieldResource = async (field: FieldDescriptor) => {
  const node = selectedNode.value
  if (!node) return null
  const selection = await openResourceWorkspace(field.resourceCategory, String(propValue(field.key) ?? ''))
  if (!selection) return null
  if (node.type === 'sprite' && field.key === 'path') {
    designer.setSpriteResource(node.id, selection.path, selection.width && selection.height ? { width: selection.width, height: selection.height } : undefined)
    return null
  }
  return selection.path
}
const updateMode = (key: string, mode: 'value' | 'code') => { if (selectedNode.value) designer.setPropertyMode(selectedNode.value.id, key, mode) }
const updateCode = (key: string, code: string, sceneId?: string, nodeId?: string) => {
  const targetId = nodeId ?? selectedNode.value?.id
  if (targetId) designer.setPropertyCode(targetId, key, code, sceneId)
}
</script>

<template>
  <aside ref="inspectorElement" class="inspector-panel" data-ui-id="ui-designer-inspector" data-testid="ui-designer-inspector">
    <div class="inspector-head">
      <div>
        <span class="inspector-title">{{ t('inspector') }}</span>
        <span v-if="selectedNode" class="inspector-node">{{ selectedNode.name }}</span>
      </div>
      <span v-if="selectedNode" class="inspector-head-actions">
        <el-button size="small" text :disabled="!selectedActionPolicy?.allowed.duplicate" @click="designer.duplicateSelected()">{{ t('duplicateNode') }}</el-button>
        <el-button size="small" text type="danger" :disabled="!selectedActionPolicy?.allowed.delete" @click="designer.executeNodeAction('delete', selectedNode.id)">{{ t('deleteNode') }}</el-button>
      </span>
    </div>
    <div v-if="selectedNode" class="inspector-tabs">
      <el-button data-ui-id="ui-designer-inspector-properties" data-testid="ui-designer-inspector-properties" size="small" text :class="{ active: activeSection === 'properties' }" @click="activeSection = 'properties'">{{ t('value') }}</el-button>
      <el-button data-ui-id="ui-designer-inspector-events" data-testid="ui-designer-inspector-events" size="small" text :class="{ active: activeSection === 'events' }" @click="activeSection = 'events'">{{ t('events') }}</el-button>
      <el-button data-ui-id="ui-designer-inspector-condition" data-testid="ui-designer-inspector-condition" size="small" text :class="{ active: activeSection === 'condition' }" @click="activeSection = 'condition'">{{ t('condition') }}</el-button>
      <el-button data-ui-id="ui-designer-inspector-animation" data-testid="ui-designer-inspector-animation" size="small" text :class="{ active: activeSection === 'animation' }" @click="activeSection = 'animation'">{{ t('enterAnimation') }}</el-button>
    </div>
    <el-alert v-if="nodeValidationErrors.length" class="inspector-validation" type="error" :closable="false" :title="`${nodeValidationErrors.length} ${t('validationErrors')}`"><ul><li v-for="issue in nodeValidationErrors" :key="`${issue.path}:${issue.message}`"><span>{{ validationIssueLabel(issue) }}<template v-if="issue.path"> · {{ issue.path }}</template></span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details></li></ul></el-alert>
    <el-alert v-if="selectedRuntimeDiagnostics.length" class="inspector-validation" type="warning" :closable="false" :title="`${t('runtimeDiagnostics')} · ${selectedRuntimeDiagnostics.length}`"><ul><li v-for="diagnostic in selectedRuntimeDiagnostics" :key="`${diagnostic.sessionId}:${diagnostic.code}:${diagnostic.message}`"><span>{{ t('runtimeDiagnostic') }}<template v-if="diagnostic.count > 1"> ×{{ diagnostic.count }}</template></span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ diagnostic.label }}: {{ diagnostic.message }}</span></details></li></ul></el-alert>
    <div v-if="!selectedNode" class="inspector-empty">{{ t('noSelection') }}</div>
    <div v-else-if="activeSection === 'properties'" class="properties-scroll">
      <el-collapse v-model="expandedPurposes" class="inspector-purpose-groups">
        <el-collapse-item v-for="group in fieldGroups" :key="group.purpose" :name="group.purpose" :data-ui-id="`ui-designer-inspector-group-${group.purpose}`">
          <template #title><span class="inspector-purpose-title">{{ group.label }}</span></template>
          <el-input
            v-if="group.purpose === 'identity'"
            :model-value="nodeNameDraft"
            size="small"
            :placeholder="t('nodeNamePlaceholder')"
            data-ui-id="ui-designer-node-name"
            @update:model-value="previewNodeName"
            @blur="commitNodeName"
            @keydown.enter.prevent="commitNodeName"
          />
          <div v-if="group.fields.length" class="property-grid">
            <UiPropertyField
            v-for="field in group.fields"
            :key="`${group.purpose}:${field.key}`"
            :class="{
              'button-content-primary': selectedNode.type === 'button' && group.purpose === 'contentResources' && field.key === 'content',
              'button-se-priority': selectedNode.type === 'button' && group.purpose === 'contentResources' && (field.key === 'hoverSe' || field.key === 'clickSe'),
            }"
            :data-ui-id="buttonFieldUiId(field)"
            :data-testid="buttonFieldUiId(field)"
            :field-key="field.key"
            :label="fieldLabel(field)"
            :help="field.help"
            :multiline="field.multiline"
            :value="propValue(field.key)"
            :mode="propMode(field.key)"
            :code="propCode(field.key)"
            :kind="field.kind"
            :unit="field.unit"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :options="field.options"
            :resource-category="field.resourceCategory"
            :resource-picker="field.kind === 'resource' ? () => pickFieldResource(field) : undefined"
            :resource-picker-disabled="field.kind === 'resource' && !designer.hasProject"
            :format-on-blur="Boolean(designer.preferences.autoFormat)"
            :code-font-family="designer.preferences.codeFontFamily"
            :code-font-size="designer.preferences.codeFontSize"
            :issues="issuesForField(field)"
            :code-adapter="designer.adapters.code"
            :draft-coordinator="designer.draftCoordinator"
            :scene-id="designer.activeSceneId"
            :node-id="selectedNode.id"
            :completion-items="[...UI_DESIGNER_NODE_SCRIPT_COMPLETIONS, ...designer.document.nodes.flatMap((node) => [node.id, node.name])]"
            @value="(value, _sceneId, nodeId) => updateProperty(field.key, value, nodeId)"
            @preview="(value, _sceneId, nodeId) => previewProperty(field.key, value, nodeId)"
            @commit="(_sceneId, nodeId) => commitProperty(field.key, nodeId)"
            @cancel="(_sceneId, nodeId) => cancelProperty(field.key, nodeId)"
            @mode="updateMode(field.key, $event)"
            @code="(code, sceneId, nodeId) => updateCode(field.key, code, sceneId, nodeId)"
            />
            <UiButtonStatesEditor
              v-if="group.purpose === 'contentResources' && selectedNode.type === 'button'"
              class="button-states-priority"
              data-ui-id="ui-designer-button-states"
              data-testid="ui-designer-button-states"
              :value="selectedNode.props.imageStates"
              :resources="designer.resourceCatalog?.resources ?? []"
              :pick-resource="designer.hasProject ? (currentPath) => pickResourcePath('image', currentPath) : undefined"
              :resource-picker-disabled="!designer.hasProject"
              @update="updateProperty('imageStates', $event)"
            />
            <el-button
              v-if="group.purpose === 'contentResources' && selectedNode.type === 'button'"
              class="button-events-priority"
              data-ui-id="ui-designer-inspector-button-events"
              data-testid="ui-designer-inspector-button-events"
              size="small"
              plain
              @click="activeSection = 'events'"
            >
              {{ t('events') }}
            </el-button>
          </div>
          <UiPaddingEditor
            v-if="group.purpose === 'appearance' && (selectedNode.type === 'text' || selectedNode.type === 'button')"
            :value="selectedNode.props.padding"
            @update="updateProperty('padding', $event)"
          />
          <UiFrameListEditor
            v-if="group.purpose === 'contentResources' && selectedNode.type === 'frameAnimation'"
            :value="selectedNode.props.frames"
            :resources="designer.resourceCatalog?.resources ?? []"
            :pick-resource="designer.hasProject ? (currentPath) => pickResourcePath('image', currentPath) : undefined"
            :pick-resources="designer.hasProject ? () => openMultiResourceWorkspace('image') : undefined"
            :resource-picker-disabled="!designer.hasProject"
            @update="updateProperty('frames', $event)"
          />
        </el-collapse-item>
      </el-collapse>
    </div>
    <UiDesignerEvents
      v-else-if="activeSection === 'events'"
      :key="`events-${selectedNode.id}`"
      :designer="designer"
      :node="selectedNode"
      :pick-audio-resource="designer.hasProject ? () => pickResourcePath('audio') : undefined"
      :resource-picker-disabled="!designer.hasProject"
    />
    <UiDesignerConditions v-else-if="activeSection === 'condition'" :key="`condition-${selectedNode.id}`" :designer="designer" :node="selectedNode" />
    <UiDesignerAnimations v-else :designer="designer" :node="selectedNode" />
    <el-dialog
      :model-value="resourceWorkspaceVisible"
      :title="t('chooseResource')"
      :width="`${resourceWorkspaceSize.width}px`"
      :style="resourceWorkspaceDialogStyle"
      top="4vh"
      append-to-body
      destroy-on-close
      data-ui-id="ui-designer-resource-workspace-dialog"
      @update:model-value="closeResourceWorkspace"
      @opened="handleResourceWorkspaceOpened"
      @closed="handleResourceWorkspaceClosed"
    >
      <div class="resource-workspace-shell">
        <div class="resource-workspace-host" :style="{ height: `${resourceWorkspaceSize.height}px` }">
          <ProjectAssetsWorkspace
            :key="resourceWorkspaceRequest"
            mode="select"
            :resource-kind="resourceWorkspaceCategory"
            :current-path="resourceWorkspaceCurrentPath"
            :multiple="resourceWorkspaceMultiple"
            @select="settleResourceWorkspace"
            @select-many="settleResourceWorkspace"
            @cancel="settleResourceWorkspace(null)"
            @mutated="designer.notifyResourceMutation"
          />
        </div>
      </div>
    </el-dialog>
    <Teleport v-if="resourceWorkspaceVisible && resourceWorkspacePosition" to="body">
      <div class="resource-workspace-resize-frame" :style="resourceWorkspaceResizeFrameStyle" aria-hidden="true">
        <div
          v-for="edge in resourceWorkspaceResizeEdges"
          :key="edge"
          class="resource-workspace-resize-edge"
          :class="edge"
          @pointerdown="beginResourceWorkspaceResize($event, edge)"
        />
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.inspector-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; gap: 9px; padding: 10px; overflow: hidden; background: var(--app-bg); }
.inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.inspector-head-actions { display: inline-flex; align-items: center; }
.inspector-head-actions .el-button { margin-left: 0; padding-inline: 5px; }
.inspector-title { display: block; font-size: 13px; font-weight: 650; }
.inspector-node { display: block; max-width: 210px; overflow: hidden; text-overflow: ellipsis; color: var(--app-ink-soft); font-size: 11px; }
.inspector-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; border-bottom: 1px solid var(--app-border); }
.inspector-tabs .el-button { width: 100%; min-width: 0; margin: 0; padding: 5px 3px; overflow: hidden; border-radius: 0; color: var(--app-ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.inspector-tabs .el-button.active { border-bottom: 2px solid var(--app-accent); color: var(--app-accent); }
.inspector-validation { margin-bottom: 2px; }.inspector-validation ul { margin: 4px 0 0; padding-left: 16px; }
.properties-scroll { min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 0 6px 0 10px; }
.inspector-purpose-groups { border-block: 0; }
.inspector-purpose-groups :deep(.el-collapse-item__header) { min-height: 34px; height: auto; background: transparent; color: var(--app-ink-soft); }
.inspector-purpose-groups :deep(.el-collapse-item__wrap) { background: transparent; }
.inspector-purpose-groups :deep(.el-collapse-item__content) { padding: 2px 0 12px; color: inherit; }
.inspector-purpose-title { margin: 0; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }
.property-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.property-grid > * { order: 4; }
.property-grid .button-content-primary { order: 0; }
.property-grid .button-states-priority { order: 1; }
.property-grid .button-events-priority { order: 2; justify-self: start; margin: 0; }
.property-grid .button-se-priority { order: 3; }
.resource-workspace-shell { margin: 0 -4px -4px 0; }
.resource-workspace-host { min-height: 0; overflow: hidden; }
.resource-workspace-resize-frame { position: fixed; z-index: 4000; pointer-events: none; }
.resource-workspace-resize-edge { position: absolute; z-index: 10; background: transparent; pointer-events: auto; touch-action: none; user-select: none; }
.resource-workspace-resize-edge.n { top: -5px; right: 12px; left: 12px; height: 10px; cursor: ns-resize; }
.resource-workspace-resize-edge.e { top: 12px; right: -5px; bottom: 12px; width: 10px; cursor: ew-resize; }
.resource-workspace-resize-edge.s { right: 12px; bottom: -5px; left: 12px; height: 10px; cursor: ns-resize; }
.resource-workspace-resize-edge.w { top: 12px; bottom: 12px; left: -5px; width: 10px; cursor: ew-resize; }
.resource-workspace-resize-edge.ne, .resource-workspace-resize-edge.sw { width: 17px; height: 17px; cursor: nesw-resize; }
.resource-workspace-resize-edge.nw, .resource-workspace-resize-edge.se { width: 17px; height: 17px; cursor: nwse-resize; }
.resource-workspace-resize-edge.ne, .resource-workspace-resize-edge.nw { top: -5px; }
.resource-workspace-resize-edge.se, .resource-workspace-resize-edge.sw { bottom: -5px; }
.resource-workspace-resize-edge.ne, .resource-workspace-resize-edge.se { right: -5px; }
.resource-workspace-resize-edge.nw, .resource-workspace-resize-edge.sw { left: -5px; }
.inspector-empty { display: grid; place-items: center; flex: 1; min-height: 180px; color: var(--app-ink-soft); font-size: 12px; text-align: center; }
.inspector-section-title { color: var(--app-ink-soft); font-size: 11px; font-weight: 650; text-transform: uppercase; }
</style>
