export const UI_DESIGNER_MENU_COMMAND_EVENT = 'agent-rpg:ui-designer-menu-command'

export type UiDesignerMenuCommand =
  | 'new'
  | 'open'
  | 'import'
  | 'save'
  | 'saveAs'
  | 'editorPreview'
  | 'gamePreview'
  | 'globalData'
  | 'settings'
  | 'tour'
  | 'shortcuts'
  | 'about'

export function dispatchUiDesignerMenuCommand(command: UiDesignerMenuCommand): void {
  window.dispatchEvent(new CustomEvent<UiDesignerMenuCommand>(UI_DESIGNER_MENU_COMMAND_EVENT, { detail: command }))
}

export function uiDesignerMenuCommandFromEvent(event: Event): UiDesignerMenuCommand | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return null
  return [
    'new',
    'open',
    'import',
    'save',
    'saveAs',
    'editorPreview',
    'gamePreview',
    'globalData',
    'settings',
    'tour',
    'shortcuts',
    'about',
  ].includes(event.detail) ? event.detail as UiDesignerMenuCommand : null
}
