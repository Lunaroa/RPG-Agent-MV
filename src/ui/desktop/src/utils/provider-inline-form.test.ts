import { describe, expect, it } from 'vitest'
import {
  resolveInlineBaseUrl,
  syncInlineFormDraft,
} from './provider-inline-form'
import type { ProviderSummary } from '../api/client'

describe('provider-inline-form', () => {
  const deepseek: ProviderSummary = {
    id: 'deepseek-native',
    displayName: 'DeepSeek',
    credentialPresent: true,
    baseUrl: 'https://api.deepseek.com/v1',
    models: [{ id: 'deepseek-chat', label: 'deepseek-chat' }],
  }

  const anthropic: ProviderSummary = {
    id: 'anthropic-native',
    displayName: 'Anthropic',
    credentialPresent: true,
    baseUrl: 'https://api.anthropic.com',
    models: [{ id: 'claude-sonnet-4-20250514', label: 'Sonnet' }],
  }

  it('syncInlineFormDraft resets credential and loads provider baseUrl', () => {
    expect(syncInlineFormDraft(deepseek)).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      credentialValue: '',
    })
    expect(syncInlineFormDraft(null)).toEqual({ baseUrl: '', credentialValue: '' })
  })

  it('resolveInlineBaseUrl uses draft only for the active provider', () => {
    expect(resolveInlineBaseUrl(deepseek, 'anthropic-native', 'https://api.anthropic.com')).toBe(
      'https://api.deepseek.com/v1',
    )
    expect(resolveInlineBaseUrl(anthropic, 'anthropic-native', 'https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  it('switching active provider draft does not leak URL to DeepSeek', () => {
    let activeId = 'anthropic-native'
    let draft = 'https://api.anthropic.com/v1'
    expect(resolveInlineBaseUrl(deepseek, activeId, draft)).toBe('https://api.deepseek.com/v1')

    activeId = 'deepseek-native'
    draft = syncInlineFormDraft(deepseek).baseUrl
    expect(resolveInlineBaseUrl(deepseek, activeId, draft)).toBe('https://api.deepseek.com/v1')
    expect(resolveInlineBaseUrl(anthropic, activeId, draft)).toBe('https://api.anthropic.com')
  })
})
