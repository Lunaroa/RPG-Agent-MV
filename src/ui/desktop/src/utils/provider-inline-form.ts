import type { ProviderSummary } from '../api/client'

/** Resolve inline Base URL for a specific card (avoids leaking another provider's draft). */
export function resolveInlineBaseUrl(
  provider: ProviderSummary,
  activeProviderId: string,
  draftBaseUrl: string,
): string {
  const draft = draftBaseUrl.trim()
  if (activeProviderId === provider.id && draft) return draft
  return provider.baseUrl || ''
}

/** Sync draft fields when the user selects or expands a provider card. */
export function syncInlineFormDraft(
  provider: ProviderSummary | null | undefined,
): { baseUrl: string; credentialValue: string } {
  return {
    baseUrl: provider?.baseUrl || '',
    credentialValue: '',
  }
}
