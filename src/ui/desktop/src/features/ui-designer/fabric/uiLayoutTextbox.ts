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
}
