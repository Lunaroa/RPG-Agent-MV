import type {
  UiClipboardPayload,
  UiDesignerDocument,
  UiNode,
  UiTreeDropPosition,
  UiValidationIssue,
} from '@contract/ui-designer'
import { cloneUiDocument, createDefaultNode, findNode, nextNodeId } from './document'

export function validateTreeInvariants(document: UiDesignerDocument): UiValidationIssue[] {
  const issues: UiValidationIssue[] = []
  const byId = new Map<string, UiNode>()
  const idCounts = new Map<string, number>()
  const nameCounts = new Map<string, number>()

  for (const node of document.nodes) {
    idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1)
    nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1)
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) issues.push({ severity: 'error', code: 'duplicate-node-id', message: `Duplicate node id: ${id}`, nodeId: id })
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) issues.push({ severity: 'error', code: 'duplicate-node-name', message: `Duplicate node name: ${name}`, nodeName: name })
  }

  for (const node of document.nodes) {
    const childIds = new Set<string>()
    for (const childId of node.children) {
      if (childIds.has(childId)) {
        issues.push({ severity: 'error', code: 'duplicate-child-id', message: `Node ${node.name} lists child ${childId} more than once`, nodeId: node.id, nodeName: node.name })
      }
      childIds.add(childId)
    }
    if (node.type !== 'container' && node.children.length > 0) {
      issues.push({ severity: 'error', code: 'non-container-children', message: `Node ${node.name} cannot contain children`, nodeId: node.id, nodeName: node.name })
    }
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId)
      if (!parent) {
        issues.push({ severity: 'error', code: 'missing-parent', message: `Node ${node.name} has a missing parent`, nodeId: node.id, nodeName: node.name })
      } else if (!parent.children.includes(node.id)) {
        issues.push({ severity: 'error', code: 'missing-child', message: `Parent ${parent.name} does not reference ${node.name}`, nodeId: node.id, nodeName: node.name })
      }
    }
    for (const childId of node.children) {
      const child = byId.get(childId)
      if (!child) {
        issues.push({ severity: 'error', code: 'missing-child', message: `Node ${node.name} references a missing child`, nodeId: node.id, nodeName: node.name })
      } else if (child.parentId !== node.id) {
        issues.push({ severity: 'error', code: 'missing-parent', message: `Child ${child.name} points at another parent`, nodeId: child.id, nodeName: child.name })
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>()
  const visit = (id: string, stack: string[]) => {
    const state = visitState.get(id)
    if (state === 'visiting') {
      const cycle = [...stack, id].join(' → ')
      issues.push({ severity: 'error', code: 'cycle', message: `Cycle in node tree: ${cycle}`, nodeId: id })
      return
    }
    if (state === 'visited') return
    visitState.set(id, 'visiting')
    const node = byId.get(id)
    if (node) for (const childId of node.children) visit(childId, [...stack, id])
    visitState.set(id, 'visited')
  }
  for (const root of document.nodes.filter((node) => node.parentId === null)) visit(root.id, [])
  for (const node of document.nodes) {
    if (!visitState.has(node.id)) issues.push({ severity: 'error', code: 'orphan-node', message: `Node ${node.name} is not reachable from a root`, nodeId: node.id, nodeName: node.name })
  }

  const rootIds = new Set(document.nodes.filter((node) => node.parentId === null).map((node) => node.id))
  const zOrderSet = new Set<string>()
  for (const id of document.zOrder) {
    if (!rootIds.has(id)) issues.push({ severity: 'error', code: 'invalid-z-order', message: `Z-order contains a non-root or missing node: ${id}`, nodeId: id })
    if (zOrderSet.has(id)) issues.push({ severity: 'error', code: 'invalid-z-order', message: `Z-order contains duplicate node: ${id}`, nodeId: id })
    zOrderSet.add(id)
  }
  for (const id of rootIds) if (!zOrderSet.has(id)) issues.push({ severity: 'error', code: 'invalid-z-order', message: `Root node ${id} is missing from z-order`, nodeId: id })
  return issues
}

export function isDescendant(document: UiDesignerDocument, ancestorId: string, candidateId: string): boolean {
  const ancestor = findNode(document, ancestorId)
  if (!ancestor) return false
  const pending = [...ancestor.children]
  const seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === candidateId) return true
    if (seen.has(id)) continue
    seen.add(id)
    const node = findNode(document, id)
    if (node) pending.push(...node.children)
  }
  return false
}

