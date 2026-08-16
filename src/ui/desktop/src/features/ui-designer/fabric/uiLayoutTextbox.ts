import { Textbox, type TextboxProps } from 'fabric'
import type { UiTextVerticalAlign } from '@contract/ui-designer'

export type UiLayoutTextboxOptions = Partial<TextboxProps> & {
  layoutHeight: number
  verticalTextAlign: UiTextVerticalAlign
  editable?: boolean
}

export const resolveUiLayoutTextboxHeight = (layoutHeight: number, textContentHeight: number) =>
  Number.isFinite(layoutHeight) && layoutHeight > 0 ? layoutHeight : textContentHeight

export const resolveUiLayoutTextboxTop = (
  layoutHeight: number,
  textContentHeight: number,
  verticalTextAlign: UiTextVerticalAlign,
) => {
  if (verticalTextAlign === 'middle') return -textContentHeight / 2
  if (verticalTextAlign === 'bottom') return layoutHeight / 2 - textContentHeight
  return -layoutHeight / 2
}

export class UiLayoutTextbox extends Textbox<UiLayoutTextboxOptions> {
  declare layoutHeight: number
  declare verticalTextAlign: UiTextVerticalAlign
  declare textContentHeight: number

  override initDimensions() {
    super.initDimensions()
    if (!this.initialized) return
    this.textContentHeight = this.height
    this.height = resolveUiLayoutTextboxHeight(this.layoutHeight, this.textContentHeight)
  }

  override _getTopOffset() {
    const contentHeight = Number.isFinite(this.textContentHeight) ? this.textContentHeight : this.height
    return resolveUiLayoutTextboxTop(this.height, contentHeight, this.verticalTextAlign)
  }

  // Fabric appends the editing textarea to the document body with page
  // coordinates; focusing it scrolls the page and pushes the editor chrome
  // away. Pinning it to the viewport keeps both the page and IME placement
  // stable.
  override initHiddenTextarea() {
    super.initHiddenTextarea()
    if (this.hiddenTextarea) this.hiddenTextarea.style.position = 'fixed'
  }

  override updateTextareaPosition() {
    if (!this.canvas || !this.hiddenTextarea) return
    if (this.selectionStart !== this.selectionEnd) return
    const style = this._calcTextareaPosition()
    this.hiddenTextarea.style.position = 'fixed'
    this.hiddenTextarea.style.left = `${parseFloat(style.left) - window.scrollX}px`
    this.hiddenTextarea.style.top = `${parseFloat(style.top) - window.scrollY}px`
  }
}
