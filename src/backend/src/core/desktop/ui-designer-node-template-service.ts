import fs from 'node:fs'
import path from 'node:path'

import type { UiDesignerNodeType, UiNode, UiNodeGroup, UiNodeGroupRecord } from '../../../../contract/ui-designer.ts'

export const UI_DESIGNER_NODE_TEMPLATE_EXTENSION = '.mztemplate'
export const UI_DESIGNER_NODE_TEMPLATE_VERSION = '1.0.0'

const NODE_TYPES = new Set<UiDesignerNodeType>([
  'container', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'overlay', 'video', 'particle',
])

export class UiDesignerNodeTemplateError extends Error {
  readonly code = 'UI_DESIGNER_NODE_TEMPLATE_ERROR'
  readonly recoverable = true
  readonly operation: string

  constructor(operation: string, message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined)
    this.name = 'UiDesignerNodeTemplateError'
    this.operation = operation
  }
}

export function parseUiDesignerNodeTemplate(body: Buffer | string): UiNodeGroup {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8').replace(/^\uFEFF/, '') : body.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new UiDesignerNodeTemplateError('parse', 'The node template is not valid JSON.', error)
  }
  return assertUiDesignerNodeTemplate(parsed)
}

export function assertUiDesignerNodeTemplate(value: unknown): UiNodeGroup {
  if (!isRecord(value) || value.format !== 'mztemplate' || value.version !== UI_DESIGNER_NODE_TEMPLATE_VERSION) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template format or version is unsupported.')
  }
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template name is invalid.')
  }
  if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template roots are invalid.')
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template must contain at least one node.')
  }
  const nodes = value.nodes as unknown[]
  const ids = new Set<string>()
  for (const candidate of nodes) {
    if (!isNode(candidate) || ids.has(candidate.id)) throw new UiDesignerNodeTemplateError('validate', 'The node template contains a duplicate or invalid node.')
    ids.add(candidate.id)
  }
  const roots = value.roots as string[]
  if (new Set(roots).size !== roots.length || roots.some((id) => !ids.has(id))) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template root references are invalid.')
  }
  for (const node of nodes as UiNode[]) {
    if (node.parentId !== null && !ids.has(node.parentId)) throw new UiDesignerNodeTemplateError('validate', `Node ${node.id} references a missing parent.`)
    if (new Set(node.children).size !== node.children.length || node.children.some((id) => !ids.has(id))) {
      throw new UiDesignerNodeTemplateError('validate', `Node ${node.id} has invalid child references.`)
    }
    for (const childId of node.children) {
      const child = nodes.find((item) => (item as UiNode).id === childId) as UiNode
      if (child.parentId !== node.id) throw new UiDesignerNodeTemplateError('validate', `Node ${childId} does not point back to parent ${node.id}.`)
    }
  }
  if (roots.some((id) => (nodes.find((item) => (item as UiNode).id === id) as UiNode).parentId !== null)) {
    throw new UiDesignerNodeTemplateError('validate', 'Node template roots must not have parents.')
  }
  if (!isRecord(value.origin) || !['x', 'y', 'width', 'height'].every((key) => typeof value.origin[key] === 'number' && Number.isFinite(value.origin[key]))) {
    throw new UiDesignerNodeTemplateError('validate', 'The node template origin is invalid.')
  }
  return {
    format: 'mztemplate',
    version: UI_DESIGNER_NODE_TEMPLATE_VERSION,
    name,
    roots: [...roots],
    nodes: nodes as UiNode[],
    origin: {
      x: Number(value.origin.x),
      y: Number(value.origin.y),
      width: Number(value.origin.width),
      height: Number(value.origin.height),
    },
  }
}

export function serializeUiDesignerNodeTemplate(group: UiNodeGroup): Buffer {
  return Buffer.from(`${JSON.stringify(assertUiDesignerNodeTemplate(group), null, 2)}\n`, 'utf8')
}

export function readUiDesignerNodeTemplate(filePath: string): UiNodeGroup {
  const resolved = assertNodeTemplateFilePath(filePath)
  try {
    return parseUiDesignerNodeTemplate(fs.readFileSync(resolved))
  } catch (error) {
    if (error instanceof UiDesignerNodeTemplateError) throw error
    throw new UiDesignerNodeTemplateError('read', 'The node template could not be read.', error)
  }
}

