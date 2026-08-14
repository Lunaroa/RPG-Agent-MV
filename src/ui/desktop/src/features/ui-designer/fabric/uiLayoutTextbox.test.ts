import { expect, test } from 'vitest'
import { resolveUiLayoutTextboxHeight, resolveUiLayoutTextboxTop } from './uiLayoutTextbox'

test('layout textbox preserves explicit height while text changes', () => {
  expect(resolveUiLayoutTextboxHeight(150, 28)).toBe(150)
  expect(resolveUiLayoutTextboxHeight(Number.NaN, 56)).toBe(56)
  expect(resolveUiLayoutTextboxTop(150, 28, 'top')).toBe(-75)
  expect(resolveUiLayoutTextboxTop(150, 28, 'middle')).toBe(-14)
  expect(resolveUiLayoutTextboxTop(150, 28, 'bottom')).toBe(47)
})
