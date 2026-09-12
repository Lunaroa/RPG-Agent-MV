import { Textbox, type TextboxProps } from 'fabric'
import type { UiTextVerticalAlign } from '@contract/ui-designer'
import { normalizeUiSingleLineText, resolveUiSingleLineLeft, resolveUiSingleLineScale } from './uiSingleLineText'

export type UiLayoutTextboxOptions = Partial<TextboxProps> & {
  layoutHeight: number
  verticalTextAlign: UiTextVerticalAlign
  singleLine?: boolean
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
  declare singleLine: boolean

  override _wrapText(lines: string[], _desiredWidth: number): string[][] {
    if (this.singleLine) return [this.graphemeSplit(normalizeUiSingleLineText(lines.join(' ')))]
    return lines.map((line) => this.graphemeSplit(line))
  }

  override initDimensions() {
    const layoutWidth = this.width
    super.initDimensions()
    if (!this.initialized) return
    this.width = layoutWidth
    this.dynamicMinWidth = 0
    this.naturalTextWidth = this._textLines.reduce((maximum, _line, index) => Math.max(maximum, this.getLineWidth(index)), 0)
    this.horizontalTextScale = resolveUiSingleLineScale(this.width, this.naturalTextWidth)
    this.textContentHeight = this.height
    this.height = resolveUiLayoutTextboxHeight(this.layoutHeight, this.textContentHeight)
  }

  override _getTopOffset() {
    const contentHeight = Number.isFinite(this.textContentHeight) ? this.textContentHeight : this.height
    return resolveUiLayoutTextboxTop(this.height, contentHeight, this.verticalTextAlign)
  }

  override _renderTextCommon(ctx: CanvasRenderingContext2D, method: 'fillText' | 'strokeText') {
    const naturalWidth = Number.isFinite(this.naturalTextWidth) ? this.naturalTextWidth : this.getLineWidth(0)
    const horizontalScale = resolveUiSingleLineScale(this.width, naturalWidth)
    const align = this.textAlign === 'center' || this.textAlign === 'right' ? this.textAlign : 'left'
    const top = this._getTopOffset()
    let lineHeights = 0
    ctx.save()
    ctx.scale(horizontalScale, 1)
    for (let index = 0; index < this._textLines.length; index += 1) {
      const line = this._textLines[index] ?? []
      const lineWidth = this.getLineWidth(index)
      const left = resolveUiSingleLineLeft(this.width, lineWidth, horizontalScale, align)
      this._renderTextLine(method, ctx, line, left / horizontalScale, top + lineHeights + this.getHeightOfLine(index) / this.lineHeight, index)
      lineHeights += this.getHeightOfLine(index)
    }
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
