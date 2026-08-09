export interface UiDesignerCodeMirrorChange {
  origin?: string
}

export interface UiDesignerCodeMirrorFormattingHandle {
  lineCount: () => number
  indentLine: (line: number, direction?: string) => void
  operation?: (operation: () => void) => void
}

/** Read the preference at blur time so toggling auto-format never requires remounting CodeMirror. */
export function createUiDesignerCodeMirrorBlurHandler(
  isFormatEnabled: () => boolean,
  format: () => void,
): () => void {
  return () => { if (isFormatEnabled()) format() }
}

/** Programmatic document replacement must refresh lint without becoming a user draft. */
export function createUiDesignerCodeMirrorChangeHandler(
  getValue: () => string,
  emitChange: (value: string) => void,
  lint: () => void,
): (_instance: unknown, change: UiDesignerCodeMirrorChange) => void {
  return (_instance, change) => {
    lint()
    if (change.origin !== 'setValue') emitChange(getValue())
  }
}

/** Format the complete source document rather than only the cursor's current line. */
export function formatUiDesignerCodeMirrorDocument(editor: UiDesignerCodeMirrorFormattingHandle): void {
  const format = () => {
    for (let line = 0; line < editor.lineCount(); line += 1) editor.indentLine(line, 'smart')
  }
  if (editor.operation) editor.operation(format)
  else format()
}
