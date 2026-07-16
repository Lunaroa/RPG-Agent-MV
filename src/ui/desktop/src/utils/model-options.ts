import type { ProviderSummary } from '../api/client'
import type { ModelInputModality } from '@contract/types'

const KNOWN_MODEL_DISPLAY_LABELS: Record<string, string> = {
  'minimax-m3': 'MiniMax M3',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2.5': 'Kimi K2.5',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
}

const BRAND_TOKENS: Record<string, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  kimi: 'Kimi',
}

export type ModelOption = { id: string; label: string; inputModalities?: ModelInputModality[] }

export function sanitizeModelIdForProvider(
  _provider: Pick<ProviderSummary, 'id'> | null | undefined,
  modelId: string,
  _baseUrlOverride?: string | null,
  _providerId?: string | null,
): string {
  return String(modelId || '').trim()
}

function isRawModelLabel(label: string, modelId: string): boolean {
  const trimmed = label.trim()
  return !trimmed || trimmed === modelId
}

function titleCaseFromSlug(modelId: string): string {
  if (!modelId) return modelId
  return modelId
    .split(/[./-]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (BRAND_TOKENS[lower]) return BRAND_TOKENS[lower]
      if (/^v\d/i.test(part)) return part.toUpperCase()
      if (/^m\d/i.test(part)) return part.toUpperCase()
      if (/^k\d/i.test(part)) return part.toUpperCase()
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}

export function formatModelDisplayLabel(
  modelId: string,
  modelEntry?: Pick<ModelOption, 'label'> | null,
): string {
  const id = String(modelId || '').trim()
  const label = modelEntry?.label?.trim()
  if (label && !isRawModelLabel(label, id)) return label
  if (KNOWN_MODEL_DISPLAY_LABELS[id]) return KNOWN_MODEL_DISPLAY_LABELS[id]
  return id ? titleCaseFromSlug(id) : '—'
}

export function normalizeModelOptions(
  _provider: Pick<ProviderSummary, 'id'> | null | undefined,
  models: ModelOption[] | undefined,
  _baseUrlOverride?: string | null,
  _providerId?: string | null,
): ModelOption[] {
  return (models || []).map((model) => {
    const id = sanitizeModelIdForProvider(null, model.id)
    return {
      id,
      label: formatModelDisplayLabel(id, model),
      ...(model.inputModalities ? { inputModalities: [...model.inputModalities] } : {}),
    }
  })
}
