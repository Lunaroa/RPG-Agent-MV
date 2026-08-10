import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_RUNTIME_VERSION,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiRuntimeDiagnostic,
  type UiRuntimeSceneExport,
} from './ui-designer.ts'
import {
  assertUiDesignerDocumentResourcePaths,
  isUiDesignerProjectRelativeResourcePath,
} from './ui-designer-resources.ts'

export const UI_DESIGNER_RENDERER_BRIDGE_VERSION = '1.1.0' as const
export const UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES = 4 * 1024 * 1024
export const UI_DESIGNER_RENDERER_BRIDGE_MAX_BOUNDS = 2_048
export const UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES = 512

export type UiDesignerRendererBridgeKind =
  | 'hello'
  | 'ready'
  | 'mount'
  | 'mounted'
  | 'patch'
  | 'bounds'
  | 'select'
  | 'input'
  | 'diagnostic'
  | 'exit-request'
  | 'dispose'
  | 'disposed'

export type UiDesignerRendererExecutionMode = 'authoring' | 'full-preview'

export interface UiDesignerRendererBridgeEnvelope<TKind extends UiDesignerRendererBridgeKind = UiDesignerRendererBridgeKind, TPayload = unknown> {
  version: typeof UI_DESIGNER_RENDERER_BRIDGE_VERSION
  sessionId: string
  generation: number
  sequence: number
  sceneId: string
  kind: TKind
  payload: TPayload
}

export interface UiDesignerRendererBridgeCapabilities {
  engine: 'MV' | 'MZ'
  engineVersion: string | null
  pixiVersion: string
  runtimeVersion: string
}

export interface UiDesignerRendererNodeBounds {
  nodeId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  visible: boolean
  interactive: boolean
}

export interface UiDesignerRendererNodePatch {
  nodeId: string
  props: Record<string, UiDesignerRendererJsonValue>
}

export type UiDesignerRendererJsonValue = null | boolean | number | string | UiDesignerRendererJsonValue[] | { [key: string]: UiDesignerRendererJsonValue }

export type UiDesignerRendererBridgeMessage =
  | UiDesignerRendererBridgeEnvelope<'hello', UiDesignerRendererBridgeCapabilities>
  | UiDesignerRendererBridgeEnvelope<'ready', { canvasWidth: number; canvasHeight: number }>
  | UiDesignerRendererBridgeEnvelope<'mount', { revision: number; executionMode: UiDesignerRendererExecutionMode; scene: UiRuntimeSceneExport }>
  | UiDesignerRendererBridgeEnvelope<'mounted', { revision: number; executionMode: UiDesignerRendererExecutionMode; bounds: UiDesignerRendererNodeBounds[] }>
  | UiDesignerRendererBridgeEnvelope<'patch', { revision: number; nodes: UiDesignerRendererNodePatch[] }>
  | UiDesignerRendererBridgeEnvelope<'bounds', { revision: number; bounds: UiDesignerRendererNodeBounds[] }>
  | UiDesignerRendererBridgeEnvelope<'select', { nodeIds: string[] }>
  | UiDesignerRendererBridgeEnvelope<'input', {
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'contextmenu'
    nodeId: string | null
    x: number
    y: number
    button: number
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    metaKey: boolean
  }>
  | UiDesignerRendererBridgeEnvelope<'diagnostic', { entries: UiRuntimeDiagnostic[] }>
  | UiDesignerRendererBridgeEnvelope<'exit-request', { key: 'Escape' | 'F6' }>
  | UiDesignerRendererBridgeEnvelope<'dispose', { reason: 'scene-change' | 'project-change' | 'unload' | 'shutdown' }>
  | UiDesignerRendererBridgeEnvelope<'disposed', Record<string, never>>

export interface UiDesignerRendererBridgeExpectation {
  sessionId: string
  generation: number
  minimumSequence: number
  sceneId?: string
}

export class UiDesignerRendererBridgeProtocolError extends Error {
  readonly code = 'UI_DESIGNER_RENDERER_BRIDGE_PROTOCOL'

