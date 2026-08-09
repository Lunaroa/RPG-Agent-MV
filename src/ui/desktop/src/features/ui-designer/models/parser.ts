import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_EDITOR_VERSION,
  UI_DESIGNER_NODE_TYPES,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiConditionFrequency,
  type UiDesignerDocument,
  type UiDesignerNodeType,
  type UiEventAction,
  type UiNode,
  type UiCanvasSettings,
  type UiGlobalFilter,
  type UiTransitions,
  type UiValidationIssue,
  type UiVisibilityCondition,
} from '@contract/ui-designer'
import { migrateUiDesignerDocument } from '@contract/ui-designer-script'
import { cloneUiDocument, createDefaultNode, createUiDocument, setCanvasDimensions } from './document'
import { normalizeDocumentGeometry } from './geometry'
import { validateTreeInvariants } from './tree'

export interface UiDocumentParseSuccess {
  ok: true
  document: UiDesignerDocument
  issues: UiValidationIssue[]
}

export interface UiDocumentParseFailure {
  ok: false
  document: null
  issues: UiValidationIssue[]
}

export type UiDocumentParseResult = UiDocumentParseSuccess | UiDocumentParseFailure

const issue = (message: string, code: UiValidationIssue['code'] = 'invalid-document-shape', path?: string): UiValidationIssue => ({ severity: 'error', code, message, path })
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const has = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const forbiddenExtensionKeys = new Set(['__proto__', 'prototype', 'constructor'])
function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value === 'string' || typeof value === 'boolean') return depth <= 32
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJsonSafe(item, depth + 1))
  if (!isObject(value)) return false
  return Object.entries(value).every(([key, item]) => !forbiddenExtensionKeys.has(key) && isJsonSafe(item, depth + 1))
}
function copyExtensions(source: Record<string, unknown>, knownKeys: readonly string[], path: string, issues: UiValidationIssue[]): Record<string, unknown> {
  const known = new Set(knownKeys)
  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (known.has(key)) continue
    if (forbiddenExtensionKeys.has(key)) {
      issues.push(issue(`Extension key ${key} is not allowed`, 'invalid-document-shape', `${path}.${key}`))
      continue
    }
    if (!isJsonSafe(value)) {
      issues.push(issue(`Extension ${key} must be JSON-safe`, 'invalid-document-shape', `${path}.${key}`))
      continue
    }
    extensions[key] = value
  }
  return extensions
}

function requireObject(value: unknown, label: string, path: string, issues: UiValidationIssue[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    issues.push(issue(`${label} must be an object`, 'invalid-document-shape', path))
    return false
  }
  return true
}

function checkExactVersion(value: unknown, expected: string, label: string, path: string, issues: UiValidationIssue[]): value is string {
  if (value !== expected) {
    issues.push(issue(`${label} must be exactly ${expected}`, 'unsupported-version', path))
    return false
  }
  return true
}

function validateCondition(value: unknown, path: string, issues: UiValidationIssue[]): value is UiVisibilityCondition {
  if (!isObject(value) || typeof value.type !== 'string') {
    issues.push(issue('Condition must include a type', 'invalid-document-shape', path))
    return false
  }
  if (value.type === 'none') return true
  if (value.type === 'switch_on' || value.type === 'switch_off') {
    if (!Number.isInteger(value.switchId) || Number(value.switchId) <= 0) issues.push(issue('Condition switchId must be a positive integer', 'invalid-value', `${path}.switchId`))
    return true
  }
  if (value.type === 'variable') {
    if (!Number.isInteger(value.variableId) || Number(value.variableId) <= 0) issues.push(issue('Condition variableId must be a positive integer', 'invalid-value', `${path}.variableId`))
    if (!['==', '>=', '<=', '>', '<', '!='].includes(String(value.operator)) || !isFiniteNumber(value.value)) issues.push(issue('Variable condition requires a valid operator and finite value', 'invalid-document-shape', path))
    return true
  }
  if (value.type === 'code') {
    if (typeof value.code !== 'string') issues.push(issue('Code condition requires code text', 'invalid-document-shape', `${path}.code`))
    return true
  }
  if (value.type === 'and' || value.type === 'or') {
    if (!Array.isArray(value.children)) issues.push(issue('Composite condition requires children', 'invalid-document-shape', `${path}.children`))
    else value.children.forEach((child, index) => validateCondition(child, `${path}.children.${index}`, issues))
    return true
  }
  issues.push(issue(`Unsupported condition type ${value.type}`, 'invalid-document-shape', `${path}.type`))
  return false
}

