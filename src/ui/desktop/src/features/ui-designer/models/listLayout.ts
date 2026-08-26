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

export type UiListGridResizeProps = Pick<UiListNode['props'], 'width' | 'height' | 'columnWidths' | 'rowHeights' | 'maxWidth' | 'maxHeight'>

const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

const distributeTrackSizes = (source: readonly number[], targetTotal: number): number[] => {
  const count = Math.max(1, source.length)
  const total = Math.max(count, Math.round(targetTotal))
  const remaining = total - count
  const weights = source.map((value) => Math.max(0, finite(value, 0)))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const quotas = weights.map((value) => remaining * (weightTotal > 0 ? value / weightTotal : 1 / count))
  const result = quotas.map((value) => 1 + Math.floor(value))
  let remainder = total - result.reduce((sum, value) => sum + value, 0)
  const order = quotas.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) result[order[index % order.length].index] += 1
  return result
}

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

/** Resize the designer-time outer frame while keeping row/column gaps unchanged. */
export function resizeUiListGridToExtent(props: UiListNode['props'], targetWidth: number, targetHeight: number): UiListGridResizeProps {
  const configuredColumns = Math.max(1, Math.round(finite(props.columns, 1)))
  const configuredRows = Math.max(1, Math.round(finite(props.rows, 0)))
  const layout = resolveUiListGridLayout(props, configuredColumns * configuredRows)
  const horizontalGaps = layout.columnGap * Math.max(0, layout.columns - 1)
  const verticalGaps = layout.rowGap * Math.max(0, layout.rows - 1)
  const columnWidths = distributeTrackSizes(layout.columnWidths, Math.max(layout.columns, targetWidth - horizontalGaps))
  const rowHeights = distributeTrackSizes(layout.rowHeights, Math.max(layout.rows, targetHeight - verticalGaps))
  const resizedWidth = columnWidths.reduce((sum, value) => sum + value, 0) + horizontalGaps
  const resizedHeight = rowHeights.reduce((sum, value) => sum + value, 0) + verticalGaps
  return {
    width: Math.max(1, Math.round(columnWidths.reduce((sum, value) => sum + value, 0) / columnWidths.length)),
    height: Math.max(1, Math.round(rowHeights.reduce((sum, value) => sum + value, 0) / rowHeights.length)),
    columnWidths,
    rowHeights,
    maxWidth: props.maxWidth > 0 ? resizedWidth : 0,
    maxHeight: props.maxHeight > 0 ? resizedHeight : 0,
  }
}
