import { describe, expect, it } from 'vitest'

import type { ProviderSummary } from '../api/client'
import { toChatProviderOptions } from './chatProviderOptions'

describe('chat provider image capability metadata', () => {
  it('preserves supported, unsupported, and unknown model states', () => {
    const providers: ProviderSummary[] = [{
      id: 'configured',
      displayName: 'Configured',
      credentialPresent: true,
      models: [
        { id: 'vision', label: 'Vision', inputModalities: ['text', 'image'] },
        { id: 'text', label: 'Text', inputModalities: ['text'] },
        { id: 'custom', label: 'Custom' },
      ],
    }]
    const models = toChatProviderOptions(providers)[0]?.models
    expect(models?.[0]?.inputModalities).toEqual(['text', 'image'])
    expect(models?.[1]?.inputModalities).toEqual(['text'])
    expect(models?.[2]?.inputModalities).toBeUndefined()
  })
})
