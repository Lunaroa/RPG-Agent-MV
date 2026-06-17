import { describe, expect, test } from 'vitest'
import { formatProviderDisplayName } from './provider-display-name'

describe('formatProviderDisplayName', () => {
  test('strips opencode suffix', () => {
    expect(formatProviderDisplayName('DeepSeek 官方 API（opencode）')).toBe('DeepSeek 官方 API')
  })

  test('strips ascii parenthetical suffix', () => {
    expect(formatProviderDisplayName('Moonshot Kimi (opencode)')).toBe('Moonshot Kimi')
  })

  test('strips compound regional suffix', () => {
    expect(formatProviderDisplayName('MiniMax（opencode · 国内）')).toBe('MiniMax')
  })

  test('strips all trailing parenthetical groups', () => {
    expect(formatProviderDisplayName('Qwen Token Plan（通义套餐）')).toBe('Qwen Token Plan')
  })

  test('preserves name without suffix', () => {
    expect(formatProviderDisplayName('Plain Provider')).toBe('Plain Provider')
  })

  test('handles empty input', () => {
    expect(formatProviderDisplayName('')).toBe('')
    expect(formatProviderDisplayName(null)).toBe('')
  })
})
