import type { UiListNode } from '@contract/ui-designer'

export interface UiListGridLayout {
  columns: number
  rows: number
  columnWidths: number[]
  rowHeights: number[]
  columnGap: number
  rowGap: number
  totalWidth: number
  totalHeight: number
  maxWidth: number
  maxHeight: number
}

export interface UiListGridCell {
  x: number
  y: number
  width: number
  height: number
  overflow: boolean
}

const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export function resolveUiListGridLayout(props: UiListNode['props'], itemCount: number): UiListGridLayout {
  const configuredColumns = Math.max(1, Math.round(finite(props.columns, 1)))
  const configuredRows = Math.max(0, Math.round(finite(props.rows, 0)))
  let columns: number
  let rows: number
  if (props.autoFlow === 'column') {
    rows = configuredRows > 0 ? configuredRows : Math.max(1, Math.ceil(itemCount / configuredColumns))
    columns = Math.max(configuredColumns, Math.ceil(Math.max(itemCount, 1) / rows))
  } else {
    columns = configuredColumns
    rows = Math.max(configuredRows, Math.ceil(itemCount / columns), 1)
  }
  const itemWidth = Math.max(0, finite(props.width, 0))
  const itemHeight = Math.max(0, finite(props.height, 0))
  const configuredColumnWidths = Array.isArray(props.columnWidths) ? props.columnWidths : []
  const configuredRowHeights = Array.isArray(props.rowHeights) ? props.rowHeights : []
  const pickSize = (list: number[], index: number, fallback: number): number =>
    index < list.length && Number.isFinite(list[index]) && list[index] >= 0 ? list[index] : fallback
  const columnWidths = Array.from({ length: columns }, (_, index) => pickSize(configuredColumnWidths, index, itemWidth))
  const rowHeights = Array.from({ length: rows }, (_, index) => pickSize(configuredRowHeights, index, itemHeight))
  const columnGap = Math.max(0, finite(props.columnGap, 0))
  const rowGap = Math.max(0, finite(props.rowGap, 0))
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  let totalWidth = sum(columnWidths) + columnGap * Math.max(0, columns - 1)
  let totalHeight = sum(rowHeights) + rowGap * Math.max(0, rows - 1)
  const maxWidth = Math.max(0, finite(props.maxWidth, 0))
  const maxHeight = Math.max(0, finite(props.maxHeight, 0))
  if (maxWidth > 0) totalWidth = Math.min(totalWidth, maxWidth)
  if (maxHeight > 0) totalHeight = Math.min(totalHeight, maxHeight)
  return { columns, rows, columnWidths, rowHeights, columnGap, rowGap, totalWidth, totalHeight, maxWidth, maxHeight }
}

export function resolveUiListGridCell(props: UiListNode['props'], layout: UiListGridLayout, itemIndex: number): UiListGridCell {
  let column: number
  let row: number
  if (props.autoFlow === 'column') {
    row = itemIndex % layout.rows
    column = Math.floor(itemIndex / layout.rows)
  } else {
    column = itemIndex % layout.columns
    row = Math.floor(itemIndex / layout.columns)
  }
  let x = 0
  let y = 0
  for (let index = 0; index < column; index++) x += layout.columnWidths[index] + layout.columnGap
  for (let index = 0; index < row; index++) y += layout.rowHeights[index] + layout.rowGap
  const width = layout.columnWidths[column]
  const height = layout.rowHeights[row]
  const overflow = (layout.maxWidth > 0 && x + width > layout.maxWidth) || (layout.maxHeight > 0 && y + height > layout.maxHeight)
  return { x, y, width, height, overflow }
}

/** Designer-time grid extent: the runtime item count is unknown, so auto rows (rows=0) display as one row. */
export function resolveUiListGridExtent(props: UiListNode['props']): { width: number; height: number } {
  const configuredColumns = Math.max(1, Math.round(finite(props.columns, 1)))
  const configuredRows = Math.max(1, Math.round(finite(props.rows, 0)))
  const layout = resolveUiListGridLayout(props, Math.max(1, configuredColumns * configuredRows))
  return { width: layout.totalWidth, height: layout.totalHeight }
}