/** Keep only selection roots so a selected parent owns transforms for its descendants. */
export function selectionRootNodeIds(document: UiDesignerDocument, nodeIds: readonly string[]): string[] {
  const selected = new Set(nodeIds.filter((id) => Boolean(findNode(document, id))))
  return [...selected].filter((id) => {
    let parentId = findNode(document, id)?.parentId ?? null
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false
      visited.add(parentId)
      parentId = findNode(document, parentId)?.parentId ?? null
    }
    return true
  })
}

/** Return each selected root followed by its complete document subtree exactly once. */
export function collectNodeSubtreeIds(document: UiDesignerDocument, nodeIds: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const pending = [...selectionRootNodeIds(document, nodeIds)]
  while (pending.length) {
    const id = pending.shift()!
    if (seen.has(id)) continue
    const node = findNode(document, id)
    if (!node) continue
    seen.add(id)
    result.push(id)
    pending.unshift(...node.children)
  }
  return result
}

/** Rank every node by its depth-first tree position; the tree order is the stacking order. */
export function resolveTreeOrderRanks(document: UiDesignerDocument): Map<string, number> {
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  const ranks = new Map<string, number>()
  const visit = (id: string) => {
    if (ranks.has(id)) return
    const node = byId.get(id)
    if (!node) return
    ranks.set(id, ranks.size)
    for (const childId of node.children) visit(childId)
  }
  for (const id of document.zOrder) visit(id)
  for (const node of document.nodes) if (node.parentId === null) visit(node.id)
  for (const node of document.nodes) visit(node.id)
  return ranks
}

function subtreeContainsLockedNode(document: UiDesignerDocument, nodeId: string): boolean {
  const pending = [nodeId]
  const seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = findNode(document, id)
    if (!node) continue
    if (node.locked) return true
    pending.push(...node.children)
  }
  return false
}

function hasLockedAncestor(document: UiDesignerDocument, node: UiNode): boolean {
  const seen = new Set<string>()
  let parentId = node.parentId
  while (parentId !== null) {
    if (seen.has(parentId)) return true
    seen.add(parentId)
    const parent = findNode(document, parentId)
    if (!parent) return true
    if (parent.locked) return true
    parentId = parent.parentId
  }
  return false
}

function removeFromParent(document: UiDesignerDocument, node: UiNode): void {
  if (node.parentId === null) {
    for (let index = document.zOrder.length - 1; index >= 0; index -= 1) {
      if (document.zOrder[index] === node.id) document.zOrder.splice(index, 1)
    }
    return
  }
  const parent = findNode(document, node.parentId)
  if (parent) {
    for (let index = parent.children.length - 1; index >= 0; index -= 1) {
      if (parent.children[index] === node.id) parent.children.splice(index, 1)
    }
  }
}

function insertAt(list: string[], id: string, targetId: string | null, position: UiTreeDropPosition): void {
  if (targetId === null || position === 'inner') {
    list.push(id)
    return
  }
  const targetIndex = list.indexOf(targetId)
  if (targetIndex < 0) {
    list.push(id)
    return
  }
  list.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, id)
}

export function reparentNode(
  document: UiDesignerDocument,
  nodeId: string,
  targetId: string | null,
  position: UiTreeDropPosition,
): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const node = findNode(next, nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  if (node.id === 'node_root' || subtreeContainsLockedNode(next, node.id)) throw new Error('Root nodes or subtrees containing locked nodes cannot be moved')
  if (targetId === nodeId || (targetId && isDescendant(next, nodeId, targetId))) throw new Error('Cannot move a node inside itself or its descendant')
  if (hasLockedAncestor(next, node)) throw new Error('Nodes inside a locked container cannot be moved')

  let parentId: string | null
  if (position === 'inner') {
    const parent = targetId ? findNode(next, targetId) : undefined
    if (!parent || parent.type !== 'container' || parent.locked || hasLockedAncestor(next, parent)) throw new Error('Only a container outside locked ancestry can receive child nodes')
    parentId = parent.id
  } else {
    const target = targetId ? findNode(next, targetId) : undefined
    if (!target) throw new Error('A before/after drop requires a target node')
    if (target.id === 'node_root') throw new Error('The root canvas cannot be used as a sibling reorder target')
    if (target.locked || hasLockedAncestor(next, target)) throw new Error('A locked node cannot be used as a reorder target')
    parentId = target.parentId
    const destinationParent = parentId === null ? undefined : findNode(next, parentId)
    if (destinationParent && (destinationParent.locked || hasLockedAncestor(next, destinationParent))) throw new Error('A locked container cannot be reordered')
  }

  removeFromParent(next, node)
  node.parentId = parentId
  if (parentId === null) insertAt(next.zOrder, node.id, targetId, position)
  else {
    const parent = findNode(next, parentId)
    if (!parent) throw new Error(`Unknown destination parent: ${parentId}`)
    insertAt(parent.children, node.id, position === 'inner' ? null : targetId, position)
  }
  return next
}