  constructor(message: string) {
    super(message)
    this.name = 'UiDesignerRendererBridgeProtocolError'
  }
}

export function validateUiDesignerRendererBridgeMessage(
  value: unknown,
  expectation?: UiDesignerRendererBridgeExpectation,
): UiDesignerRendererBridgeMessage {
  assertRecord(value, 'Bridge message must be an object.')
  assertExactKeys(value, ['version', 'sessionId', 'generation', 'sequence', 'sceneId', 'kind', 'payload'], 'bridge message')
  if (value.version !== UI_DESIGNER_RENDERER_BRIDGE_VERSION) fail(`Unsupported renderer bridge version: ${String(value.version)}.`)
  const sessionId = identifier(value.sessionId, 'sessionId', 8, 128)
  const generation = nonNegativeInteger(value.generation, 'generation')
  const sequence = nonNegativeInteger(value.sequence, 'sequence')
  const sceneId = sceneIdentifier(value.sceneId)
  const kind = bridgeKind(value.kind)
  const encodedBytes = encodedSize(value)
  if (encodedBytes > UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES) fail(`Renderer bridge message exceeds ${UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES} bytes.`)
  if (expectation) {
    if (sessionId !== expectation.sessionId) fail('Renderer bridge session is stale or does not match the active session.')
    if (generation !== expectation.generation) fail('Renderer bridge project generation is stale.')
    if (sequence < expectation.minimumSequence) fail('Renderer bridge message sequence is stale.')
    if (expectation.sceneId && sceneId !== expectation.sceneId) fail('Renderer bridge scene does not match the active scene.')
  }
  validatePayload(kind, value.payload, sessionId, sceneId)
  return value as unknown as UiDesignerRendererBridgeMessage
}

