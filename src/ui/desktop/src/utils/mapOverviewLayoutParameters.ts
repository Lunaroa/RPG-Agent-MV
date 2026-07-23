import type {
  MapOverviewLayoutId,
  MapOverviewLayoutParametersById,
  MapOverviewLayoutParametersState,
} from '@contract/types'

export type MapOverviewLayoutParameterField =
  | 'horizontalSpacing'
  | 'layerSpacing'
  | 'groupSpacing'
  | 'nodeSpacing'
  | 'repulsion'
  | 'centerGravity'
  | 'linkDistance'
  | 'nodeRepulsion'
  | 'direction'
  | 'columns'
  | 'radius'
  | 'clockwise'
  | 'startAngle'

export type MapOverviewLayoutParameterErrorCode =
  | 'required'
  | 'finite-number'
  | 'integer'
  | 'range'
  | 'choice'

export class MapOverviewLayoutParameterError extends Error {
  readonly field: MapOverviewLayoutParameterField
  readonly code: MapOverviewLayoutParameterErrorCode
  readonly min?: number
  readonly max?: number

  constructor(
    field: MapOverviewLayoutParameterField,
    code: MapOverviewLayoutParameterErrorCode,
    details: { min?: number; max?: number } = {},
  ) {
    super(`Invalid map overview layout parameter ${field}: ${code}.`)
    this.name = 'MapOverviewLayoutParameterError'
    this.field = field
    this.code = code
    this.min = details.min
    this.max = details.max
  }
}

const DEFAULTS: MapOverviewLayoutParametersById = {
  'layered-grid': {
    horizontalSpacing: 24,
    layerSpacing: 48,
    groupSpacing: 96,
  },
  'force-atlas2': {
    nodeSpacing: 24,
    repulsion: 5,
    centerGravity: 1,
  },
  'd3-force': {
    nodeSpacing: 24,
    linkDistance: 50,
    nodeRepulsion: 30,
  },
  'antv-dagre': {
    direction: 'LR',
    nodeSpacing: null,
    layerSpacing: null,
  },
  grid: {
    columns: null,
    nodeSpacing: 24,
  },
  circular: {
    radius: null,
    clockwise: true,
    startAngle: 0,
  },
}

export function defaultMapOverviewLayoutParameters<K extends MapOverviewLayoutId>(
  layoutId: K,
): MapOverviewLayoutParametersById[K] {
  return { ...DEFAULTS[layoutId] }
}

export function parseMapOverviewLayoutParameters<K extends MapOverviewLayoutId>(
  layoutId: K,
  value: unknown,
): MapOverviewLayoutParametersById[K] {
  const input = objectRecord(value)
  let parsed: MapOverviewLayoutParametersById[MapOverviewLayoutId]
  switch (layoutId) {
    case 'layered-grid':
      parsed = {
        horizontalSpacing: requiredNumber(input, 'horizontalSpacing', 8, 256),
        layerSpacing: requiredNumber(input, 'layerSpacing', 8, 256),
        groupSpacing: requiredNumber(input, 'groupSpacing', 32, 512),
      }
      break
    case 'force-atlas2':
      parsed = {
        nodeSpacing: requiredNumber(input, 'nodeSpacing', 8, 256),
        repulsion: requiredNumber(input, 'repulsion', 0.1, 100),
        centerGravity: requiredNumber(input, 'centerGravity', 0, 20),
      }
      break
    case 'd3-force':
      parsed = {
        nodeSpacing: requiredNumber(input, 'nodeSpacing', 8, 256),
        linkDistance: requiredNumber(input, 'linkDistance', 20, 2_000),
        nodeRepulsion: requiredNumber(input, 'nodeRepulsion', 1, 500),
      }
      break
    case 'antv-dagre': {
      const direction = input.direction
      if (direction !== 'LR' && direction !== 'RL' && direction !== 'TB' && direction !== 'BT') {
        throw new MapOverviewLayoutParameterError('direction', 'choice')
      }
      parsed = {
        direction,
        nodeSpacing: optionalNumber(input, 'nodeSpacing', 8, 512),
        layerSpacing: optionalNumber(input, 'layerSpacing', 8, 512),
      }
      break
    }
    case 'grid':
      parsed = {
        columns: optionalNumber(input, 'columns', 1, 100, true),
        nodeSpacing: requiredNumber(input, 'nodeSpacing', 8, 256),
      }
      break
    case 'circular':
      if (typeof input.clockwise !== 'boolean') {
        throw new MapOverviewLayoutParameterError('clockwise', 'choice')
      }
      parsed = {
        radius: optionalNumber(input, 'radius', 100, 100_000),
        clockwise: input.clockwise,
        startAngle: requiredNumber(input, 'startAngle', 0, 359),
      }
      break
    default: {
      const exhaustive: never = layoutId
      throw new Error(`Unknown map overview layout id: ${String(exhaustive)}`)
    }
  }
  return parsed as MapOverviewLayoutParametersById[K]
}

export function normalizeMapOverviewLayoutParametersState(value: unknown): MapOverviewLayoutParametersState {
  const input = objectRecord(value)
  const normalized: MapOverviewLayoutParametersState = {}
  for (const layoutId of Object.keys(DEFAULTS) as MapOverviewLayoutId[]) {
    if (!(layoutId in input)) continue
    try {
      setLayoutParameters(normalized, layoutId, parseMapOverviewLayoutParameters(layoutId, input[layoutId]))
    } catch {
      // Invalid saved parameters are omitted; the caller uses the documented defaults.
    }
  }
  return normalized
}

function setLayoutParameters<K extends MapOverviewLayoutId>(
  target: MapOverviewLayoutParametersState,
  layoutId: K,
  parameters: MapOverviewLayoutParametersById[K],
): void {
  target[layoutId] = parameters as MapOverviewLayoutParametersState[K]
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredNumber(
  input: Record<string, unknown>,
  field: MapOverviewLayoutParameterField,
  min: number,
  max: number,
  integer = false,
): number {
  const value = parseNumber(input[field], field, false)
  return validateNumber(value!, field, min, max, integer)
}

function optionalNumber(
  input: Record<string, unknown>,
  field: MapOverviewLayoutParameterField,
  min: number,
  max: number,
  integer = false,
): number | null {
  const value = parseNumber(input[field], field, true)
  return value == null ? null : validateNumber(value, field, min, max, integer)
}

function parseNumber(
  value: unknown,
  field: MapOverviewLayoutParameterField,
  optional: boolean,
): number | null {
  if (optional && (value == null || value === '')) return null
  if (value == null || value === '') throw new MapOverviewLayoutParameterError(field, 'required')
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw new MapOverviewLayoutParameterError(field, 'finite-number')
  return parsed
}

function validateNumber(
  value: number,
  field: MapOverviewLayoutParameterField,
  min: number,
  max: number,
  integer: boolean,
): number {
  if (integer && !Number.isInteger(value)) throw new MapOverviewLayoutParameterError(field, 'integer')
  if (value < min || value > max) {
    throw new MapOverviewLayoutParameterError(field, 'range', { min, max })
  }
  return value
}
