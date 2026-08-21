import { expect, test } from 'vitest'
import { resolveUiLayoutTextboxHeight, resolveUiLayoutTextboxTop } from './uiLayoutTextbox'
import { normalizeUiSingleLineText, resolveUiSingleLineLeft, resolveUiSingleLineScale } from './uiSingleLineText'

test('layout textbox preserves explicit height while text changes', () => {
  expect(resolveUiLayoutTextboxHeight(150, 28)).toBe(150)
  expect(resolveUiLayoutTextboxHeight(Number.NaN, 56)).toBe(56)
  expect(resolveUiLayoutTextboxTop(150, 28, 'top')).toBe(-75)
  expect(resolveUiLayoutTextboxTop(150, 28, 'middle')).toBe(-14)
  expect(resolveUiLayoutTextboxTop(150, 28, 'bottom')).toBe(47)
})

test('single-line text flattens line breaks and compresses only horizontally', () => {
  expect(normalizeUiSingleLineText('line one\r\nline two\nline three')).toBe('line one line two line three')
  expect(resolveUiSingleLineScale(100, 250)).toBe(0.4)
  expect(resolveUiSingleLineScale(250, 100)).toBe(1)
  expect(resolveUiSingleLineLeft(100, 250, 0.4, 'left')).toBe(-50)
  expect(resolveUiSingleLineLeft(100, 250, 0.4, 'center')).toBe(-50)
  expect(resolveUiSingleLineLeft(120, 250, 0.4, 'right')).toBe(-40)
})
