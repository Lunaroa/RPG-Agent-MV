/** Mirrors backend invocation/resolve profile id rules. */
export function canonicalProfileProviderId(providerId: string, modelId: string): string {
  void modelId
  return String(providerId || '').trim()
}

export function sanitizeProfileModelId(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '-')
}

export function profileIdFromBinding(providerId: string, modelId: string): string {
  const pid = canonicalProfileProviderId(providerId, modelId)
  return `${pid}--${sanitizeProfileModelId(modelId)}`
}