export function moveNodeToEdge(document: UiDesignerDocument, nodeId: string, edge: 'top' | 'bottom'): UiDesignerDocument {
  const node = findNode(document, nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  if (node.id === 'node_root' || subtreeContainsLockedNode(document, node.id) || hasLockedAncestor(document, node)) return cloneUiDocument(document)
  const next = cloneUiDocument(document)
  const cloned = findNode(next, nodeId)!
  if (cloned.parentId !== null && findNode(next, cloned.parentId)?.locked) return next
  const source = cloned.parentId === null ? next.zOrder : findNode(next, cloned.parentId)?.children
  const siblings = cloned.parentId === null ? source?.filter((id) => id !== 'node_root') : source
  if (!siblings) throw new Error('Node parent is missing')
  const index = siblings.indexOf(nodeId)
  if (index >= 0) siblings.splice(index, 1)
  if (edge === 'top') siblings.unshift(nodeId)
  else siblings.push(nodeId)
  if (cloned.parentId === null && source) {
    let movableIndex = 0
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== 'node_root') source[index] = siblings[movableIndex++]
    }
  }
  return next
}

/** Move one selected sibling by one slot while preserving the parent's child order. */
export function moveNodeStep(document: UiDesignerDocument, nodeId: string, direction: 'up' | 'down'): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const node = findNode(next, nodeId)
  if (!node || node.id === 'node_root' || subtreeContainsLockedNode(next, node.id) || hasLockedAncestor(next, node)) return next
  const parent = node.parentId === null ? undefined : findNode(next, node.parentId)
  if (node.parentId !== null && (!parent || parent.locked)) return next
  const source = node.parentId === null ? next.zOrder : parent!.children
  const siblings = node.parentId === null ? source.filter((id) => id !== 'node_root') : source
  const index = siblings.indexOf(node.id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= siblings.length) return next
  const [moved] = siblings.splice(index, 1)
  siblings.splice(target, 0, moved)
  if (node.parentId === null) {
    let movableIndex = 0
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
      if (source[sourceIndex] !== 'node_root') source[sourceIndex] = siblings[movableIndex++]
    }
  }
  return next
}

function topLevelSelection(document: UiDesignerDocument, ids: readonly string[]): UiNode[] {
  const selected = new Set(ids)
  return document.nodes.filter((node) => selected.has(node.id) && (node.parentId === null || !selected.has(node.parentId)))
}

export function groupNodes(document: UiDesignerDocument, ids: readonly string[], name = 'group'): { document: UiDesignerDocument; groupId: string } {
  const selected = topLevelSelection(document, ids)
  if (selected.length < 2) throw new Error('Select at least two sibling nodes to group')
  if (selected.some((node) => node.id === 'node_root' || subtreeContainsLockedNode(document, node.id) || hasLockedAncestor(document, node)) || selected.some((node) => node.parentId !== selected[0].parentId)) throw new Error('Only unlocked sibling subtrees can be grouped')
  if (selected[0].parentId !== null && findNode(document, selected[0].parentId)?.locked) throw new Error('Nodes inside a locked container cannot be grouped')
  const next = cloneUiDocument(document)
  const selectedIds = selected.map((node) => node.id)
  const first = findNode(next, selectedIds[0])!
  const groupId = nextNodeId(next, 'container')
  const group = createDefaultNode('container', {
    id: groupId,
    name,
    parentId: first.parentId,
    x: Math.min(...selected.map((node) => node.props.x)),
    y: Math.min(...selected.map((node) => node.props.y)),
    width: Math.max(...selected.map((node) => node.props.x + node.props.width)) - Math.min(...selected.map((node) => node.props.x)),
    height: Math.max(...selected.map((node) => node.props.y + node.props.height)) - Math.min(...selected.map((node) => node.props.y)),
  })
  next.nodes.push(group)
  const siblings = group.parentId === null ? next.zOrder : findNode(next, group.parentId)?.children
  if (!siblings) throw new Error('Selected node parent is missing')
  const selectedIndexes = selectedIds.map((id) => siblings.indexOf(id)).filter((index) => index >= 0)
  const insertionIndex = selectedIndexes.length ? Math.min(...selectedIndexes) : siblings.length
  for (const id of selectedIds) {
    const node = findNode(next, id)!
    removeFromParent(next, node)
    node.parentId = groupId
    group.children.push(id)
  }
  siblings.splice(Math.min(insertionIndex, siblings.length), 0, groupId)
  return { document: next, groupId }
}