function validatePayload(kind: UiDesignerRendererBridgeKind, payload: unknown, sessionId: string, sceneId: string): void {
  assertRecord(payload, `Renderer bridge ${kind} payload must be an object.`)
  if (kind === 'hello') {
    assertExactKeys(payload, ['engine', 'engineVersion', 'pixiVersion', 'runtimeVersion'], kind)
    if (payload.engine !== 'MV' && payload.engine !== 'MZ') fail('Renderer bridge engine must be MV or MZ.')
    if (payload.engineVersion !== null) boundedString(payload.engineVersion, 'engineVersion', 64)
    boundedString(payload.pixiVersion, 'pixiVersion', 64)
    boundedString(payload.runtimeVersion, 'runtimeVersion', 64)
    return
  }
  if (kind === 'ready') {
    assertExactKeys(payload, ['canvasWidth', 'canvasHeight'], kind)
    positiveInteger(payload.canvasWidth, 'canvasWidth')
    positiveInteger(payload.canvasHeight, 'canvasHeight')
    return
  }
  if (kind === 'mount') {
    assertExactKeys(payload, ['revision', 'executionMode', 'scene'], kind)
    nonNegativeInteger(payload.revision, 'revision')
    executionMode(payload.executionMode)
    validateRuntimeScene(payload.scene)
    return
  }
  if (kind === 'mounted' || kind === 'bounds') {
    assertExactKeys(payload, kind === 'mounted' ? ['revision', 'executionMode', 'bounds'] : ['revision', 'bounds'], kind)
    nonNegativeInteger(payload.revision, 'revision')
    if (kind === 'mounted') executionMode(payload.executionMode)
    validateBounds(payload.bounds)
    return
  }
  if (kind === 'patch') {
    assertExactKeys(payload, ['revision', 'nodes'], kind)
    nonNegativeInteger(payload.revision, 'revision')
    if (!Array.isArray(payload.nodes) || payload.nodes.length > UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES) fail('Renderer bridge patch list is invalid or exceeds its bound.')
    for (const patch of payload.nodes) {
      assertRecord(patch, 'Renderer node patch must be an object.')
      assertExactKeys(patch, ['nodeId', 'props'], 'node patch')
      identifier(patch.nodeId, 'nodeId', 1, 128)
      assertRecord(patch.props, 'Renderer node patch props must be an object.')
      assertJsonValue(patch.props, 0)
      assertUiDesignerDocumentResourcePaths(patch.props)
    }
    return
  }
  if (kind === 'select') {
    assertExactKeys(payload, ['nodeIds'], kind)
    if (!Array.isArray(payload.nodeIds) || payload.nodeIds.length > UI_DESIGNER_RENDERER_BRIDGE_MAX_BOUNDS) fail('Renderer selection is invalid or exceeds its bound.')
    payload.nodeIds.forEach((nodeId) => identifier(nodeId, 'nodeId', 1, 128))
    return
  }
  if (kind === 'input') {
    assertExactKeys(payload, ['type', 'nodeId', 'x', 'y', 'button', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'], kind)
    if (!['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu'].includes(String(payload.type))) fail('Renderer input type is unsupported.')
    if (payload.nodeId !== null) identifier(payload.nodeId, 'nodeId', 1, 128)
    finiteCoordinate(payload.x, 'x')
    finiteCoordinate(payload.y, 'y')
    if (!Number.isInteger(payload.button) || Number(payload.button) < -1 || Number(payload.button) > 5) fail('Renderer input button is invalid.')
    for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) if (typeof payload[key] !== 'boolean') fail(`Renderer input ${key} must be boolean.`)
    return
  }
  if (kind === 'diagnostic') {
    assertExactKeys(payload, ['entries'], kind)
    if (!Array.isArray(payload.entries) || payload.entries.length > 64) fail('Renderer diagnostics are invalid or exceed their bound.')
    payload.entries.forEach((entry) => validateDiagnostic(entry, sessionId, sceneId))
    return
  }
  if (kind === 'exit-request') {
    assertExactKeys(payload, ['key'], kind)
    if (payload.key !== 'Escape' && payload.key !== 'F6') fail('Renderer exit request key is unsupported.')
    return
  }
  if (kind === 'dispose') {
    assertExactKeys(payload, ['reason'], kind)
    if (!['scene-change', 'project-change', 'unload', 'shutdown'].includes(String(payload.reason))) fail('Renderer dispose reason is unsupported.')
    return
  }
  assertExactKeys(payload, [], kind)
}

function validateRuntimeScene(value: unknown): void {
  assertRecord(value, 'Renderer mount scene must be a Runtime scene object.')
  if (value.version !== UI_DESIGNER_DOCUMENT_VERSION || value.runtimeVersion !== UI_DESIGNER_RUNTIME_VERSION) fail('Renderer mount scene version is unsupported.')
  assertRecord(value.meta, 'Renderer mount scene meta is required.')
  sceneIdentifier(value.meta.sceneName)
  assertRecord(value.sceneScript, 'Renderer mount sceneScript is required.')
  if (value.sceneScript.version !== UI_DESIGNER_SCENE_SCRIPT_VERSION || typeof value.sceneScript.source !== 'string') fail('Renderer mount sceneScript is unsupported.')
  if (!Array.isArray(value.nodes) || !Array.isArray(value.zOrder)) fail('Renderer mount scene nodes and zOrder must be arrays.')
  assertJsonValue(value, 0)
  assertUiDesignerDocumentResourcePaths(value)
}

function validateDiagnostic(value: unknown, sessionId: string, sceneId: string): void {
  assertRecord(value, 'Renderer diagnostic must be an object.')
  assertExactKeys(value, ['schemaVersion', 'sessionId', 'scene', 'file', 'node', 'type', 'phase', 'event', 'code', 'severity', 'label', 'message', 'count'], 'diagnostic')
  if (value.schemaVersion !== '1.0.0' || value.sessionId !== sessionId) fail('Renderer diagnostic schema or session is invalid.')
  if (value.scene !== null && value.scene !== sceneId) fail('Renderer diagnostic scene is invalid.')
  if (value.file !== null) {
    const file = boundedString(value.file, 'diagnostic file', 512)
    if (!isUiDesignerProjectRelativeResourcePath(file)) fail('Renderer diagnostic file must be project-relative.')
  }
  for (const key of ['node', 'type', 'phase', 'event']) if (value[key] !== null) boundedString(value[key], `diagnostic ${key}`, 256)
  boundedString(value.code, 'diagnostic code', 128)
  if (value.severity !== 'error' && value.severity !== 'warning') fail('Renderer diagnostic severity is invalid.')
  boundedString(value.label, 'diagnostic label', 256)
  boundedString(value.message, 'diagnostic message', 1_024)
  nonNegativeInteger(value.count, 'diagnostic count')
}

function validateBounds(value: unknown): void {
  if (!Array.isArray(value) || value.length > UI_DESIGNER_RENDERER_BRIDGE_MAX_BOUNDS) fail('Renderer bounds are invalid or exceed their bound.')
  for (const bounds of value) {
    assertRecord(bounds, 'Renderer node bounds must be an object.')
    assertExactKeys(bounds, ['nodeId', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'interactive'], 'node bounds')
    identifier(bounds.nodeId, 'nodeId', 1, 128)
    finiteCoordinate(bounds.x, 'x')
    finiteCoordinate(bounds.y, 'y')
    finiteCoordinate(bounds.width, 'width')
    finiteCoordinate(bounds.height, 'height')
    finiteCoordinate(bounds.rotation, 'rotation')
    if (typeof bounds.visible !== 'boolean' || typeof bounds.interactive !== 'boolean') fail('Renderer node bound flags must be boolean.')
  }
}

function assertJsonValue(value: unknown, depth: number): void {
  if (depth > 16) fail('Renderer bridge JSON nesting exceeds its bound.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Renderer patch numbers must be finite.')
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 2_048) fail('Renderer patch array exceeds its bound.')
    value.forEach((entry) => assertJsonValue(entry, depth + 1))
    return
  }
  assertRecord(value, 'Renderer patch values must be JSON-safe.')
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('Renderer patch key is unsafe.')
    assertJsonValue(entry, depth + 1)
  }
}