export function writeUiDesignerNodeTemplate(filePath: string, group: UiNodeGroup): string {
  const resolved = assertNodeTemplateFilePath(filePath)
  writeAtomically(resolved, serializeUiDesignerNodeTemplate(group))
  return resolved
}

export function nodeTemplateFilePath(root: string, name: string): string {
  const raw = String(name || '').trim()
  const rawExtension = path.extname(raw).toLowerCase()
  if (rawExtension && rawExtension !== UI_DESIGNER_NODE_TEMPLATE_EXTENSION) {
    throw new UiDesignerNodeTemplateError('path', `Node templates must use ${UI_DESIGNER_NODE_TEMPLATE_EXTENSION}.`)
  }
  const normalized = raw.replace(new RegExp(`${escapeRegExp(UI_DESIGNER_NODE_TEMPLATE_EXTENSION)}$`, 'i'), '')
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    throw new UiDesignerNodeTemplateError('path', 'The node template name is invalid.')
  }
  return assertNodeTemplateFilePath(path.join(path.resolve(root), `${normalized}${UI_DESIGNER_NODE_TEMPLATE_EXTENSION}`))
}

export function listUiDesignerNodeTemplates(root: string): UiNodeGroupRecord[] {
  const directory = path.resolve(root)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(UI_DESIGNER_NODE_TEMPLATE_EXTENSION))
    .sort()
    .flatMap((name) => {
      const filePath = path.join(directory, name)
      try {
        const stat = fs.statSync(filePath)
        const group = readUiDesignerNodeTemplate(filePath)
        return [{ name: group.name, modifiedAt: stat.mtime.toISOString() }]
      } catch (error) {
        if (error instanceof UiDesignerNodeTemplateError) throw error
        throw new UiDesignerNodeTemplateError('list', `The node template ${name} could not be listed.`, error)
      }
    })
}

export function removeUiDesignerNodeTemplate(root: string, name: string): void {
  const filePath = nodeTemplateFilePath(root, name)
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
}

function assertNodeTemplateFilePath(filePath: string): string {
  const resolved = path.resolve(filePath)
  if (path.extname(resolved).toLowerCase() !== UI_DESIGNER_NODE_TEMPLATE_EXTENSION) {
    throw new UiDesignerNodeTemplateError('path', `Node templates must use ${UI_DESIGNER_NODE_TEMPLATE_EXTENSION}.`)
  }
  return resolved
}

function isNode(value: unknown): value is UiNode {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim()) return false
  if (typeof value.type !== 'string' || !NODE_TYPES.has(value.type as UiDesignerNodeType)) return false
  if (!(value.parentId === null || typeof value.parentId === 'string')) return false
  if (!Array.isArray(value.children) || value.children.some((id) => typeof id !== 'string')) return false
  return isRecord(value.props) && isRecord(value.propModes) && isRecord(value.propCodes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function writeAtomically(filePath: string, body: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  recoverAtomicBackup(filePath)
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`
  const descriptor = fs.openSync(temporary, 'wx')
  try {
    fs.writeFileSync(descriptor, body)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    replaceFile(temporary, filePath)
  } catch (error) {
    try { fs.closeSync(descriptor) } catch { /* already closed */ }
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
    throw error
  }
}

function replaceFile(temporary: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.renameSync(temporary, target)
    return
  }
  const backup = `${target}.backup-${process.pid}-${Date.now()}`
  fs.renameSync(target, backup)
  try {
    fs.renameSync(temporary, target)
    fs.rmSync(backup, { force: true })
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target)
    throw error
  }
}

function recoverAtomicBackup(target: string): void {
  if (fs.existsSync(target)) return
  const directory = path.dirname(target)
  if (!fs.existsSync(directory)) return
  const prefix = `${path.basename(target)}.backup-`
  const candidates = fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(directory, name))
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  const [newest, ...stale] = candidates
  if (!newest) return
  fs.renameSync(newest, target)
  for (const backup of stale) fs.rmSync(backup, { force: true })
}
