import type { UiEventAction } from '@contract/ui-designer'

/** Reorder an event action chain without mutating the source document. */
export function reorderEventActions(actions: readonly UiEventAction[], fromIndex: number, toIndex: number): UiEventAction[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= actions.length || toIndex >= actions.length || fromIndex === toIndex) return [...actions]
  const next = [...actions]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return [...actions]
  next.splice(toIndex, 0, item)
  return next
}
