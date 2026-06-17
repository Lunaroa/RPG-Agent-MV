import { describe, expect, it, beforeEach } from 'vitest'
import {
  bindEngineChatSelectionPersistence,
  buildConfiguredModelPickerOptions,
  chatSelectionStorageKey,
  configuredCompatibleProviders,
  loadEngineChatSelection,
  providerModelsForPicker,
  resolveChatModelSelection,
  saveEngineChatSelection,
  toChatProviderOptions,
} from './chatProviderOptions'
import type { ProviderSummary } from '../api/client'

describe('chatProviderOptions', () => {
  const providers: ProviderSummary[] = [
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      credentialPresent: true,
      models: [{ id: 'claude-sonnet', label: 'Sonnet' }],
    },
    {
      id: 'preset-a',
      displayName: 'Preset A',
      credentialPresent: false,
      models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
    },
    {
      id: 'custom',
      displayName: 'Custom',
      credentialPresent: true,
      defaultModel: 'my-model',
    },
    {
      id: 'empty',
      displayName: 'Empty',
      credentialPresent: true,
    },
    {
      id: 'deepseek-claude',
      displayName: 'DeepSeek Claude',
      credentialPresent: true,
      models: [{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }],
    },
    {
      id: 'hidden-provider',
      displayName: 'Hidden Provider',
      credentialPresent: true,
      models: [{ id: 'hidden-model', label: 'Hidden Model' }],
      hiddenModelIds: ['hidden-model'],
    },
  ]

  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    bindEngineChatSelectionPersistence({
      load: (engine) => {
        const raw = storage.get(chatSelectionStorageKey(engine))
        return raw ? (JSON.parse(raw) as { providerId?: string; modelId?: string }) : {}
      },
      save: (engine, selection) => {
        storage.set(chatSelectionStorageKey(engine), JSON.stringify(selection))
      },
    })
  })

  it('strips engine suffix from provider labels in chat picker', () => {
    const opencodeProviders: ProviderSummary[] = [{
      id: 'deepseek-claude',
      displayName: 'DeepSeek 官方 API（opencode）',
      credentialPresent: true,
      models: [{ id: 'deepseek-chat', label: 'chat' }],
    }]
    expect(toChatProviderOptions(opencodeProviders)).toEqual([{
      id: 'deepseek-claude',
      label: 'DeepSeek 官方 API',
      models: [{ id: 'deepseek-chat', label: 'chat' }],
    }])
  })

  it('filters to configured providers only', () => {
    expect(configuredCompatibleProviders(providers).map((p) => p.id)).toEqual([
      'anthropic',
      'custom',
      'empty',
      'deepseek-claude',
      'hidden-provider',
    ])
  })

  it('builds models from list or defaultModel', () => {
    expect(providerModelsForPicker(providers[0])).toEqual([
      { id: 'claude-sonnet', label: 'Sonnet' },
    ])
    expect(providerModelsForPicker(providers[2])).toEqual([
      { id: 'my-model', label: 'My Model' },
    ])
    expect(providerModelsForPicker(providers[3])).toEqual([])
  })

  it('formats provider model labels for picker', () => {
    expect(providerModelsForPicker(providers[4])).toEqual([
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ])
  })

  it('filters hidden raw model ids before normalizing picker options', () => {
    expect(providerModelsForPicker(providers[5])).toEqual([])
    expect(providerModelsForPicker({
      id: 'hidden-default',
      defaultModel: 'hidden-model',
      hiddenModelIds: ['hidden-model'],
    })).toEqual([])
  })

  it('maps to chat options excluding unconfigured and model-less', () => {
    expect(toChatProviderOptions(providers)).toEqual([
      {
        id: 'anthropic',
        label: 'Anthropic',
        models: [{ id: 'claude-sonnet', label: 'Sonnet' }],
      },
      {
        id: 'custom',
        label: 'Custom',
        models: [{ id: 'my-model', label: 'My Model' }],
      },
      {
        id: 'deepseek-claude',
        label: 'DeepSeek Claude',
        models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
      },
    ])
  })

  it('buildConfiguredModelPickerOptions matches toChatProviderOptions for settings and chat', () => {
    expect(buildConfiguredModelPickerOptions(providers)).toEqual(toChatProviderOptions(providers))
    expect(buildConfiguredModelPickerOptions(providers).map((p) => p.id)).not.toContain('preset-a')
    expect(buildConfiguredModelPickerOptions(providers).map((p) => p.id)).not.toContain('empty')
    expect(buildConfiguredModelPickerOptions(providers).map((p) => p.id)).not.toContain('hidden-provider')
  })

  it('persists selection per engine in workspace-backed storage', () => {
    expect(chatSelectionStorageKey('opencode')).toBe('rmmv.chat.model:opencode')
    saveEngineChatSelection('opencode', { providerId: 'deepseek', modelId: 'chat' })
    expect(loadEngineChatSelection('opencode')).toEqual({
      providerId: 'deepseek',
      modelId: 'chat',
    })
    expect(loadEngineChatSelection('legacy')).toEqual({})
  })

  it('resolveChatModelSelection prefers persisted then binding', () => {
    const options = toChatProviderOptions(providers)
    saveEngineChatSelection('opencode', { providerId: 'anthropic', modelId: 'claude-sonnet' })
    expect(
      resolveChatModelSelection(options, {
        persisted: loadEngineChatSelection('opencode'),
        binding: { providerId: 'custom', modelId: 'my-model' },
      }),
    ).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet' })

    expect(
      resolveChatModelSelection(options, {
        binding: { providerId: 'custom', modelId: 'my-model' },
      }),
    ).toEqual({ providerId: 'custom', modelId: 'my-model' })

    expect(
      resolveChatModelSelection(options, {
        persisted: { providerId: 'hidden-provider', modelId: 'hidden-model' },
      }),
    ).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet' })
  })
})
