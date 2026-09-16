import { expect, test, vi } from 'vitest'
import { Textbox } from 'fabric'
import { UiLayoutTextbox, resolveUiLayoutTextboxHeight, resolveUiLayoutTextboxTop } from './uiLayoutTextbox'
import { normalizeUiSingleLineText, resolveUiSingleLineLeft, resolveUiSingleLineScale } from './uiSingleLineText'

test('layout textbox preserves explicit height while text changes', () => {
  expect(resolveUiLayoutTextboxHeight(150, 28)).toBe(150)
  expect(resolveUiLayoutTextboxHeight(Number.NaN, 56)).toBe(56)
  expect(resolveUiLayoutTextboxTop(150, 28, 'top')).toBe(-75)
  expect(resolveUiLayoutTextboxTop(150, 28, 'middle')).toBe(-14)
  expect(resolveUiLayoutTextboxTop(150, 28, 'bottom')).toBe(47)
})

test('button text flattens line breaks and overflowing text compresses only horizontally', () => {
  expect(normalizeUiSingleLineText('line one\r\nline two\nline three')).toBe('line one line two line three')
  expect(resolveUiSingleLineScale(100, 250)).toBe(0.4)
  expect(resolveUiSingleLineScale(250, 100)).toBe(1)
  expect(resolveUiSingleLineLeft(100, 250, 0.4, 'left')).toBe(-50)
  expect(resolveUiSingleLineLeft(100, 250, 0.4, 'center')).toBe(-50)
  expect(resolveUiSingleLineLeft(120, 250, 0.4, 'right')).toBe(-40)
})

test('ordinary text delegates enabled wrapping to Fabric and keeps manual lines and buttons unchanged', () => {
  const wrap = vi.spyOn(Textbox.prototype, '_wrapText').mockReturnValue([['a'], ['b']])
  try {
    const textbox = { singleLine: false, wrapWidth: 64, graphemeSplit: (text: string) => Array.from(text) } as unknown as UiLayoutTextbox
    expect(UiLayoutTextbox.prototype._wrapText.call(textbox, ['ab'], 200)).toEqual([['a'], ['b']])
    expect(wrap).toHaveBeenCalledWith(['ab'], 64)
    wrap.mockClear()
    textbox.wrapWidth = 0
    expect(UiLayoutTextbox.prototype._wrapText.call(textbox, ['ab', 'cd'], 20)).toEqual([['a', 'b'], ['c', 'd']])
    textbox.singleLine = true
    textbox.wrapWidth = 64
    expect(UiLayoutTextbox.prototype._wrapText.call(textbox, ['ab', 'cd'], 20)).toEqual([['a', 'b', ' ', 'c', 'd']])
    expect(wrap).not.toHaveBeenCalled()
  } finally {
    wrap.mockRestore()
  }
})
