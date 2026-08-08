import type { UiDesignerDocument, UiNode, UiValidationIssue, UiValidationReport, UiVisibilityCondition, UiEventAction } from '@contract/ui-designer'
import { parseUiDocument } from './parser'
import { validateTreeInvariants } from './tree'

function codeSyntaxIssue(code: string, label: string, kind: 'expression' | 'body' = 'body'): string | null {
  if (!code.trim()) return null
  try {
    // Compilation only; the designer never executes user code.
    // eslint-disable-next-line no-new-func
    Function(kind === 'expression' ? `return (${code})` : code)
    return null
  } catch (error) {
    return `${label}: ${error instanceof Error ? error.message : String(error)}`
  }
}

function conditionCodeIssues(condition: UiVisibilityCondition, node: UiNode, path = 'condition'): UiValidationIssue[] {
  const issues: UiValidationIssue[] = []
  if ((condition.type === 'switch_on' || condition.type === 'switch_off') && (!Number.isInteger(condition.switchId) || condition.switchId < 0)) issues.push({ severity: 'error', code: 'invalid-value', message: 'Switch ID must be a non-negative integer', nodeId: node.id, nodeName: node.name, path: `${path}.switchId` })
  if (condition.type === 'variable') {
    if (!Number.isInteger(condition.variableId) || condition.variableId < 0) issues.push({ severity: 'error', code: 'invalid-value', message: 'Variable ID must be a non-negative integer', nodeId: node.id, nodeName: node.name, path: `${path}.variableId` })
    if (!Number.isFinite(condition.value)) issues.push({ severity: 'error', code: 'invalid-value', message: 'Variable comparison value must be finite', nodeId: node.id, nodeName: node.name, path: `${path}.value` })
  }
  if (condition.type === 'code') {
    const message = codeSyntaxIssue(condition.code, `Condition on ${node.name}`, 'expression')
    if (message) issues.push({ severity: 'error', code: 'invalid-code', message, nodeId: node.id, nodeName: node.name, path })
  }
  if (condition.type === 'and' || condition.type === 'or') {
    condition.children.forEach((child, index) => issues.push(...conditionCodeIssues(child, node, `${path}.children.${index}`)))
  }
  return issues
}

function numericIssue(value: unknown, label: string, node: UiNode, path: string, minimum = 0): UiValidationIssue | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) return { severity: 'error', code: 'invalid-value', message: `${label} must be a finite number >= ${minimum}`, nodeId: node.id, nodeName: node.name, path }
  return null
}

function finiteIssue(value: unknown, label: string, node: UiNode, path: string): UiValidationIssue | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { severity: 'error', code: 'invalid-value', message: `${label} must be a finite number`, nodeId: node.id, nodeName: node.name, path }
  return null
}

function actionIssues(action: UiEventAction, node: UiNode, document: UiDesignerDocument, path: string): UiValidationIssue[] {
  const issues: UiValidationIssue[] = []
  const addNumber = (value: unknown, label: string, minimum = 0) => {
    const issueValue = numericIssue(value, label, node, path, minimum)
    if (issueValue) issues.push(issueValue)
  }
  const addFinite = (value: unknown, label: string) => {
    const issueValue = finiteIssue(value, label, node, path)
    if (issueValue) issues.push(issueValue)
  }
  if (action.type === 'toggleNode' || action.type === 'tweenProp') {
    const targetId = action.type === 'toggleNode' ? action.targetNodeId : action.tweenNodeId
    if (!document.nodes.some((candidate) => candidate.id === targetId)) issues.push({ severity: 'error', code: 'invalid-reference', message: `Action references missing node ${targetId}`, nodeId: node.id, nodeName: node.name, path })
  }
  if (action.type === 'gotoScene' && !/^Scene_[A-Za-z0-9_$]+$/.test(action.sceneName)) issues.push({ severity: 'error', code: 'invalid-value', message: 'Scene action must reference a valid Scene_ name', nodeId: node.id, nodeName: node.name, path })
  if (action.type === 'setSwitch') addNumber(action.switchId, 'Switch ID')
  if (action.type === 'setVariable') { addNumber(action.variableId, 'Variable ID'); addFinite(action.variableVal, 'Variable value') }
  if (action.type === 'tweenProp') { addFinite(action.tweenTarget, 'Tween target'); addNumber(action.tweenDuration, 'Tween duration'); }
  if (action.type === 'wait') addNumber(action.waitFrames, 'Wait frames')
  if (action.type === 'script') {
    const message = codeSyntaxIssue(action.code, `${path} script on ${node.name}`)
    if (message) issues.push({ severity: 'error', code: 'invalid-code', message, nodeId: node.id, nodeName: node.name, path })
  }
  if (action.condition?.type === 'code') {
    const message = codeSyntaxIssue(action.condition.code ?? '', `${path} condition on ${node.name}`, 'expression')
    if (message) issues.push({ severity: 'error', code: 'invalid-code', message, nodeId: node.id, nodeName: node.name, path: `${path}.condition` })
  }
  return issues
}

