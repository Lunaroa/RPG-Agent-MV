import type { UiDesignerDocument, UiNode, UiNodeGroup, UiPoint, UiRect } from '@contract/ui-designer'
import { cloneUiDocument, createUiDocument } from './document'
import { copySelection, pasteClipboard, validateTreeInvariants } from './tree'

const boundsFor = (nodes: UiNode[], roots: string[]): UiRect => {
  const selected = nodes.filter((node) => roots.includes(node.id))
  const minX = Math.min(...selected.map((node) => node.props.x))
  const minY = Math.min(...selected.map((node) => node.props.y))
  const maxX = Math.max(...selected.map((node) => node.props.x + node.props.width))
  const maxY = Math.max(...selected.map((node) => node.props.y + node.props.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function createNodeGroup(document: UiDesignerDocument, ids: readonly string[], name: string): UiNodeGroup {
  const clipboard = copySelection(document, ids)
  if (!clipboard.nodes.length) throw new Error('Select at least one node to save as a template')
  const roots = clipboard.sourceIds
  const nodes = clipboard.nodes.map((node) => roots.includes(node.id) ? { ...node, parentId: null } : node)
  return { format: 'mztemplate', version: '1.0.0', name: name.trim() || 'NodeGroup', roots, nodes, origin: boundsFor(nodes, roots) }
}

export function validateNodeGroup(group: unknown): group is UiNodeGroup {
  if (!group || typeof group !== 'object') return false
  const candidate = group as Partial<UiNodeGroup>
  if (candidate.format !== 'mztemplate' || candidate.version !== '1.0.0' || typeof candidate.name !== 'string' || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.roots)) return false
  const ids = new Set(candidate.nodes.map((node) => node?.id))
  if (ids.size !== candidate.nodes.length || candidate.roots.some((id) => !ids.has(id))) return false
  const synthetic = createUiDocument('Scene_Template')
  synthetic.nodes = candidate.nodes as UiNode[]
  synthetic.zOrder = candidate.roots
  return validateTreeInvariants(synthetic).length === 0
}

export function insertNodeGroup(document: UiDesignerDocument, group: UiNodeGroup, parentId: string | null = null, point?: UiPoint): { document: UiDesignerDocument; ids: string[] } {
  if (!validateNodeGroup(group)) throw new Error('Invalid .mztemplate node group')
  const beforeIds = new Set(document.nodes.map((node) => node.id))
  const pasted = pasteClipboard(document, { nodes: group.nodes, sourceIds: group.roots }, parentId)
  if (!point || !pasted.ids.length) return pasted
  const next = cloneUiDocument(pasted.document)
  const insertedIds = next.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id)
  const insertedRoots = next.nodes.filter((node) => pasted.ids.includes(node.id))
  const bounds = boundsFor(insertedRoots, pasted.ids)
  const dx = point.x - bounds.x
  const dy = point.y - bounds.y
  const inserted = new Set(insertedIds)
  // Node coordinates are absolute canvas coordinates in v10. Move the whole
  // pasted subtree, not only roots/direct children, so nested grandchildren do
  // not jump relative to their container.
  for (const node of next.nodes) if (inserted.has(node.id)) { node.props.x += dx; node.props.y += dy }
  return { document: next, ids: pasted.ids }
}
