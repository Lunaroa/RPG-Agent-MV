import { DEFAULT_AGENT_EXECUTION_ENGINE } from '@contract/types'
import type { ModelInputModality } from '@contract/types'
import type { ProviderSummary } from '../api/client'
import { useWorkspaceStore } from '../stores/workspace'
import {
  formatModelDisplayLabel,
  normalizeModelOptions,
} from './model-options'
import { formatProviderDisplayName } from './provider-display-name'
import { normalizeStoredThinkingLevel } from '@contract/model-reasoning-registry'
import { isRawModelVisible, visibleProviderModels } from './modelVisibility'

export interface ChatProviderOption {
  id: string
  label: string
  models: Array<{ id: string; label: string; inputModalities?: ModelInputModality[] }>
}

export interface ChatModelSelection {
  providerId: string
  modelId: string
}

export type AgentExecutionEngineId = 'opencode'

export const CHAT_ENGINE_SEGMENT_LABELS: Record<AgentExecutionEngineId, string> = {
  opencode: 'opencode',
}

const LEGACY_SELECTION_STORAGE_KEY = 'rmmv.chat.selection'

type ChatSelectionPersistence = {
  load: (engine: string) => Partial<ChatModelSelection>
  save: (engine: string, selection: ChatModelSelection) => void
}

let chatSelectionPersistence: ChatSelectionPersistence | null = null

export function chatSelectionStorageKey(engine: string): string {
  return `rmmv.chat.model:${engine || DEFAULT_AGENT_EXECUTION_ENGINE}`
}

export function bindEngineChatSelectionPersistence(
  handlers: ChatSelectionPersistence | null,
): void {
  chatSelectionPersistence = handlers
}

function defaultLoadEngineChatSelection(engine: string): Partial<ChatModelSelection> {
  return useWorkspaceStore().readComposerModel(engine)
}

function defaultSaveEngineChatSelection(engine: string, selection: ChatModelSelection): void {
  useWorkspaceStore().patchComposer({ engine, selection })
}

export function loadEngineChatSelection(engine: string): Partial<ChatModelSelection> {
  if (chatSelectionPersistence) return chatSelectionPersistence.load(engine)
  try {
    return defaultLoadEngineChatSelection(engine)
  } catch {
    return {}
  }
}

export function saveEngineChatSelection(engine: string, selection: ChatModelSelection): void {
  if (chatSelectionPersistence) {
    chatSelectionPersistence.save(engine, selection)
    return
  }
  try {
    defaultSaveEngineChatSelection(engine, selection)
  } catch {
    // workspace 未就绪时忽略
  }
}

const LEGACY_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'xhigh'])

/** 移除旧版跨引擎共用的 localStorage 模型选择。 */
export function clearLegacyChatModelLocalStorage(): void {
  try {
    const raw = localStorage.getItem(LEGACY_SELECTION_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { provider?: string; model?: string; thinkingLevel?: string }
    const thinkingLevel = LEGACY_THINKING_LEVELS.has(String(parsed.thinkingLevel || '').trim().toLowerCase())
      ? 'default'
      : parsed.thinkingLevel
    localStorage.setItem(
      LEGACY_SELECTION_STORAGE_KEY,
      JSON.stringify({
        thinkingLevel,
      }),
    )
  } catch {
    try {
      localStorage.removeItem(LEGACY_SELECTION_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

/** 按当前模型官方档位表重置 localStorage 中的推理强度（无效值 → default）。 */
export function resetStoredThinkingLevel(
  providerId: string,
  modelId: string,
  thinkingLevel: string | undefined,
): string {
  return normalizeStoredThinkingLevel(providerId, modelId, thinkingLevel)
}

/** 与设置页「已配置的 API」一致：仅保留已写入凭证的供应商。 */
export function configuredCompatibleProviders(providers: ProviderSummary[]): ProviderSummary[] {
  return providers.filter((p) => p.credentialPresent)
}

export function providerModelsForPicker(provider: ProviderSummary): Array<{ id: string; label: string; inputModalities?: ModelInputModality[] }> {
  if (provider.models?.length) {
    const raw = visibleProviderModels(provider).map((m) => ({
      id: m.id,
      label: m.label || m.id,
      ...(m.inputModalities ? { inputModalities: [...m.inputModalities] } : {}),
    }))
    return normalizeModelOptions(provider, raw)
  }
  if (provider.defaultModel && isRawModelVisible(provider, provider.defaultModel)) {
    const id = provider.defaultModel
    return [{ id, label: formatModelDisplayLabel(id) }]
  }
  return []
}

/** 将兼容供应商转为模型选择器选项（仅已配 Key 且模型未隐藏）。设置页与聊天区共用。 */
export function buildConfiguredModelPickerOptions(
  providers: ProviderSummary[],
): ChatProviderOption[] {
  return toChatProviderOptions(providers)
}

/** 将当前引擎的兼容供应商转为聊天模型选择器选项（仅已配置且有可用模型）。 */
export function toChatProviderOptions(providers: ProviderSummary[]): ChatProviderOption[] {
  return configuredCompatibleProviders(providers)
    .map((p) => {
      const models = providerModelsForPicker(p)
      if (!models.length) return null
      return {
        id: p.id,
        label: formatProviderDisplayName(p.displayName) || p.id,
        models,
      }
    })
    .filter((item): item is ChatProviderOption => item != null)
}

function pickIfValid(
  providers: ChatProviderOption[],
  providerId?: string,
  modelId?: string,
): ChatModelSelection | null {
  if (!providerId) return null
  const provider = providers.find((p) => p.id === providerId)
  if (!provider?.models.length) return null
  const resolvedModelId = modelId && provider.models.some((m) => m.id === modelId)
    ? modelId
    : provider.models[0]?.id
  if (!resolvedModelId) return null
  return { providerId, modelId: resolvedModelId }
}

/**
 * 解析聊天模型选择：workspace 记忆 > settings bindings[engine] > 列表首位。
 */
export function resolveChatModelSelection(
  providers: ChatProviderOption[],
  options: {
    persisted?: Partial<ChatModelSelection>
    binding?: { providerId?: string; modelId?: string } | null
  } = {},
): ChatModelSelection | null {
  if (!providers.length) return null
  const { persisted, binding } = options
  return (
    pickIfValid(providers, persisted?.providerId, persisted?.modelId)
    || pickIfValid(providers, binding?.providerId, binding?.modelId)
    || pickIfValid(providers, providers[0].id, providers[0].models[0]?.id)
  )
}
