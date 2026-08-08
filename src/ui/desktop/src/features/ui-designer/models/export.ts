import {
  UI_DESIGNER_RUNTIME_VERSION,
  type UiDesignerDocument,
  type UiNode,
  type UiRuntimeSceneExport,
  type UiRuntimeSceneMeta,
  type UiDesignerExportOptions,
} from '@contract/ui-designer'
import { cloneUiDocument, createUiDocument } from './document'
import { parseUiDocument } from './parser'
import { validateDocument } from './validation'

export class UiExportValidationError extends Error {
  readonly issues: ReturnType<typeof validateDocument>['errors']

  constructor(issues: ReturnType<typeof validateDocument>['errors']) {
    super(`Cannot export UI scene: ${issues.length} validation error(s)`)
    this.issues = issues
    this.name = 'UiExportValidationError'
  }
}

function stripEditorNode(node: UiNode): UiNode {
  const copy = JSON.parse(JSON.stringify(node)) as UiNode
  delete (copy as Partial<UiNode>).locked
  if (copy.type === 'nineSlice') delete (copy.props as Partial<typeof copy.props>).showGuides
  return copy
}

export function exportRuntimeDocument(document: UiDesignerDocument, runtimeVersion = UI_DESIGNER_RUNTIME_VERSION, options: UiDesignerExportOptions = {}): UiRuntimeSceneExport {
  if (!/^>=\d+\.\d+\.\d+$/.test(runtimeVersion)) {
    throw new UiExportValidationError([{ severity: 'error', code: 'invalid-runtime-version', message: `Runtime version must be a minimum range such as >=1.0.0`, path: 'runtimeVersion' }])
  }
  const parsed = parseUiDocument(document)
  if (!parsed.ok) throw new UiExportValidationError(parsed.issues)
  const source = cloneUiDocument(parsed.document)
  const report = validateDocument(source)
  if (!report.valid) throw new UiExportValidationError(report.errors)
  const meta: UiRuntimeSceneMeta = {
    sceneName: source.meta.sceneName,
    sceneBase: source.meta.sceneBase,
    canvasWidth: source.meta.canvasWidth,
    canvasHeight: source.meta.canvasHeight,
    author: options.author ?? source.meta.author,
    description: options.description ?? source.meta.description,
  }
  return {
    version: source.version,
    runtimeVersion,
    meta,
    transitions: source.transitions,
    globalFilter: source.globalFilter,
    nodes: source.nodes.map(stripEditorNode),
    zOrder: [...source.zOrder],
    code: { ...source.code },
  }
}

/**
 * Convert a validated Runtime JSON scene into an explicitly lossy editor
 * document.  Runtime JSON has no editor chrome; defaults are added here and
 * the caller must mark the resulting tab dirty before it can be saved.
 */
export function importRuntimeSceneDocument(runtime: UiRuntimeSceneExport): UiDesignerDocument {
  const base = createUiDocument(runtime.meta.sceneName)
  const width = Number.isFinite(runtime.meta.canvasWidth) && runtime.meta.canvasWidth > 0 ? runtime.meta.canvasWidth : base.canvas.width
  const height = Number.isFinite(runtime.meta.canvasHeight) && runtime.meta.canvasHeight > 0 ? runtime.meta.canvasHeight : base.canvas.height
  const nodes = runtime.nodes.map((node) => ({
    ...node,
    locked: node.locked ?? false,
    children: Array.isArray(node.children) ? [...node.children] : [],
    propModes: node.propModes ?? {},
    propCodes: node.propCodes ?? {},
    condition: node.condition ?? { type: 'none' as const },
    conditionFrequency: node.conditionFrequency ?? 'per-frame' as const,
    enterAnim: node.enterAnim ?? { type: 'none' as const, duration: 300, easing: 'EaseOut' as const },
    exitAnim: node.exitAnim ?? { type: 'none' as const, duration: 300, easing: 'EaseOut' as const },
    events: node.events ?? {},
  }))
  const document: UiDesignerDocument = {
    ...base,
    meta: {
      ...base.meta,
      sceneName: runtime.meta.sceneName,
      sceneBase: runtime.meta.sceneBase,
      canvasWidth: width,
      canvasHeight: height,
      author: runtime.meta.author,
      description: runtime.meta.description,
    },
    transitions: runtime.transitions,
    globalFilter: runtime.globalFilter,
    canvas: { ...base.canvas, width, height },
    nodes,
    zOrder: [...runtime.zOrder],
    code: { ...runtime.code },
  }
  const root = document.nodes.find((node) => node.id === 'node_root')
  if (root && root.type === 'container') { root.props.width = width; root.props.height = height }
  return document
}

export function serializeDocument(document: UiDesignerDocument): string {
  return JSON.stringify(document)
}

export function prettySerializeDocument(document: UiDesignerDocument): string {
  return JSON.stringify(document, null, 2)
}
