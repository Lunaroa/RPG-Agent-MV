import { describe, expect, it } from 'vitest'

import {
  mvEffectContentSummary,
  mvSemanticRawSummary,
  mvTraitContentSummary,
} from './rmmvDatabaseSummaries'

describe('stock RM trait content summaries', () => {
  it('formats rate traits with the multiply notation', () => {
    expect(mvTraitContentSummary({ code: 21, dataId: 2, value: 1 }, '攻击力')).toBe('攻击力 * 100%')
    expect(mvTraitContentSummary({ code: 11, dataId: 1, value: 1.5 }, '物理')).toBe('物理 * 150%')
    expect(mvTraitContentSummary({ code: 23, dataId: 9, value: 1 }, '经验获得率')).toBe('经验获得率 * 100%')
  })

  it('formats additive traits with signed values', () => {
    expect(mvTraitContentSummary({ code: 22, dataId: 0, value: 0.95 }, '命中率')).toBe('命中率 + 95%')
    expect(mvTraitContentSummary({ code: 22, dataId: 1, value: -0.05 }, '闪避率')).toBe('闪避率 - 5%')
    expect(mvTraitContentSummary({ code: 32, dataId: 4, value: 1 }, '中毒')).toBe('中毒 + 100%')
    expect(mvTraitContentSummary({ code: 34, dataId: 0, value: 1 }, '')).toBe('+ 1')
    expect(mvTraitContentSummary({ code: 33, dataId: 0, value: -3 }, '')).toBe('- 3')
    expect(mvTraitContentSummary({ code: 61, dataId: 0, value: 1 }, '')).toBe('100%')
  })

  it('shows only the target for flag-like traits', () => {
    expect(mvTraitContentSummary({ code: 14, dataId: 4, value: 0 }, '中毒')).toBe('中毒')
    expect(mvTraitContentSummary({ code: 51, dataId: 2, value: 0 }, '剑')).toBe('剑')
    expect(mvTraitContentSummary({ code: 62, dataId: 1, value: 0 }, '防御')).toBe('防御')
  })
})

describe('stock RM effect content summaries', () => {
  it('formats recovery effects with rate and flat parts', () => {
    expect(mvEffectContentSummary({ code: 11, dataId: 0, value1: 0.2, value2: 100 }, '', 'zh-CN')).toBe('+ 20% + 100')
    expect(mvEffectContentSummary({ code: 11, dataId: 0, value1: 0, value2: 500 }, '', 'zh-CN')).toBe('+ 500')
    expect(mvEffectContentSummary({ code: 12, dataId: 0, value1: 0, value2: 0 }, '', 'zh-CN')).toBe('+ 0')
    expect(mvEffectContentSummary({ code: 13, dataId: 0, value1: 10, value2: 0 }, '', 'zh-CN')).toBe('+ 10')
  })

  it('formats state and buff effects', () => {
    expect(mvEffectContentSummary({ code: 21, dataId: 1, value1: 1, value2: 0 }, '战斗不能', 'zh-CN')).toBe('战斗不能 100%')
    expect(mvEffectContentSummary({ code: 31, dataId: 2, value1: 5, value2: 0 }, '攻击力', 'zh-CN')).toBe('攻击力 5 回合')
    expect(mvEffectContentSummary({ code: 31, dataId: 2, value1: 5, value2: 0 }, 'ATK', 'en-US')).toBe('ATK 5 turns')
    expect(mvEffectContentSummary({ code: 42, dataId: 0, value1: 3, value2: 0 }, '最大 HP', 'zh-CN')).toBe('最大 HP + 3')
  })

  it('handles special and reference-only effects', () => {
    expect(mvEffectContentSummary({ code: 41, dataId: 0, value1: 0, value2: 0 }, '', 'zh-CN')).toBe('逃跑')
    expect(mvEffectContentSummary({ code: 41, dataId: 0, value1: 0, value2: 0 }, '', 'en-US')).toBe('Escape')
    expect(mvEffectContentSummary({ code: 43, dataId: 8, value1: 0, value2: 0 }, '火球', 'zh-CN')).toBe('火球')
    expect(mvEffectContentSummary({ code: 33, dataId: 3, value1: 0, value2: 0 }, '防御力', 'zh-CN')).toBe('防御力')
  })
})

describe('plugin raw summaries', () => {
  it('keeps non-standard codes inspectable', () => {
    expect(mvSemanticRawSummary(99, 7, [1, 2])).toBe('code 99 · dataId 7 · 1 / 2')
  })
})
