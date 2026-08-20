export interface UiFabricTextPresentationSync {
  shouldSync: boolean
  syncEditingTextarea: boolean
}

export function resolveUiFabricTextPresentationSync(
  isEditing: boolean,
  renderedContent: string,
  documentContent: string,
): UiFabricTextPresentationSync {
  const contentChangedOutsideInlineEditor = isEditing && renderedContent !== documentContent
  return {
    shouldSync: !isEditing || contentChangedOutsideInlineEditor,
    syncEditingTextarea: contentChangedOutsideInlineEditor,
  }
}
