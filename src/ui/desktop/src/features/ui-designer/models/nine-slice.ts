export interface UiNineSliceBorders {
  top: number
  right: number
  bottom: number
  left: number
}

export interface UiNineSliceAxisSegment {
  sourceStart: number
  sourceSize: number
  targetStart: number
  targetSize: number
}

export interface UiNineSliceLayout {
  horizontal: UiNineSliceAxisSegment[]
  vertical: UiNineSliceAxisSegment[]
  borders: UiNineSliceBorders
}

export const normalizeNineSliceBorderValue = (value: unknown, fallback = 0): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return Math.max(0, Math.round(fallback))
  return Math.max(0, Math.round(numeric))
}

const fitBorderPair = (start: number, end: number, limit: number): [number, number] => {
  const safeLimit = Math.max(0, limit)
  const total = start + end
  if (total <= safeLimit || total === 0) return [start, end]
  const ratio = safeLimit / total
  return [start * ratio, end * ratio]
}

const axisSegments = (sourceSize: number, targetSize: number, requestedStart: number, requestedEnd: number): UiNineSliceAxisSegment[] => {
  const safeSource = Math.max(1, sourceSize)
  const safeTarget = Math.max(1, targetSize)
  const [sourceStart, sourceEnd] = fitBorderPair(requestedStart, requestedEnd, safeSource)
  const [targetStart, targetEnd] = fitBorderPair(sourceStart, sourceEnd, safeTarget)
  return [
    { sourceStart: 0, sourceSize: sourceStart, targetStart: -safeTarget / 2, targetSize: targetStart },
    {
      sourceStart,
      sourceSize: Math.max(0, safeSource - sourceStart - sourceEnd),
      targetStart: -safeTarget / 2 + targetStart,
      targetSize: Math.max(0, safeTarget - targetStart - targetEnd),
    },
    {
      sourceStart: safeSource - sourceEnd,
      sourceSize: sourceEnd,
      targetStart: safeTarget / 2 - targetEnd,
      targetSize: targetEnd,
    },
  ]
}

export function resolveNineSliceLayout(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  requested: Partial<UiNineSliceBorders>,
): UiNineSliceLayout {
  const borders = {
    top: normalizeNineSliceBorderValue(requested.top),
    right: normalizeNineSliceBorderValue(requested.right),
    bottom: normalizeNineSliceBorderValue(requested.bottom),
    left: normalizeNineSliceBorderValue(requested.left),
  }
  return {
    horizontal: axisSegments(sourceWidth, targetWidth, borders.left, borders.right),
    vertical: axisSegments(sourceHeight, targetHeight, borders.top, borders.bottom),
    borders,
  }
}
