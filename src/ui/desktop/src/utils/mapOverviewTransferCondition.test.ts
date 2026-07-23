import { describe, expect, it } from 'vitest'

import {
  classifyMapOverviewEdgeConditions,
  classifyMapOverviewTransferConditions,
  mapOverviewTransferConditionVisual,
  summarizeMapOverviewTransferConditions,
} from '@contract/map-overview-transfer-condition'

describe('map overview transfer conditions', () => {
  it('recognizes both ordinary switch slots', () => {
    const summary = summarizeMapOverviewTransferConditions({
      switch1Valid: true,
      switch1Id: 9,
      switch2Valid: true,
      switch2Id: 3,
    })
    expect(summary.switchIds).toEqual([3, 9])
    expect(summary.types).toEqual(['switch'])
    expect(classifyMapOverviewTransferConditions({
      switch1Valid: true,
      switch1Id: 9,
      switch2Valid: true,
      switch2Id: 3,
    })).toBe('switch')
  })

  it('reports variable comparison data and self-switch channels', () => {
    expect(summarizeMapOverviewTransferConditions({
      variableValid: true,
      variableId: 7,
      variableValue: 12,
    }).variable).toEqual({ id: 7, operator: '>=', value: 12 })
    expect(classifyMapOverviewTransferConditions({
      selfSwitchValid: true,
      selfSwitchCh: 'C',
    })).toBe('self-switch')
  })

  it('uses combined styling for multiple condition types within or across sources', () => {
    expect(classifyMapOverviewTransferConditions({
      switch1Valid: true,
      switch1Id: 1,
      variableValid: true,
      variableId: 2,
      variableValue: 3,
    })).toBe('combined')
    expect(classifyMapOverviewEdgeConditions([
      { pageConditions: { switch1Valid: true, switch1Id: 1 } },
      { pageConditions: { selfSwitchValid: true, selfSwitchCh: 'A' } },
    ])).toBe('combined')
    expect(mapOverviewTransferConditionVisual('combined')).toMatchObject({
      stroke: '#7b4bb3',
      dashArray: '7 5',
    })
  })

  it('maps ordinary transfers to orange and every single tracked condition type to blue', () => {
    expect(mapOverviewTransferConditionVisual('none').stroke).toBe('#c65f3d')
    expect(mapOverviewTransferConditionVisual('switch').stroke).toBe('#3f6fb5')
    expect(mapOverviewTransferConditionVisual('variable').stroke).toBe('#3f6fb5')
    expect(mapOverviewTransferConditionVisual('self-switch').stroke).toBe('#3f6fb5')
  })

  it('does not describe item or actor page conditions as one of the colored condition types', () => {
    const summary = summarizeMapOverviewTransferConditions({
      itemValid: true,
      itemId: 4,
    })
    expect(summary.types).toEqual([])
    expect(summary.hasOtherPageConditions).toBe(true)
    expect(classifyMapOverviewTransferConditions({
      actorValid: true,
      actorId: 2,
    })).toBe('none')
  })
})
