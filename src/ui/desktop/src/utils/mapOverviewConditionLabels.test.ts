import { describe, expect, it } from 'vitest'

import { translate } from '../i18n'
import {
  buildMapOverviewConditionNameMaps,
  formatMapOverviewConditionDetails,
  formatMapOverviewEdgeConditionLabel,
} from './mapOverviewConditionLabels'
import { summarizeMapOverviewTransferConditions } from '@contract/map-overview-transfer-condition'

const tZh = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) => (
  translate(key, 'zh-CN', params)
)

describe('map overview condition labels', () => {
  it('prefers switch and variable remarks when present', () => {
    const names = buildMapOverviewConditionNameMaps(
      [{ id: 3, name: '序章完成' }, { id: 9, name: '  ' }],
      [{ id: 7, name: '进度' }],
    )
    const summary = summarizeMapOverviewTransferConditions({
      switch1Valid: true,
      switch1Id: 3,
      switch2Valid: true,
      switch2Id: 9,
      variableValid: true,
      variableId: 7,
      variableValue: 12,
    })
    expect(formatMapOverviewConditionDetails(summary, tZh, names)).toEqual([
      '序章完成 为 ON',
      '开关 #9 为 ON',
      '进度 >= 12',
    ])
  })

  it('falls back to numbered labels when remarks are missing', () => {
    const names = buildMapOverviewConditionNameMaps([], [])
    const summary = summarizeMapOverviewTransferConditions({
      switch1Valid: true,
      switch1Id: 3,
      selfSwitchValid: true,
      selfSwitchCh: 'A',
    })
    expect(formatMapOverviewConditionDetails(summary, tZh, names)).toEqual([
      '开关 #3 为 ON',
      '独立开关 A 为 ON',
    ])
  })

  it('uses concrete condition text on transfer tooltips', () => {
    const names = buildMapOverviewConditionNameMaps([{ id: 3, name: '序章完成' }], [])
    const label = formatMapOverviewEdgeConditionLabel({
      sources: [{
        pageConditions: {
          switch1Valid: true,
          switch1Id: 3,
        },
      }],
    }, tZh, names)
    expect(label).toBe('序章完成 为 ON')
  })

  it('keeps the empty-condition tooltip when no tracked conditions exist', () => {
    const names = buildMapOverviewConditionNameMaps([], [])
    const label = formatMapOverviewEdgeConditionLabel({
      sources: [{
        pageConditions: {
          itemValid: true,
          itemId: 1,
        },
      }],
    }, tZh, names)
    expect(label).toBe('未设置开关、变量或独立开关条件；还包含其他页面条件')
  })
})
