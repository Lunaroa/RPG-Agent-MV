import { describe, expect, it } from 'vitest'

import {
  buildMapOverviewActivePorts,
  mapOverviewEdgeAggregateKey,
  mapOverviewPortLabelGeometry,
  mapOverviewPortKey,
  mapOverviewPortRelative,
  placeMapOverviewPortLabels,
} from './mapOverviewPorts'
import { mapOverviewSvgNodeGeometry } from '@contract/map-overview-svg-geometry'
import type { MapOverviewEdge } from '@contract/types'

describe('mapOverviewPorts', () => {
  it('deduplicates active endpoints and merges their roles and condition colors', () => {
    const nodes = new Map([
      [1, mapOverviewSvgNodeGeometry(
        { id: 1, name: 'Sample A', readState: 'ready', width: 10, height: 8 },
        { x: 100, y: 80 },
      )],
      [2, mapOverviewSvgNodeGeometry(
        { id: 2, name: 'Sample B', readState: 'ready', width: 10, height: 8 },
        { x: 300, y: 80 },
      )],
    ])
    const edges = [
      makeEdge('plain', 1, 2, {}),
      makeEdge('conditioned', 2, 1, { switch1Valid: true, switch1Id: 3 }),
    ]

    const ports = buildMapOverviewActivePorts(edges, new Set(edges.map(edge => edge.id)), nodes)
    const sharedSourceTarget = ports.find(port => port.key === '1:2:3')
    const sharedTargetSource = ports.find(port => port.key === '2:4:5')

    expect(ports).toHaveLength(2)
    expect(sharedSourceTarget).toMatchObject({
      role: 'both',
      category: 'combined',
      point: { x: 70, y: 74 },
    })
    expect(sharedTargetSource).toMatchObject({
      role: 'both',
      category: 'combined',
      point: { x: 294, y: 98 },
    })
  })

  it('keeps source rings and target dots separate when endpoints do not overlap', () => {
    const nodes = new Map([
      [1, mapOverviewSvgNodeGeometry(
        { id: 1, name: 'Sample A', readState: 'ready', width: 10, height: 8 },
        { x: 100, y: 80 },
      )],
      [2, mapOverviewSvgNodeGeometry(
        { id: 2, name: 'Sample B', readState: 'ready', width: 10, height: 8 },
        { x: 300, y: 80 },
      )],
    ])
    const edge = makeEdge('conditioned', 1, 2, { variableValid: true, variableId: 2, variableValue: 1 })

    expect(buildMapOverviewActivePorts([edge], new Set([edge.id]), nodes)).toMatchObject([
      { key: '1:2:3', role: 'source', category: 'variable' },
      { key: '2:4:5', role: 'target', category: 'variable' },
    ])
  })

  it('uses tile centers as relative ports', () => {
    expect(mapOverviewPortRelative(0, 0, 10, 8)).toEqual({ x: 0.05, y: 0.0625 })
    expect(mapOverviewPortRelative(9, 7, 10, 8)).toEqual({ x: 0.95, y: 0.9375 })
    expect(mapOverviewPortKey(3, 4)).toBe('p-3-4')
  })

  it('refuses out-of-bounds coordinates without clamping', () => {
    expect(() => mapOverviewPortRelative(-1, 0, 10, 8)).toThrow(/outside/)
    expect(() => mapOverviewPortRelative(10, 0, 10, 8)).toThrow(/outside/)
    expect(() => mapOverviewPortRelative(0, 8, 10, 8)).toThrow(/outside/)
  })

  it('uses compact coordinate labels that expand for multi-digit coordinates', () => {
    const short = mapOverviewPortLabelGeometry(0, 1)
    const typical = mapOverviewPortLabelGeometry(0, 11)
    const long = mapOverviewPortLabelGeometry(123, 456)

    expect(short).toMatchObject({ text: '0,1', width: 26, height: 14, offsetY: -10 })
    expect(typical).toMatchObject({ text: '0,11', height: 14, offsetY: -10 })
    expect(typical.width).toBeGreaterThan(26)
    expect(long.text).toBe('123,456')
    expect(long.width).toBeGreaterThan(typical.width)
  })

  it('places nearby coordinate labels deterministically without rectangle overlap', () => {
    const inputs = [
      { key: '1:10:10', point: { x: 100, y: 100 }, label: mapOverviewPortLabelGeometry(10, 10) },
      { key: '1:11:10', point: { x: 112, y: 100 }, label: mapOverviewPortLabelGeometry(11, 10) },
      { key: '1:12:10', point: { x: 124, y: 100 }, label: mapOverviewPortLabelGeometry(12, 10) },
    ]
    const first = placeMapOverviewPortLabels(inputs)
    const second = placeMapOverviewPortLabels(inputs)
    expect([...first]).toEqual([...second])
    expect([...first.values()].some(placement => placement.shifted)).toBe(true)

    const rects = inputs.map(input => {
      const placement = first.get(input.key)!
      return {
        left: placement.x - input.label.width / 2,
        right: placement.x + input.label.width / 2,
        top: placement.y + input.label.rectY,
        bottom: placement.y + input.label.rectY + input.label.height,
      }
    })
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const left = rects[leftIndex]
        const right = rects[rightIndex]
        const overlaps = left.left < right.right
          && left.right > right.left
          && left.top < right.bottom
          && left.bottom > right.top
        expect(overlaps).toBe(false)
      }
    }
  })

  it('separates edges by six-field aggregate key including direction and self-loops', () => {
    const a = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 4, targetX: 5, targetY: 6,
    })
    const b = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 4, targetMapId: 4, targetX: 5, targetY: 6,
    })
    const reverse = mapOverviewEdgeAggregateKey({
      sourceMapId: 4, sourceX: 5, sourceY: 6, targetMapId: 1, targetX: 2, targetY: 3,
    })
    const loop = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 1, targetX: 8, targetY: 9,
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(reverse)
    expect(loop).toBe('1:2,3->1:8,9')
    expect(a).toBe('1:2,3->4:5,6')
    expect(reverse).toBe('4:5,6->1:2,3')
  })
})

function makeEdge(
  id: string,
  sourceMapId: number,
  targetMapId: number,
  pageConditions: Record<string, unknown>,
): MapOverviewEdge {
  const sourceX = sourceMapId === 1 ? 2 : 4
  const sourceY = sourceMapId === 1 ? 3 : 5
  const targetX = targetMapId === 1 ? 2 : 4
  const targetY = targetMapId === 1 ? 3 : 5
  return {
    id,
    sourceMapId,
    sourceX,
    sourceY,
    targetMapId,
    targetX,
    targetY,
    count: 1,
    sources: [{
      sourceMapId,
      sourceMapName: `Sample ${sourceMapId}`,
      eventId: 1,
      eventName: 'Sample event',
      pageIndex: 0,
      commandIndex: 0,
      pageConditions,
      sourceX,
      sourceY,
      targetMapId,
      targetX,
      targetY,
      direction: 2,
      fadeType: 0,
    }],
  }
}
