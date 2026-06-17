import { describe, expect, it } from 'vitest'
import {
  formatModelDisplayLabel,
  normalizeModelOptions,
  sanitizeModelIdForProvider,
} from './model-options'
import type { ProviderSummary } from '../api/client'

describe('model-options', () => {
  const provider: ProviderSummary = {
    id: 'deepseek-claude',
    displayName: 'DeepSeek Claude',
    credentialPresent: true,
    protocol: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    ],
  }

  it('keeps selected model ids unchanged', () => {
    expect(sanitizeModelIdForProvider(provider, 'deepseek-v4-flash')).toBe('deepseek-v4-flash')
  })

  it('normalizes dropdown options with friendly labels', () => {
    const options = normalizeModelOptions(provider, provider.models)
    expect(options).toEqual([
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ])
  })

  describe('formatModelDisplayLabel', () => {
    it('uses API label when it is human-friendly', () => {
      expect(formatModelDisplayLabel('kimi-k2.6', { label: 'Kimi K2.6' })).toBe('Kimi K2.6')
    })

    it('maps known bare ids', () => {
      expect(formatModelDisplayLabel('minimax-m3')).toBe('MiniMax M3')
      expect(formatModelDisplayLabel('deepseek-v4-pro', { label: 'deepseek-v4-pro' })).toBe(
        'DeepSeek V4 Pro',
      )
    })

    it('derives labels from unknown ids', () => {
      expect(formatModelDisplayLabel('unknown-v2')).toBe('Unknown V2')
    })
  })
})