function validateAction(value: unknown, path: string, issues: UiValidationIssue[]): value is UiEventAction {
  if (!isObject(value) || typeof value.type !== 'string') {
    issues.push(issue('Every action requires a type', 'invalid-document-shape', path))
    return false
  }
  if (has(value, 'id') && value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim())) issues.push(issue('Action id, when present, must be a non-empty string', 'invalid-document-shape', `${path}.id`))
  const type = value.type
  copyExtensions(value, ['id', 'type', 'condition', 'sceneName', 'targetNodeId', 'tweenNodeId', 'seName', 'url', 'code', 'message', 'variableId', 'variableOp', 'variableVal', 'switchId', 'switchVal', 'tweenProp', 'tweenTarget', 'tweenDuration', 'tweenEasing', 'waitFrames'], path, issues)
  const known = ['none', 'newGame', 'continue', 'options', 'exit', 'gotoScene', 'toggleNode', 'playSe', 'url', 'script', 'setVariable', 'setSwitch', 'showMessage', 'tweenProp', 'wait']
  if (!known.includes(type)) {
    issues.push(issue(`Unsupported action type ${type}`, 'invalid-document-shape', `${path}.type`))
    return false
  }
  const requireString = (key: string) => { if (typeof value[key] !== 'string') issues.push(issue(`Action ${type} requires ${key}`, 'invalid-document-shape', `${path}.${key}`)) }
  const requireNumber = (key: string, positive = false, integer = false, nonNegative = true) => {
    const number = value[key]
    if (!isFiniteNumber(number) || (integer && !Number.isInteger(number)) || (positive && Number(number) <= 0) || (!positive && nonNegative && Number(number) < 0)) {
      issues.push(issue(`Action ${type}.${key} has an invalid number`, 'invalid-value', `${path}.${key}`))
    }
  }
  if (type === 'gotoScene') requireString('sceneName')
  if (type === 'toggleNode' || type === 'tweenProp') requireString(type === 'toggleNode' ? 'targetNodeId' : 'tweenNodeId')
  if (type === 'playSe') requireString('seName')
  if (type === 'url') {
    requireString('url')
    if (typeof value.url === 'string' && !/^https?:\/\//i.test(value.url)) issues.push(issue('URL action only accepts http/https links', 'invalid-value', `${path}.url`))
  }
  if (type === 'script') requireString('code')
  if (type === 'showMessage') requireString('message')
  if (type === 'setVariable') {
    requireNumber('variableId', true, true)
    requireNumber('variableVal', false, false, false)
    if (!['=', '+', '-', '*', '/'].includes(String(value.variableOp))) issues.push(issue('setVariable requires a valid variableOp', 'invalid-value', `${path}.variableOp`))
  }
  if (type === 'setSwitch') { requireNumber('switchId', true, true); if (!['on', 'off', 'toggle'].includes(String(value.switchVal))) issues.push(issue('setSwitch requires on/off/toggle', 'invalid-value', `${path}.switchVal`)) }
  if (type === 'tweenProp') {
    requireString('tweenProp')
    requireNumber('tweenTarget', false, false, false)
    requireNumber('tweenDuration', false)
    if (!['Linear', 'EaseIn', 'EaseOut', 'EaseInOut', 'Bounce'].includes(String(value.tweenEasing))) issues.push(issue('tweenProp requires a valid tweenEasing', 'invalid-value', `${path}.tweenEasing`))
  }
  if (type === 'wait') requireNumber('waitFrames', false, true)
  if (has(value, 'condition') && value.condition !== undefined) {
    const condition = value.condition
    if (!isObject(condition) || !['switch', 'variable', 'code'].includes(String(condition.type))) {
      issues.push(issue('Action condition has an invalid shape', 'invalid-document-shape', `${path}.condition`))
    } else if (condition.type === 'switch') {
      if (!Number.isInteger(condition.switchId) || Number(condition.switchId) <= 0) issues.push(issue('Action switch condition requires a positive integer switchId', 'invalid-value', `${path}.condition.switchId`))
    } else if (condition.type === 'variable') {
      if (!Number.isInteger(condition.variableId) || Number(condition.variableId) <= 0) issues.push(issue('Action variable condition requires a positive integer variableId', 'invalid-value', `${path}.condition.variableId`))
      if (!['==', '>=', '<=', '>', '<', '!='].includes(String(condition.operator)) || !isFiniteNumber(condition.value)) issues.push(issue('Action variable condition requires a valid operator and finite value', 'invalid-document-shape', `${path}.condition`))
    } else if (typeof condition.code !== 'string') {
      issues.push(issue('Action code condition requires code text', 'invalid-document-shape', `${path}.condition.code`))
    }
  }
  return true
}

