import type { UiDesignerDocument, UiEventAction, UiNode } from '@contract/ui-designer'

export type UiNodeActionCommand =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'addChild'
  | 'rename'
  | 'duplicate'
  | 'group'
  | 'sameType'
  | 'moveUp'
  | 'moveDown'
  | 'moveTop'
  | 'moveBottom'
  | 'toggleVisibility'
  | 'toggleLock'
  | 'delete'

export interface UiNodeActionPolicy {
  targetId: string
  selectionIds: string[]
  canTransform: boolean
  canReparent: boolean
  canUngroup: boolean
  allowed: Record<UiNodeActionCommand, boolean>
}

const nodeFor = (document: UiDesignerDocument, id: string): UiNode | undefined => document.nodes.find((node) => node.id === id)

function topLevelSelection(document: UiDesignerDocument, ids: readonly string[]): UiNode[] {
  const selected = new Set(ids)
  return document.nodes.filter((node) => selected.has(node.id) && (node.parentId === null || !selected.has(node.parentId)))
}

function subtreeContainsLockedNode(document: UiDesignerDocument, node: UiNode): boolean {
  const pending = [node]
  const seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    if (current.locked) return true
    for (const childId of current.children) {
      const child = nodeFor(document, childId)
      if (child) pending.push(child)
    }
  }
  return false
}

function hasLockedAncestor(document: UiDesignerDocument, node: UiNode): boolean {
  const seen = new Set<string>()
  let parentId = node.parentId
  while (parentId !== null) {
    if (seen.has(parentId)) return true
    seen.add(parentId)
    const parent = nodeFor(document, parentId)
    if (!parent) return true
    if (parent.locked) return true
    parentId = parent.parentId
  }
  return false
}

/** One permission source for tree, canvas, shortcuts, and controller execution guards. */
export function resolveNodeActionPolicy(document: UiDesignerDocument, currentSelection: readonly string[], targetId: string, hasClipboard: boolean): UiNodeActionPolicy {
  const target = nodeFor(document, targetId)
  const validCurrent = [...new Set(currentSelection)].filter((id) => Boolean(nodeFor(document, id)))
  const selectionIds = target && validCurrent.includes(targetId) ? validCurrent : target ? [targetId] : []
  const selected = topLevelSelection(document, selectionIds)
  const containsRoot = selected.some((node) => node.id === 'node_root')
  const containsLocked = selected.some((node) => node.locked)
  const containsProtectedSubtree = selected.some((node) => subtreeContainsLockedNode(document, node))
  const containsLockedAncestor = selected.some((node) => hasLockedAncestor(document, node))
  const sameParent = selected.length > 0 && selected.every((node) => node.parentId === selected[0].parentId)
  const parent = selected.length === 1 && selected[0].parentId !== null ? nodeFor(document, selected[0].parentId) : undefined
  const siblings = selected.length === 1 ? selected[0].parentId === null ? document.zOrder.filter((id) => id !== 'node_root') : parent?.children ?? [] : []
  const siblingIndex = selected.length === 1 ? siblings.indexOf(selected[0].id) : -1
  const singleStructural = selected.length === 1 && !containsRoot && !containsLocked && !containsProtectedSubtree && !containsLockedAncestor && !parent?.locked && siblingIndex >= 0
  const safeSelection = selected.length > 0 && !containsRoot && !containsLocked && !containsLockedAncestor
  const deletableSelection = safeSelection && !containsProtectedSubtree
  const canTransform = deletableSelection && sameParent
  const canReparent = selected.length === 1 && deletableSelection
  const canUngroup = deletableSelection && selected.every((node) => node.type === 'container')
  const groupable = selected.length >= 2 && sameParent && safeSelection && !containsProtectedSubtree && !(selected[0].parentId !== null && nodeFor(document, selected[0].parentId)?.locked)
  const targetContainer = (target?.type === 'container' || target?.type === 'list') && !target.locked && !hasLockedAncestor(document, target)

  return {
    targetId,
    selectionIds,
    canTransform,
    canReparent,
    canUngroup,
    allowed: {
      copy: selected.length > 0,
      cut: deletableSelection,
      paste: Boolean(hasClipboard && targetContainer),
      addChild: Boolean(targetContainer),
      rename: Boolean(target && target.id !== 'node_root' && !target.locked && !hasLockedAncestor(document, target)),
      duplicate: deletableSelection && sameParent,
      group: groupable,
      sameType: Boolean(target),
      moveUp: singleStructural && siblingIndex > 0,
      moveDown: singleStructural && siblingIndex < siblings.length - 1,
      moveTop: singleStructural && siblingIndex < siblings.length - 1,
      moveBottom: singleStructural && siblingIndex > 0,
      toggleVisibility: Boolean(target),
      toggleLock: Boolean(target),
      delete: deletableSelection,
    },
  }
}

/** Reorder an event action chain without mutating the source document. */
export function reorderEventActions(actions: readonly UiEventAction[], fromIndex: number, toIndex: number): UiEventAction[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= actions.length || toIndex >= actions.length || fromIndex === toIndex) return [...actions]
  const next = [...actions]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return [...actions]
  next.splice(toIndex, 0, item)
  return next
}
