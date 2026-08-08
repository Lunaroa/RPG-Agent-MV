export interface UiDesignerShortcutBinding {
  id?: string
  description?: string
  key: string
  ctrlOrMeta?: boolean
  shift?: boolean
  alt?: boolean
  allowInEditable?: boolean
  handler: () => void | Promise<void>
}

export type UiDesignerShortcutDisplay = Omit<UiDesignerShortcutBinding, 'handler'>

/** Non-window bindings owned by the designer child surfaces and shown in Help. */
export const UI_DESIGNER_LOCAL_SHORTCUTS: UiDesignerShortcutDisplay[] = [
  { key: 'Ctrl/Cmd + Tab', description: 'shortcutNextScene' },
  { key: 'Ctrl/Cmd + Shift + Tab', description: 'shortcutPreviousScene' },
  { key: 'F2', description: 'shortcutRenameNode' },
  { key: 'Enter', description: 'shortcutSelectNode' },
  { key: 'Ctrl/Cmd + C/X/V', description: 'shortcutClipboard' },
  { key: 'Space + drag', description: 'shortcutPanCanvas' },
  { key: 'Wheel', description: 'shortcutCanvasZoom' },
  { key: 'Ctrl/Cmd + F/H/Space', description: 'shortcutCodeMirrorTools' },
]

const isEditableTarget = (target: EventTarget | null) => {
  const element = typeof HTMLElement !== 'undefined' && target instanceof HTMLElement ? target : undefined
  return Boolean(element?.isContentEditable || element?.closest('input, textarea, select, [contenteditable="true"], .CodeMirror'))
}

/** Window-level designer shortcuts with one input/CodeMirror guard. */
export function createUiDesignerShortcutRegistry() {
  const bindings: UiDesignerShortcutBinding[] = []
  const unregisterAll = () => { bindings.splice(0, bindings.length) }
  const register = (binding: UiDesignerShortcutBinding) => {
    bindings.push(binding)
    return () => {
      const index = bindings.indexOf(binding)
      if (index >= 0) bindings.splice(index, 1)
    }
  }
  const handle = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return false
    const editable = isEditableTarget(event.target)
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const binding = bindings.find((candidate) => {
      const expected = candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key
      return expected === key
        && Boolean(candidate.ctrlOrMeta) === Boolean(event.ctrlKey || event.metaKey)
        && Boolean(candidate.shift) === event.shiftKey
        && Boolean(candidate.alt) === event.altKey
        && (!editable || Boolean(candidate.allowInEditable))
    })
    if (!binding) return false
    event.preventDefault()
    void binding.handler()
    return true
  }
  const list = (): UiDesignerShortcutDisplay[] => bindings.map(({ handler: _handler, ...display }) => ({ ...display }))
  return { register, handle, unregisterAll, list }
}
