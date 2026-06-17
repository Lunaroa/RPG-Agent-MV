import { describe, expect, it } from 'vitest'
import {
  hiddenProviderModelCount,
  hiddenModelIdsAfterToggle,
  hiddenModelIdsForAllModels,
  isRawModelVisible,
  normalizedHiddenModelIds,
  visibleProviderModels,
} from './modelVisibility'

describe('modelVisibility', () => {
  const provider = {
    models: [
      { id: 'visible', label: 'Visible' },
      { id: 'hidden', label: 'Hidden' },
    ],
    hiddenModelIds: ['hidden', 'hidden', 'removed'],
  }

  it('treats missing or empty hidden ids as all visible', () => {
    expect(visibleProviderModels({ models: provider.models })).toEqual(provider.models)
    expect(visibleProviderModels({ models: provider.models, hiddenModelIds: [] })).toEqual(provider.models)
  })

  it('filters configured models by raw id and ignores removed ids in the count', () => {
    expect(visibleProviderModels(provider)).toEqual([{ id: 'visible', label: 'Visible' }])
    expect(hiddenProviderModelCount(provider)).toBe(1)
    expect(isRawModelVisible(provider, 'hidden')).toBe(false)
  })

  it('keeps newly discovered model ids visible by default', () => {
    expect(visibleProviderModels({
      ...provider,
      models: [...provider.models, { id: 'new-model', label: 'New Model' }],
    })).toEqual([
      { id: 'visible', label: 'Visible' },
      { id: 'new-model', label: 'New Model' },
    ])
  })

  it('normalizes duplicate hidden ids', () => {
    expect(normalizedHiddenModelIds(provider)).toEqual(['hidden', 'removed'])
  })

  it('builds per-model and bulk hidden id updates without losing removed ids', () => {
    expect(hiddenModelIdsAfterToggle(provider, 'visible', false)).toEqual(['hidden', 'removed', 'visible'])
    expect(hiddenModelIdsAfterToggle(provider, 'hidden', true)).toEqual(['removed'])
    expect(hiddenModelIdsForAllModels(provider)).toEqual(['hidden', 'removed', 'visible'])
  })
})