function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(message)
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`Unexpected ${label} field: ${key}.`)
  for (const key of keys) if (!(key in value)) fail(`Missing ${label} field: ${key}.`)
}

function bridgeKind(value: unknown): UiDesignerRendererBridgeKind {
  const kinds: UiDesignerRendererBridgeKind[] = ['hello', 'ready', 'mount', 'mounted', 'patch', 'bounds', 'select', 'input', 'diagnostic', 'exit-request', 'dispose', 'disposed']
  if (!kinds.includes(value as UiDesignerRendererBridgeKind)) fail(`Unsupported renderer bridge message kind: ${String(value)}.`)
  return value as UiDesignerRendererBridgeKind
}

function executionMode(value: unknown): UiDesignerRendererExecutionMode {
  if (value !== 'authoring' && value !== 'full-preview') fail('Renderer execution mode is unsupported.')
  return value
}

function identifier(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9_$-]+$/.test(value)) fail(`Renderer bridge ${label} is invalid.`)
  return value
}

function sceneIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^Scene_[A-Za-z0-9_$]+$/.test(value) || value.length > 128) fail('Renderer bridge sceneId is invalid.')
  return value
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(`Renderer bridge ${label} is invalid.`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`Renderer bridge ${label} must be a non-negative safe integer.`)
  return Number(value)
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonNegativeInteger(value, label)
  if (result < 1 || result > 16_384) fail(`Renderer bridge ${label} is outside the supported range.`)
  return result
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) fail(`Renderer bridge ${label} is not a bounded finite number.`)
  return value
}

function encodedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    fail('Renderer bridge message must be serializable JSON.')
  }
}

function fail(message: string): never {
  throw new UiDesignerRendererBridgeProtocolError(message)
}
