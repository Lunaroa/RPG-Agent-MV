import type { ProviderSummary } from '../api/client'

export function normalizedHiddenModelIds(provider: Pick<ProviderSummary, 'hiddenModelIds'>): string[] {
  return [...new Set((provider.hiddenModelIds || []).map(String).filter(Boolean))]
}

export function isRawModelVisible(
  provider: Pick<ProviderSummary, 'hiddenModelIds'>,
  modelId: string,
): boolean {
  return !normalizedHiddenModelIds(provider).includes(modelId)
}

export function visibleProviderModels(
  provider: Pick<ProviderSummary, 'models' | 'hiddenModelIds'>,
): Array<{ id: string; label: string }> {
  const hidden = new Set(normalizedHiddenModelIds(provider))
  return (provider.models || []).filter((model) => !hidden.has(model.id))
}

export function hiddenProviderModelCount(
  provider: Pick<ProviderSummary, 'models' | 'hiddenModelIds'>,
): number {
  const modelIds = new Set((provider.models || []).map((model) => model.id))
  return normalizedHiddenModelIds(provider).filter((id) => modelIds.has(id)).length
}

export function hiddenModelIdsAfterToggle(
  provider: Pick<ProviderSummary, 'hiddenModelIds'>,
  modelId: string,
  visible: boolean,
): string[] {
  const hidden = new Set(normalizedHiddenModelIds(provider))
  if (visible) hidden.delete(modelId)
  else hidden.add(modelId)
  return [...hidden]
}

export function hiddenModelIdsForAllModels(
  provider: Pick<ProviderSummary, 'models' | 'hiddenModelIds'>,
): string[] {
  return [...new Set([
    ...normalizedHiddenModelIds(provider),
    ...(provider.models || []).map((model) => model.id),
  ])]
}
