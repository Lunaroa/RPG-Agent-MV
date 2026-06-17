import { canonicalProfileProviderId, sanitizeProfileModelId } from "./resolve.ts";
import type { EngineProviderBinding } from "./types.ts";

export function deserializeProfileModelId(canonicalProviderId: string, modelSanitized: string): string {
  void canonicalProviderId;
  const sanitized = String(modelSanitized || "").trim();
  if (!sanitized) return "";
  return sanitized;
}

/**
 * Parse chat/settings profile id (`{provider}--{sanitizedModel}`) back to provider + model binding.
 * Returns null when the id is not in binding form (e.g. legacy static profile names).
 */
export function parseBindingFromProfileId(profileId: string): EngineProviderBinding | null {
  let id = String(profileId || "").trim();
  if (!id) return null;

  if (id.startsWith("opencode-")) {
    id = id.slice("opencode-".length);
  }

  const sep = id.indexOf("--");
  if (sep <= 0) return null;

  const providerPart = id.slice(0, sep);
  const modelSanitized = id.slice(sep + 2);
  if (!modelSanitized) return null;

  const modelId = deserializeProfileModelId(providerPart, modelSanitized);
  if (!modelId) return null;

  return { providerId: providerPart, modelId };
}

/** Resolve session binding: explicit fields > profile id parse > settings binding. */
export function resolveSessionBinding(input: {
  providerId?: string | null;
  modelId?: string | null;
  profileId?: string | null;
  settingsBinding?: EngineProviderBinding | null;
}): EngineProviderBinding | null {
  const explicitProvider = String(input.providerId || "").trim();
  const explicitModel = String(input.modelId || "").trim();
  if (explicitProvider && explicitModel) {
    return { providerId: explicitProvider, modelId: explicitModel };
  }

  const fromProfile = input.profileId ? parseBindingFromProfileId(input.profileId) : null;
  if (fromProfile) return fromProfile;

  const settings = input.settingsBinding;
  if (settings?.providerId && settings?.modelId) {
    return { providerId: settings.providerId, modelId: settings.modelId };
  }

  return null;
}

/** Verify round-trip: binding → profileId → binding (for tests). */
export function bindingMatchesProfileId(
  binding: EngineProviderBinding,
  profileId: string,
): boolean {
  const canonical = canonicalProfileProviderId(binding.providerId, binding.modelId);
  const expected = `${canonical}--${sanitizeProfileModelId(binding.modelId)}`;
  const normalized = String(profileId || "").trim();
  if (normalized === expected) return true;
  if (normalized.startsWith("opencode-")) {
    return normalized.slice("opencode-".length) === expected;
  }
  return false;
}
