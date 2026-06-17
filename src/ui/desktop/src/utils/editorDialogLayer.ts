export function isTopmostEditorDialog(layer: number) {
  const openLayers = Array.from(document.querySelectorAll<HTMLElement>('[data-editor-dialog-layer]'))
    .map((element) => Number(element.dataset.editorDialogLayer || 0));
  return layer >= Math.max(0, ...openLayers);
}
