import { expect, test } from 'vitest'
import { resolveUiContainerLabelLayout } from './uiContainerLabel'

test('container label stays on the same transformed local corner while rotation changes the axis-aligned bounds', () => {
  const layout = resolveUiContainerLabelLayout([
    { x: 140, y: 80 },
    { x: 260, y: 140 },
    { x: 220, y: 220 },
    { x: 100, y: 160 },
  ], 2, 'Container_2')

  expect(layout).toEqual({ left: 140, top: 78, width: 70, fontSize: 6 })
})

test('container label width depends on its name instead of the rotating container bounds', () => {
  const corners = [{ x: 24, y: 32 }, { x: 400, y: 20 }, { x: 420, y: 280 }, { x: 10, y: 300 }]
  expect(resolveUiContainerLabelLayout(corners, 1, 'A').width).toBe(80)
  expect(resolveUiContainerLabelLayout(corners, 1, 'Container_2').width).toBe(140)
})