function validatePropsShape(type: UiDesignerNodeType, props: Record<string, unknown>, path: string, issues: UiValidationIssue[]): void {
  const numeric = new Set(['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotate', 'opacity', 'anchorX', 'anchorY', 'zIndex', 'scrollX', 'scrollY', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'defaultFrameDuration', 'speed', 'initialFrame', 'fontSize', 'wrapWidth', 'letterSpacing', 'strokeWidth', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur', 'borderWidth', 'borderRadius', 'pressedScale', 'focusWidth', 'trackRadius', 'fillRadius', 'currentValue', 'maxValue', 'playbackRate', 'maxParticles', 'emissionInterval', 'velocityX', 'velocityY', 'velocityRandomX', 'velocityRandomY', 'gravityX', 'gravityY', 'rotationSpeed', 'lifetime', 'lifetimeRandom', 'startScale', 'endScale', 'startOpacity', 'endOpacity', 'glow'])
  const booleans = new Set(['visible', 'clip', 'loop', 'richText', 'italic', 'showGuides', 'animateValue', 'autoplay', 'muted', 'clickThrough'])
  const strings = new Set(['backgroundPath', 'path', 'tint', 'fillMode', 'repeatMode', 'blendMode', 'content', 'fontFile', 'fontWeight', 'textColor', 'strokeColor', 'shadowColor', 'align', 'verticalAlign', 'backgroundColor', 'borderColor', 'hoverTint', 'disabledCondition', 'focusColor', 'hoverSe', 'clickSe', 'trackImage', 'trackColor', 'fillImage', 'fillColor', 'fillDirection', 'posterPath', 'emissionArea', 'imagePath', 'shape', 'startColor', 'endColor'])
  copyExtensions(props, [...numeric, ...booleans, ...strings, 'frames', 'padding', 'imageStates'], path, issues)
  for (const [key, value] of Object.entries(props)) {
    if (numeric.has(key) && !isFiniteNumber(value)) issues.push(issue(`${type}.${key} must be a finite number`, 'invalid-value', `${path}.${key}`))
    if (booleans.has(key) && typeof value !== 'boolean') issues.push(issue(`${type}.${key} must be boolean`, 'invalid-document-shape', `${path}.${key}`))
    if (strings.has(key) && typeof value !== 'string') issues.push(issue(`${type}.${key} must be a string`, 'invalid-document-shape', `${path}.${key}`))
  }
  const enumValues: Record<string, readonly string[]> = {
    backgroundFillMode: ['stretch', 'cover', 'contain', 'tile'],
    fillMode: ['stretch', 'cover', 'contain', 'tile'],
    backgroundRepeatMode: ['none', 'horizontal', 'vertical', 'both'],
    repeatMode: ['none', 'horizontal', 'vertical', 'both'],
    blendMode: ['normal', 'add', 'multiply', 'screen', 'overlay'],
    fontWeight: ['normal', 'bold', 'light'],
    align: ['left', 'center', 'right'],
    verticalAlign: ['top', 'middle', 'bottom'],
    fillDirection: ['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom'],
    emissionArea: ['point', 'rectangle', 'circle'],
    shape: ['circle', 'square', 'star'],
  }
  for (const [key, values] of Object.entries(enumValues)) {
    if (has(props, key) && typeof props[key] === 'string' && !values.includes(props[key] as string)) {
      issues.push(issue(`${type}.${key} has an unsupported value`, 'invalid-value', `${path}.${key}`))
    }
  }
  const positiveNumbers = new Set(['width', 'height', 'scaleX', 'scaleY', 'fontSize', 'playbackRate', 'maxValue'])
  for (const key of positiveNumbers) {
    if (has(props, key) && isFiniteNumber(props[key]) && props[key] <= 0) issues.push(issue(`${type}.${key} must be greater than zero`, 'invalid-value', `${path}.${key}`))
  }
  const boundedZeroToOne = new Set(['anchorX', 'anchorY'])
  for (const key of boundedZeroToOne) {
    if (has(props, key) && isFiniteNumber(props[key]) && (props[key] < 0 || props[key] > 1)) issues.push(issue(`${type}.${key} must be between 0 and 1`, 'invalid-value', `${path}.${key}`))
  }
  if (has(props, 'opacity') && isFiniteNumber(props.opacity) && (props.opacity < 0 || props.opacity > 255)) issues.push(issue(`${type}.opacity must be between 0 and 255`, 'invalid-value', `${path}.opacity`))
  for (const key of ['startOpacity', 'endOpacity'] as const) {
    if (has(props, key) && isFiniteNumber(props[key]) && (props[key] < 0 || props[key] > 255)) issues.push(issue(`${type}.${key} must be between 0 and 255`, 'invalid-value', `${path}.${key}`))
  }
  if (type === 'progressBar' && has(props, 'currentValue') && has(props, 'maxValue') && isFiniteNumber(props.currentValue) && isFiniteNumber(props.maxValue) && props.currentValue > props.maxValue) {
    issues.push(issue('progressBar.currentValue cannot exceed maxValue', 'invalid-value', `${path}.currentValue`))
  }
  if (type === 'text' || type === 'button') {
    if (!isObject(props.padding)) issues.push(issue(`${type}.padding must contain top/right/bottom/left`, 'invalid-document-shape', `${path}.padding`))
    else for (const side of ['top', 'right', 'bottom', 'left']) if (!isFiniteNumber(props.padding[side])) issues.push(issue(`${type}.padding.${side} must be finite`, 'invalid-value', `${path}.padding.${side}`))
  }
  if (type === 'frameAnimation' && has(props, 'frames')) {
    if (!Array.isArray(props.frames)) issues.push(issue('frameAnimation.frames must be an array', 'invalid-document-shape', `${path}.frames`))
    else props.frames.forEach((frame, index) => {
      if (!isObject(frame) || typeof frame.id !== 'string' || !frame.id.trim() || typeof frame.path !== 'string' || !isFiniteNumber(frame.duration) || frame.duration < 0) issues.push(issue('Frame requires id, path, and non-negative finite duration', 'invalid-document-shape', `${path}.frames.${index}`))
    })
  }
  if (type === 'button' && has(props, 'imageStates')) {
    const imageStates = props.imageStates
    if (!isObject(imageStates) || ['normal', 'hover', 'pressed', 'disabled'].some((key) => typeof imageStates[key] !== 'string')) issues.push(issue('button.imageStates requires four string paths', 'invalid-document-shape', `${path}.imageStates`))
  }
}

function normalizeTransitions(value: Record<string, unknown> | undefined, fallback: UiTransitions, issues: UiValidationIssue[]): UiTransitions {
  const source = value ?? {}
  const parseTransition = (key: 'enter' | 'exit'): UiTransitions[typeof key] => {
    const candidate = has(source, key) ? source[key] : fallback[key]
    if (!isObject(candidate)) {
      issues.push(issue(`transitions.${key} must be an object`, 'invalid-document-shape', `transitions.${key}`))
      return fallback[key]
    }
    const typeValues = ['none', 'fade', 'slideLeft', 'slideRight'] as const
    if (!typeValues.includes(String(candidate.type) as typeof typeValues[number])) issues.push(issue(`transitions.${key}.type is invalid`, 'invalid-value', `transitions.${key}.type`))
    if (!isFiniteNumber(candidate.duration) || candidate.duration < 0) issues.push(issue(`transitions.${key}.duration must be non-negative`, 'invalid-value', `transitions.${key}.duration`))
    return {
      type: typeValues.includes(String(candidate.type) as typeof typeValues[number]) ? candidate.type as UiTransitions[typeof key]['type'] : fallback[key].type,
      duration: isFiniteNumber(candidate.duration) && candidate.duration >= 0 ? candidate.duration : fallback[key].duration,
    }
  }
  return { ...copyExtensions(source, ['enter', 'exit'], 'transitions', issues), enter: parseTransition('enter'), exit: parseTransition('exit') } as UiTransitions
}

function normalizeGlobalFilter(value: Record<string, unknown> | undefined, fallback: UiGlobalFilter, issues: UiValidationIssue[]): UiGlobalFilter {
  const source = value ?? {}
  const blur = has(source, 'blur') ? source.blur : fallback.blur
  const glow = has(source, 'glow') ? source.glow : fallback.glow
  const preset = has(source, 'preset') ? source.preset : fallback.preset
  if (!isFiniteNumber(blur) || blur < 0) issues.push(issue('globalFilter.blur must be a non-negative number', 'invalid-value', 'globalFilter.blur'))
  if (!isFiniteNumber(glow) || glow < 0) issues.push(issue('globalFilter.glow must be a non-negative number', 'invalid-value', 'globalFilter.glow'))
  if (typeof preset !== 'string') issues.push(issue('globalFilter.preset must be a string', 'invalid-document-shape', 'globalFilter.preset'))
  return {
    ...copyExtensions(source, ['blur', 'glow', 'preset'], 'globalFilter', issues),
    blur: isFiniteNumber(blur) && blur >= 0 ? blur : fallback.blur,
    glow: isFiniteNumber(glow) && glow >= 0 ? glow : fallback.glow,
    preset: typeof preset === 'string' ? preset : fallback.preset,
  }
}

function normalizeCanvas(value: Record<string, unknown> | undefined, fallback: UiCanvasSettings, issues: UiValidationIssue[]): UiCanvasSettings {
  const source = value ?? {}
  const width = has(source, 'width') ? source.width : fallback.width
  const height = has(source, 'height') ? source.height : fallback.height
  const backgroundColor = has(source, 'backgroundColor') ? source.backgroundColor : fallback.backgroundColor
  const backgroundPattern = has(source, 'backgroundPattern') ? source.backgroundPattern : fallback.backgroundPattern
  if (!isFiniteNumber(width) || width <= 0) issues.push(issue('canvas.width must be positive', 'invalid-value', 'canvas.width'))
  if (!isFiniteNumber(height) || height <= 0) issues.push(issue('canvas.height must be positive', 'invalid-value', 'canvas.height'))
  if (typeof backgroundColor !== 'string') issues.push(issue('canvas.backgroundColor must be a string', 'invalid-document-shape', 'canvas.backgroundColor'))
  if (!['solid', 'checkerboard'].includes(String(backgroundPattern))) issues.push(issue('canvas.backgroundPattern is invalid', 'invalid-value', 'canvas.backgroundPattern'))
  const grid = has(source, 'grid') ? source.grid : fallback.grid
  const snap = has(source, 'snap') ? source.snap : fallback.snap
  const mapBackground = has(source, 'mapBackground') ? source.mapBackground : fallback.mapBackground
  if (!isObject(grid) || typeof grid.enabled !== 'boolean' || !isFiniteNumber(grid.size) || grid.size <= 0 || typeof grid.color !== 'string') issues.push(issue('canvas.grid has an invalid shape', 'invalid-document-shape', 'canvas.grid'))
  if (!isObject(snap) || typeof snap.enabled !== 'boolean' || typeof snap.smartEnabled !== 'boolean' || !isFiniteNumber(snap.sensitivity) || snap.sensitivity < 0) issues.push(issue('canvas.snap has an invalid shape', 'invalid-document-shape', 'canvas.snap'))
  if (!isObject(mapBackground) || !Number.isInteger(mapBackground.mapId) || Number(mapBackground.mapId) < 0 || !isFiniteNumber(mapBackground.blur) || Number(mapBackground.blur) < 0 || !Number.isInteger(mapBackground.switchId) || Number(mapBackground.switchId) < 0) issues.push(issue('canvas.mapBackground has an invalid shape', 'invalid-document-shape', 'canvas.mapBackground'))
  if (typeof source.rulers !== 'boolean') issues.push(issue('canvas.rulers must be boolean', 'invalid-document-shape', 'canvas.rulers'))
  if (typeof source.guidesVisible !== 'boolean') issues.push(issue('canvas.guidesVisible must be boolean', 'invalid-document-shape', 'canvas.guidesVisible'))
  return {
    ...copyExtensions(source, ['width', 'height', 'backgroundColor', 'backgroundPattern', 'grid', 'snap', 'rulers', 'guidesVisible', 'mapBackground'], 'canvas', issues),
    width: isFiniteNumber(width) && width > 0 ? width : fallback.width,
    height: isFiniteNumber(height) && height > 0 ? height : fallback.height,
    backgroundColor: typeof backgroundColor === 'string' ? backgroundColor : fallback.backgroundColor,
    backgroundPattern: backgroundPattern === 'checkerboard' ? 'checkerboard' : 'solid',
    grid: isObject(grid) && typeof grid.enabled === 'boolean' && isFiniteNumber(grid.size) && grid.size > 0 && typeof grid.color === 'string'
      ? { ...copyExtensions(grid, ['enabled', 'size', 'color'], 'canvas.grid', issues), enabled: grid.enabled, size: grid.size, color: grid.color }
      : fallback.grid,
    snap: isObject(snap) && typeof snap.enabled === 'boolean' && typeof snap.smartEnabled === 'boolean' && isFiniteNumber(snap.sensitivity) && snap.sensitivity >= 0
      ? { ...copyExtensions(snap, ['enabled', 'smartEnabled', 'sensitivity'], 'canvas.snap', issues), enabled: snap.enabled, smartEnabled: snap.smartEnabled, sensitivity: snap.sensitivity }
      : fallback.snap,
    rulers: typeof source.rulers === 'boolean' ? source.rulers : fallback.rulers,
    guidesVisible: typeof source.guidesVisible === 'boolean' ? source.guidesVisible : fallback.guidesVisible,
    mapBackground: isObject(mapBackground) && Number.isInteger(mapBackground.mapId) && Number(mapBackground.mapId) >= 0 && isFiniteNumber(mapBackground.blur) && Number(mapBackground.blur) >= 0 && Number.isInteger(mapBackground.switchId) && Number(mapBackground.switchId) >= 0
      ? { ...copyExtensions(mapBackground, ['mapId', 'blur', 'switchId'], 'canvas.mapBackground', issues), mapId: mapBackground.mapId as number, blur: mapBackground.blur as number, switchId: mapBackground.switchId as number }
      : fallback.mapBackground,
  }
}

function normalizeNode(value: unknown, index: number, issues: UiValidationIssue[]): UiNode | null {
  const path = `nodes.${index}`
  if (!isObject(value)) { issues.push(issue(`Node ${index} must be an object`, 'invalid-document-shape', path)); return null }
  const type = value.type
  if (typeof type !== 'string' || !UI_DESIGNER_NODE_TYPES.includes(type as UiDesignerNodeType)) { issues.push(issue(`Node ${index} has an unsupported type`, 'invalid-document-shape', `${path}.type`)); return null }
  const required = ['id', 'name', 'parentId', 'children', 'props']
  for (const key of required) if (!has(value, key)) issues.push(issue(`Node ${index} is missing ${key}`, 'invalid-document-shape', `${path}.${key}`))
  if (typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || (value.parentId !== null && typeof value.parentId !== 'string')) issues.push(issue(`Node ${index} has invalid identity fields`, 'invalid-document-shape', path))
  copyExtensions(value, ['id', 'type', 'name', 'parentId', 'children', 'props', 'propModes', 'propCodes', 'locked', 'condition', 'conditionFrequency', 'enterAnim', 'exitAnim', 'events'], path, issues)
  if (!Array.isArray(value.children) || value.children.some((child) => typeof child !== 'string')) issues.push(issue(`Node ${index} children must be an array of strings`, 'invalid-document-shape', `${path}.children`))
  if (!requireObject(value.props, 'Node props', `${path}.props`, issues)) return null
  const props = value.props
  const defaults = createDefaultNode(type as UiDesignerNodeType, { id: String(value.id), name: String(value.name), parentId: value.parentId as string | null })
  validatePropsShape(type as UiDesignerNodeType, props, `${path}.props`, issues)
  const propModes = has(value, 'propModes') ? (isObject(value.propModes) ? value.propModes : undefined) : {}
  const propCodes = has(value, 'propCodes') ? (isObject(value.propCodes) ? value.propCodes : undefined) : {}
  if (!propModes) issues.push(issue(`Node ${value.id} propModes must be an object`, 'invalid-document-shape', `${path}.propModes`))
  else if (Object.values(propModes).some((mode) => mode !== 'value' && mode !== 'code')) issues.push(issue(`Node ${value.id} propModes has invalid values`, 'invalid-document-shape', `${path}.propModes`))
  if (!propCodes) issues.push(issue(`Node ${value.id} propCodes must be an object`, 'invalid-document-shape', `${path}.propCodes`))
  else if (Object.values(propCodes).some((code) => typeof code !== 'string')) issues.push(issue(`Node ${value.id} propCodes must contain strings`, 'invalid-document-shape', `${path}.propCodes`))
  const condition = has(value, 'condition') ? value.condition : defaults.condition
  validateCondition(condition, `${path}.condition`, issues)
  const locked = has(value, 'locked') ? value.locked : defaults.locked
  if (typeof locked !== 'boolean') issues.push(issue(`Node ${value.id} locked must be boolean`, 'invalid-document-shape', `${path}.locked`))
  const conditionFrequency = has(value, 'conditionFrequency') ? value.conditionFrequency : defaults.conditionFrequency
  if (!['per-frame', 'every-10-frames', 'per-second'].includes(String(conditionFrequency))) {
    issues.push(issue(`Node ${value.id} conditionFrequency must be per-frame, every-10-frames, or per-second`, 'invalid-value', `${path}.conditionFrequency`))
  }
  for (const phase of ['enterAnim', 'exitAnim']) {
    const animation = has(value, phase) ? value[phase] : phase === 'enterAnim' ? defaults.enterAnim : defaults.exitAnim
    if (!isObject(animation) || typeof animation.type !== 'string' || !isFiniteNumber(animation.duration) || typeof animation.easing !== 'string') issues.push(issue(`Node ${value.id} ${phase} has an invalid shape`, 'invalid-document-shape', `${path}.${phase}`))
  }
  const events = has(value, 'events') ? (isObject(value.events) ? value.events : undefined) : {}
  if (!events) issues.push(issue(`Node ${value.id} events must be an object`, 'invalid-document-shape', `${path}.events`))
  for (const [eventName, handler] of Object.entries(events ?? {})) {
    if (!isObject(handler) || !Array.isArray(handler.actions) || handler.actions.some((action, actionIndex) => !validateAction(action, `${path}.events.${eventName}.actions.${actionIndex}`, issues))) issues.push(issue(`Event ${eventName} has an invalid handler`, 'invalid-document-shape', `${path}.events.${eventName}`))
  }
  return { ...defaults, ...value, children: value.children as string[], props: { ...defaults.props, ...props }, propModes: propModes ?? {}, propCodes: propCodes ?? {}, locked: locked as boolean, condition, conditionFrequency: conditionFrequency as UiConditionFrequency, enterAnim: has(value, 'enterAnim') ? value.enterAnim : defaults.enterAnim, exitAnim: has(value, 'exitAnim') ? value.exitAnim : defaults.exitAnim, events: events ?? {} } as UiNode
}

export function parseUiDocument(input: unknown): UiDocumentParseResult {
  let value: unknown = input
  if (typeof input === 'string') {
    try { value = JSON.parse(input) as unknown } catch (error) { return { ok: false, document: null, issues: [issue(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)] } }
  }
  if (!isObject(value)) return { ok: false, document: null, issues: [issue('A .mzui document must be a JSON object')] }
  const issues: UiValidationIssue[] = []
  try {
    value = migrateUiDesignerDocument(value)
  } catch (error) {
    return { ok: false, document: null, issues: [issue(error instanceof Error ? error.message : String(error), 'unsupported-version', 'sceneScript')] }
  }
  if (!isObject(value)) return { ok: false, document: null, issues: [issue('A .mzui document must be a JSON object')] }
  checkExactVersion(value.version, UI_DESIGNER_DOCUMENT_VERSION, 'Document version', 'version', issues)
  checkExactVersion(value.editorVersion, UI_DESIGNER_EDITOR_VERSION, 'Editor version', 'editorVersion', issues)
  const meta = isObject(value.meta) ? value.meta : undefined
  const transitions = isObject(value.transitions) ? value.transitions : undefined
  const globalFilter = isObject(value.globalFilter) ? value.globalFilter : undefined
  const canvas = isObject(value.canvas) ? value.canvas : undefined
  const sceneScript = isObject(value.sceneScript) ? value.sceneScript : undefined
  if (!meta) issues.push(issue('meta must be an object', 'invalid-document-shape', 'meta'))
  if (!transitions) issues.push(issue('transitions must be an object', 'invalid-document-shape', 'transitions'))
  if (!globalFilter) issues.push(issue('globalFilter must be an object', 'invalid-document-shape', 'globalFilter'))
  if (!sceneScript) issues.push(issue('sceneScript must be an object', 'invalid-document-shape', 'sceneScript'))
  if (!Array.isArray(value.nodes)) issues.push(issue('nodes must be an array', 'invalid-document-shape', 'nodes'))
  if (!Array.isArray(value.zOrder) || value.zOrder.some((id) => typeof id !== 'string')) issues.push(issue('zOrder must be an array of strings', 'invalid-document-shape', 'zOrder'))
  if (!Array.isArray(value.guides)) issues.push(issue('guides must be an array', 'invalid-document-shape', 'guides'))
  if (meta) {
    for (const key of ['sceneName', 'sceneBase', 'author', 'description', 'created', 'modified']) if (typeof meta[key] !== 'string') issues.push(issue(`meta.${key} must be a string`, 'invalid-document-shape', `meta.${key}`))
    for (const key of ['canvasWidth', 'canvasHeight']) if (!isFiniteNumber(meta[key]) || Number(meta[key]) <= 0) issues.push(issue(`meta.${key} must be a positive number`, 'invalid-value', `meta.${key}`))
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((node, index) => normalizeNode(node, index, issues)).filter((node): node is UiNode => Boolean(node)) : []
  const guides = Array.isArray(value.guides) ? value.guides.map((guide, index) => {
    if (!isObject(guide) || !['vertical', 'horizontal'].includes(String(guide.type)) || !isFiniteNumber(guide.position)) {
      issues.push(issue(`Guide ${index} has an invalid shape`, 'invalid-document-shape', `guides.${index}`))
      return guide
    }
    if (has(guide, 'id') && typeof guide.id !== 'string') issues.push(issue(`Guide ${index} id must be a string`, 'invalid-document-shape', `guides.${index}.id`))
    if (has(guide, 'locked') && typeof guide.locked !== 'boolean') issues.push(issue(`Guide ${index} locked must be boolean`, 'invalid-document-shape', `guides.${index}.locked`))
    return { ...guide, id: typeof guide.id === 'string' && guide.id.trim() ? guide.id : `guide_${String(index + 1).padStart(3, '0')}`, locked: typeof guide.locked === 'boolean' ? guide.locked : false }
  }) : []
  if (sceneScript && sceneScript.version !== UI_DESIGNER_SCENE_SCRIPT_VERSION) issues.push(issue(`sceneScript.version must be ${UI_DESIGNER_SCENE_SCRIPT_VERSION}`, 'unsupported-version', 'sceneScript.version'))
  if (sceneScript && typeof sceneScript.source !== 'string') issues.push(issue('sceneScript.source must be a string', 'invalid-document-shape', 'sceneScript.source'))
  if (issues.length) return { ok: false, document: null, issues }
  const metaValue = meta as Record<string, unknown>
  const base = createUiDocument(String(metaValue.sceneName))
  const normalizedMeta: UiDesignerDocument['meta'] = {
    ...copyExtensions(metaValue, ['sceneName', 'sceneBase', 'canvasWidth', 'canvasHeight', 'author', 'description', 'created', 'modified'], 'meta', issues),
    sceneName: metaValue.sceneName as string,
    sceneBase: metaValue.sceneBase as string,
    canvasWidth: metaValue.canvasWidth as number,
    canvasHeight: metaValue.canvasHeight as number,
    author: metaValue.author as string,
    description: metaValue.description as string,
    created: metaValue.created as string,
    modified: metaValue.modified as string,
  }
  const normalizedCanvas = normalizeCanvas(canvas, base.canvas, issues)
  if (canvas && isFiniteNumber(canvas.width) && isFiniteNumber(canvas.height) && (canvas.width !== normalizedMeta.canvasWidth || canvas.height !== normalizedMeta.canvasHeight)) {
    issues.push(issue('canvas dimensions must match meta canvas dimensions', 'invalid-value', 'canvas'))
  }
  const normalizedTransitions = normalizeTransitions(transitions, base.transitions, issues)
  const normalizedGlobalFilter = normalizeGlobalFilter(globalFilter, base.globalFilter, issues)
  const normalizedSceneScript = {
    version: UI_DESIGNER_SCENE_SCRIPT_VERSION,
    source: typeof sceneScript?.source === 'string' ? sceneScript.source : base.sceneScript.source,
  }
  if (issues.length) return { ok: false, document: null, issues }
  const normalized: UiDesignerDocument = {
    ...copyExtensions(value, ['version', 'editorVersion', 'meta', 'transitions', 'globalFilter', 'canvas', 'guides', 'nodes', 'zOrder', 'sceneScript'], '', issues),
    version: UI_DESIGNER_DOCUMENT_VERSION,
    editorVersion: UI_DESIGNER_EDITOR_VERSION,
    meta: normalizedMeta,
    transitions: normalizedTransitions,
    globalFilter: normalizedGlobalFilter,
    canvas: normalizedCanvas,
    guides: guides as UiDesignerDocument['guides'],
    nodes,
    zOrder: value.zOrder as string[],
    sceneScript: normalizedSceneScript,
  }
  const normalizedDocument = normalizeDocumentGeometry(setCanvasDimensions(normalized, normalizedMeta.canvasWidth, normalizedMeta.canvasHeight))
  if (issues.length) return { ok: false, document: null, issues }
  const treeIssues = validateTreeInvariants(normalizedDocument)
  if (treeIssues.some((treeIssue) => treeIssue.severity === 'error')) return { ok: false, document: null, issues: treeIssues }
  return { ok: true, document: normalizedDocument, issues: [] }
}
