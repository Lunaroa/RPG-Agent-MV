import { Textbox, type TextboxProps } from 'fabric'
import type { UiTextVerticalAlign } from '@contract/ui-designer'
import { normalizeUiSingleLineText, resolveUiSingleLineLeft, resolveUiSingleLineScale } from './uiSingleLineText'

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
  declare naturalTextWidth: number
  declare horizontalTextScale: number

  override _wrapText(lines: string[], _desiredWidth: number): string[][] {
    return [this.graphemeSplit(normalizeUiSingleLineText(lines.join(' ')))]
  }

  override initDimensions() {
    const layoutWidth = this.width
    super.initDimensions()
    if (!this.initialized) return
    this.width = layoutWidth
    this.dynamicMinWidth = 0
    this.naturalTextWidth = this.getLineWidth(0)
    this.horizontalTextScale = resolveUiSingleLineScale(this.width, this.naturalTextWidth)
    this.textContentHeight = this.height
    this.height = resolveUiLayoutTextboxHeight(this.layoutHeight, this.textContentHeight)
  }

  override _getTopOffset() {
    const contentHeight = Number.isFinite(this.textContentHeight) ? this.textContentHeight : this.height
    return resolveUiLayoutTextboxTop(this.height, contentHeight, this.verticalTextAlign)
  }

  override _renderTextCommon(ctx: CanvasRenderingContext2D, method: 'fillText' | 'strokeText') {
    const line = this._textLines[0] ?? []
    if (!line.length) return
    const naturalWidth = Number.isFinite(this.naturalTextWidth) ? this.naturalTextWidth : this.getLineWidth(0)
    const horizontalScale = resolveUiSingleLineScale(this.width, naturalWidth)
    const align = this.textAlign === 'center' || this.textAlign === 'right' ? this.textAlign : 'left'
    const left = resolveUiSingleLineLeft(this.width, naturalWidth, horizontalScale, align)
    const top = this._getTopOffset() + this.getHeightOfLine(0) / this.lineHeight
    ctx.save()
    ctx.scale(horizontalScale, 1)
    this._renderTextLine(method, ctx, line, left / horizontalScale, top, 0)
    ctx.restore()
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
