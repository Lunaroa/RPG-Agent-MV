import type { UiTextAlign } from '@contract/ui-designer'

export const normalizeUiSingleLineText = (value: unknown) => String(value ?? '').replace(/\r\n?|\n/g, ' ')

export const resolveUiSingleLineScale = (layoutWidth: number, naturalWidth: number) => {
  const width = Number.isFinite(layoutWidth) ? Math.max(1, layoutWidth) : 1
  const natural = Number.isFinite(naturalWidth) ? Math.max(0, naturalWidth) : 0
  return natural > width ? width / natural : 1
}

export const resolveUiSingleLineLeft = (
  layoutWidth: number,
  naturalWidth: number,
  scale: number,
  align: UiTextAlign,
) => {
  const width = Math.max(1, Number.isFinite(layoutWidth) ? layoutWidth : 1)
  const renderedWidth = Math.max(0, Number.isFinite(naturalWidth) ? naturalWidth : 0) * Math.max(0, Number.isFinite(scale) ? scale : 1)
  if (align === 'right') return width / 2 - renderedWidth
  if (align === 'center') return -renderedWidth / 2
  return -width / 2
}