function validateNode(node: UiNode, document: UiDesignerDocument): UiValidationIssue[] {
  const issues: UiValidationIssue[] = []
  const baseRanges: Array<[keyof UiNode['props'], number]> = [['width', 0], ['height', 0], ['scaleX', 0], ['scaleY', 0], ['opacity', 0], ['anchorX', 0], ['anchorY', 0]]
  for (const [property, minimum] of baseRanges) {
    const value = node.props[property]
    const valueIssue = numericIssue(value, property, node, `props.${String(property)}`, minimum)
    if (valueIssue) issues.push(valueIssue)
  }
  if (node.props.opacity > 255) issues.push({ severity: 'error', code: 'invalid-value', message: 'opacity must be <= 255', nodeId: node.id, nodeName: node.name, path: 'props.opacity' })
  if (node.props.anchorX > 1 || node.props.anchorY > 1) issues.push({ severity: 'error', code: 'invalid-value', message: 'anchor values must be <= 1', nodeId: node.id, nodeName: node.name, path: 'props.anchor' })
  if (!node.name.trim()) issues.push({ severity: 'warning', code: 'unnamed-node', message: 'Node has no name', nodeId: node.id, nodeName: node.name })
  if (/^(container|sprite|nineSlice|frameAnimation|button|text|progressBar|overlay|video|particle)_\d+$/i.test(node.name)) {
    issues.push({ severity: 'warning', code: 'unnamed-node', message: `Node ${node.name} still uses a generated name`, nodeId: node.id, nodeName: node.name })
  }
  for (const [property, mode] of Object.entries(node.propModes)) {
    if (mode === 'code' && !(node.propCodes[property] ?? '').trim()) {
      issues.push({ severity: 'warning', code: 'empty-code', message: `Code mode property ${property} has no expression`, nodeId: node.id, nodeName: node.name, path: `propCodes.${property}` })
    }
  }
  for (const [property, code] of Object.entries(node.propCodes)) {
    const message = codeSyntaxIssue(code, `${property} expression on ${node.name}`, 'expression')
    if (message) issues.push({ severity: 'error', code: 'invalid-code', message, nodeId: node.id, nodeName: node.name, path: `propCodes.${property}` })
  }
  issues.push(...conditionCodeIssues(node.condition, node))
  for (const [eventName, event] of Object.entries(node.events)) {
    for (const [index, action] of (event?.actions ?? []).entries()) issues.push(...actionIssues(action, node, document, `events.${eventName}.${index}`))
  }
  if ((node.type === 'sprite' || node.type === 'nineSlice' || node.type === 'video') && 'path' in node.props && node.props.path === '') {
    issues.push({ severity: 'warning', code: 'missing-resource', message: `Node ${node.name} has no resource path`, nodeId: node.id, nodeName: node.name, path: 'props.path' })
  }
  if (node.type === 'frameAnimation' && node.props.frames.length === 0) {
    issues.push({ severity: 'warning', code: 'empty-frame-list', message: `Frame animation ${node.name} has no frames`, nodeId: node.id, nodeName: node.name, path: 'props.frames' })
  }
  const frameIds = new Set<string>()
  if (node.type === 'frameAnimation') {
    for (const [index, frame] of node.props.frames.entries()) {
      if (frameIds.has(frame.id)) issues.push({ severity: 'error', code: 'duplicate-frame-id', message: `Frame id ${frame.id} is duplicated`, nodeId: node.id, nodeName: node.name, path: `props.frames.${index}.id` })
      frameIds.add(frame.id)
      const durationIssue = numericIssue(frame.duration, 'Frame duration', node, `props.frames.${index}.duration`)
      if (durationIssue) issues.push(durationIssue)
    }
  }
  if (node.type === 'particle' && node.props.maxParticles > 200) {
    issues.push({ severity: 'warning', code: 'particle-performance', message: `Particle node ${node.name} exceeds 200 particles`, nodeId: node.id, nodeName: node.name, path: 'props.maxParticles' })
  }
  return issues
}

export function validateDocument(input: unknown): UiValidationReport {
  const parsed = parseUiDocument(input)
  if (!parsed.ok) {
    return { valid: false, issues: parsed.issues, errors: parsed.issues, warnings: [] }
  }
  const document = parsed.document
  const issues: UiValidationIssue[] = []
  const sceneName = document.meta.sceneName.trim()
  if (!sceneName) issues.push({ severity: 'error', code: 'scene-name-empty', message: 'Scene name is required', path: 'meta.sceneName' })
  else if (!/^Scene_[A-Za-z0-9_$]+$/.test(sceneName)) issues.push({ severity: 'error', code: 'scene-name-invalid', message: 'Scene name must start with Scene_ and contain only letters, numbers, underscores, or dollar signs', path: 'meta.sceneName' })
  issues.push(...validateTreeInvariants(document))
  for (const node of document.nodes) issues.push(...validateNode(node, document))
  const guideIds = new Set<string>()
  for (const [index, guide] of document.guides.entries()) {
    if (guideIds.has(guide.id)) issues.push({ severity: 'error', code: 'duplicate-guide-id', message: `Guide id ${guide.id} is duplicated`, path: `guides.${index}.id` })
    guideIds.add(guide.id)
    if (typeof guide.position !== 'number' || !Number.isFinite(guide.position)) issues.push({ severity: 'error', code: 'invalid-value', message: 'Guide position must be finite', path: `guides.${index}.position` })
  }
  for (const [name, code] of Object.entries(document.code)) {
    const message = codeSyntaxIssue(code, `${name} code`)
    if (message) issues.push({ severity: 'error', code: 'invalid-code', message, path: `code.${name}` })
  }
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return { valid: errors.length === 0, issues, errors, warnings }
}