export function ungroupNodes(document: UiDesignerDocument, ids: readonly string[]): UiDesignerDocument {
  const selected = topLevelSelection(document, ids).filter((node) => node.id !== 'node_root' && node.type === 'container')
  if (!selected.length) throw new Error('Select a container group to ungroup')
  if (selected.some((node) => subtreeContainsLockedNode(document, node.id) || hasLockedAncestor(document, node))) throw new Error('Groups containing locked nodes cannot be ungrouped')
  const next = cloneUiDocument(document)
  for (const group of selected) {
    const current = findNode(next, group.id)
    if (!current || current.id === 'node_root' || current.type !== 'container') continue
    const children = [...current.children]
    const siblings = current.parentId === null ? next.zOrder : findNode(next, current.parentId)?.children
    if (!siblings) throw new Error('Selected group parent is missing')
    const index = siblings.indexOf(current.id)
    if (index >= 0) siblings.splice(index, 1, ...children)
    for (const childId of children) {
      const child = findNode(next, childId)
      if (child) child.parentId = current.parentId
    }
    next.nodes = next.nodes.filter((node) => node.id !== current.id)
  }
  return next
}

export function copySelection(document: UiDesignerDocument, ids: readonly string[]): UiClipboardPayload {
  const roots = topLevelSelection(document, ids)
  const wanted = new Set<string>()
  const collect = (node: UiNode) => {
    if (wanted.has(node.id)) return
    wanted.add(node.id)
    for (const childId of node.children) {
      const child = findNode(document, childId)
      if (child) collect(child)
    }
  }
  for (const node of roots) collect(node)
  return { nodes: document.nodes.filter((node) => wanted.has(node.id)).map((node) => JSON.parse(JSON.stringify(node)) as UiNode), sourceIds: roots.map((node) => node.id) }
}

export function pasteClipboard(document: UiDesignerDocument, clipboard: UiClipboardPayload, parentId: string | null = null, offset = 10): { document: UiDesignerDocument; ids: string[] } {
  if (!clipboard.nodes.length) return { document: cloneUiDocument(document), ids: [] }
  if (clipboard.nodes.some((node) => node.locked)) throw new Error('Clipboard subtrees containing locked nodes cannot be pasted')
  const next = cloneUiDocument(document)
  if (parentId !== null) {
    const parent = findNode(next, parentId)
    if (!parent || parent.type !== 'container' || parent.locked || hasLockedAncestor(next, parent)) throw new Error('Paste destination must be outside locked ancestry')
  }
  const idMap = new Map<string, string>()
  const usedIds = new Set(next.nodes.map((node) => node.id))
  const usedNames = new Set(next.nodes.map((node) => node.name))
  for (const node of clipboard.nodes) {
    const prefix = `node_${node.type}_`
    let sequence = Number(nextNodeId(next, node.type).slice(prefix.length))
    if (!Number.isInteger(sequence) || sequence < 1) sequence = 1
    let candidate = `${prefix}${String(sequence).padStart(3, '0')}`
    while (usedIds.has(candidate)) {
      sequence += 1
      candidate = `${prefix}${String(sequence).padStart(3, '0')}`
    }
    idMap.set(node.id, candidate)
    usedIds.add(candidate)
  }
  const copies = clipboard.nodes.map((node) => {
    const copy = JSON.parse(JSON.stringify(node)) as UiNode
    copy.id = idMap.get(node.id)!
    copy.parentId = node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId)! : parentId
    copy.children = node.children.map((childId) => idMap.get(childId)).filter((id): id is string => Boolean(id))
    let name = `${node.name}_copy`
    let nameIndex = 2
    while (usedNames.has(name)) name = `${node.name}_copy_${nameIndex++}`
    copy.name = name
    usedNames.add(name)
    copy.props.x += offset
    copy.props.y += offset
    for (const handler of Object.values(copy.events)) {
      if (!handler) continue
      for (const action of handler.actions) {
        if (action.type === 'toggleNode' && idMap.has(action.targetNodeId)) action.targetNodeId = idMap.get(action.targetNodeId)!
        if (action.type === 'tweenProp' && idMap.has(action.tweenNodeId)) action.tweenNodeId = idMap.get(action.tweenNodeId)!
      }
    }
    return copy
  })
  next.nodes.push(...copies)
  const topCopies = copies.filter((node) => node.parentId === parentId)
  const target = parentId === null ? next.zOrder : findNode(next, parentId)?.children
  if (!target) throw new Error('Paste destination parent is missing')
  target.push(...topCopies.map((node) => node.id))
  return { document: next, ids: topCopies.map((node) => node.id) }
}
