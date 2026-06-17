import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_THINKING_BUDGET,
  DEEPSEEK_V4_EFFORT,
  MINIMAX_M3_THINKING,
  resolveRegistryThinkingVariants,
  resolveThinkingVariantsForModel,
} from '@contract/model-reasoning-registry'

describe('resolveThinkingVariantsForModel', () => {
  it('MiniMax M3 is adaptive + disabled', () => {
    const variants = resolveThinkingVariantsForModel('minimax', 'MiniMax-M3')
    expect(variants).toEqual(MINIMAX_M3_THINKING)
  })

  it('deepseek-v4-pro has official effort tiers', () => {
    const variants = resolveThinkingVariantsForModel('deepseek', 'deepseek-v4-pro')
    expect(variants).toEqual(DEEPSEEK_V4_EFFORT)
  })

  it('kimi-k2.6 is default-only', () => {
    const variants = resolveThinkingVariantsForModel('kimi', 'kimi-k2.6')
    expect(variants.map((v) => v.id)).toEqual(['default'])
  })

  it('mimo-v2.5-pro exposes Anthropic thinking budget', () => {
    const variants = resolveThinkingVariantsForModel('xiaomi-mimo-token-plan-china', 'mimo-v2.5-pro')
    expect(variants).toEqual(ANTHROPIC_THINKING_BUDGET)
  })

  it('mimo-v2-tts stays default-only', () => {
    const variants = resolveThinkingVariantsForModel('xiaomi-mimo-token-plan-china', 'mimo-v2-tts')
    expect(variants.map((v) => v.id)).toEqual(['default'])
  })

  it('registry profile is detected', () => {
    expect(resolveRegistryThinkingVariants('deepseek', 'deepseek-v4-pro')?.length).toBe(3)
  })
})
