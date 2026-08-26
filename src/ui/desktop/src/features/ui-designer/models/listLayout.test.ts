import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { UiListNode } from '@contract/ui-designer'
import { resizeUiListGridToExtent, resolveUiListGridCell, resolveUiListGridExtent, resolveUiListGridLayout } from './listLayout'
import { createDefaultNode } from './document'

const listProps = (overrides: Partial<UiListNode['props']> = {}): UiListNode['props'] => ({
  ...createDefaultNode('list').props,
  ...overrides,
})

describe('ui designer list grid layout', () => {
  test('treats width/height as the per-item cell size and derives the grid extent', () => {
    const layout = resolveUiListGridLayout(listProps({ width: 100, height: 40, columns: 2, rows: 0, columnGap: 10, rowGap: 6 }), 5)
    assert.equal(layout.columns, 2)
    assert.equal(layout.rows, 3)
    assert.equal(layout.totalWidth, 210)
    assert.equal(layout.totalHeight, 40 * 3 + 6 * 2)
    const cell = resolveUiListGridCell(listProps({ width: 100, height: 40, columns: 2, columnGap: 10 }), layout, 3)
    assert.deepEqual({ x: cell.x, y: cell.y, width: cell.width, height: cell.height }, { x: 110, y: 46, width: 100, height: 40 })
    assert.equal(cell.overflow, false)
  })

  test('column flow fills down rows first and grows columns as needed', () => {
    const layout = resolveUiListGridLayout(listProps({ width: 50, height: 20, columns: 1, rows: 2, autoFlow: 'column', rowGap: 4 }), 5)
    assert.equal(layout.rows, 2)
    assert.equal(layout.columns, 3)
    const cell = resolveUiListGridCell(listProps({ autoFlow: 'column' }), layout, 3)
    assert.deepEqual({ x: cell.x, y: cell.y }, { x: 58, y: 24 })
  })

  test('columnWidths/rowHeights override per-track sizes and fall back to the item size', () => {
    const props = listProps({ width: 100, height: 40, columns: 3, rows: 0, columnGap: 10, columnWidths: [120, 0] })
    const layout = resolveUiListGridLayout(props, 3)
    assert.deepEqual(layout.columnWidths, [120, 0, 100])
    assert.equal(layout.totalWidth, 120 + 0 + 100 + 20)
    const cell = resolveUiListGridCell(props, layout, 2)
    assert.equal(cell.x, 120 + 10 + 0 + 10)
  })

  test('maxWidth/maxHeight cap the extent and flag overflowing cells', () => {
    const props = listProps({ width: 100, height: 40, columns: 3, rows: 0, columnGap: 10, maxWidth: 250 })
    const layout = resolveUiListGridLayout(props, 3)
    assert.equal(layout.totalWidth, 250)
    assert.equal(resolveUiListGridCell(props, layout, 1).overflow, false)
    assert.equal(resolveUiListGridCell(props, layout, 2).overflow, true)
  })

  test('designer extent shows the configured grid with one auto row when rows is 0', () => {
    const extent = resolveUiListGridExtent(listProps({ width: 80, height: 30, columns: 4, rows: 0, columnGap: 5, rowGap: 5 }))
    assert.deepEqual(extent, { width: 80 * 4 + 5 * 3, height: 30 })
    const fixed = resolveUiListGridExtent(listProps({ width: 80, height: 30, columns: 2, rows: 2, columnGap: 5, rowGap: 5, maxHeight: 50 }))
    assert.deepEqual(fixed, { width: 165, height: 50 })
  })

  test('resizes the outer grid by changing tracks while preserving gaps', () => {
    const props = listProps({ width: 80, height: 30, columns: 3, rows: 2, columnGap: 7, rowGap: 5, maxWidth: 120, maxHeight: 50 })
    const resized = resizeUiListGridToExtent(props, 317, 125)
    const next = { ...props, ...resized }
    assert.equal(next.columnGap, 7)
    assert.equal(next.rowGap, 5)
    assert.deepEqual(resolveUiListGridExtent(next), { width: 317, height: 125 })
    assert.equal(next.columnWidths.reduce((sum, value) => sum + value, 0), 303)
    assert.equal(next.rowHeights.reduce((sum, value) => sum + value, 0), 120)
    assert.equal(next.maxWidth, 317)
    assert.equal(next.maxHeight, 125)
  })
})
