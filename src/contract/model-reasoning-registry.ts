/**
 * Shared thinking / reasoning tiers per model (official provider APIs only).
 * Used by backend LLM resolution and desktop UI model picker.
 *
 * `default` = do not send a reasoning/effort parameter upstream.
 *
 * References:
 * - DeepSeek V4: reasoning_effort high|max (api-docs.deepseek.com)
 * - MiniMax M3: thinking.type disabled|adaptive (platform.minimax.io)
 * - Claude / Anthropic: output_config.effort high|max (Anthropic Messages API)
 */

export interface ThinkingVariant {
  id: string;
  label: string;
}

/** DeepSeek V4 official reasoning_effort. */
export const DEEPSEEK_V4_EFFORT: ThinkingVariant[] = [
  { id: "default", label: "默认" },
  { id: "high", label: "high" },
  { id: "max", label: "max" },
];

/** MiniMax M3 official thinking.type (Anthropic-compatible). */
export const MINIMAX_M3_THINKING: ThinkingVariant[] = [
  { id: "default", label: "adaptive" },
  { id: "disabled", label: "disabled" },
];

/** Claude-class effort (Anthropic Messages API output_config.effort). */
export const ANTHROPIC_THINKING_BUDGET: ThinkingVariant[] = [
  { id: "default", label: "默认" },
  { id: "high", label: "high" },
  { id: "max", label: "max" },
];

export const DEFAULT_ONLY_VARIANTS: ThinkingVariant[] = [{ id: "default", label: "默认" }];

/** @deprecated Use DEEPSEEK_V4_EFFORT or ANTHROPIC_THINKING_BUDGET */
export const EFFORT_VARIANTS: ThinkingVariant[] = DEEPSEEK_V4_EFFORT;

export type RegistryRuleExplicit = "multi" | "default-only";

export interface RegistryThinkingRule {
  variants: ThinkingVariant[];
  explicit: RegistryRuleExplicit;
}

interface ReasoningRule {
  provider?: RegExp;
  model: RegExp;
  variants: ThinkingVariant[];
}

/** First match wins — most specific rules first. */
const RULES: ReasoningRule[] = [
  // —— MiniMax ——
  { model: /^minimax-m3$/i, variants: MINIMAX_M3_THINKING },
  { model: /^minimax-m/i, variants: DEFAULT_ONLY_VARIANTS },

  // —— DeepSeek V4 ——
  { model: /deepseek-v4-pro|deepseek-reasoner/i, variants: DEEPSEEK_V4_EFFORT },
  { model: /deepseek-v4-flash/i, variants: DEEPSEEK_V4_EFFORT },
  { model: /deepseek-ai\/deepseek-v3/i, variants: DEFAULT_ONLY_VARIANTS },

  // —— Kimi / Moonshot (no public multi-tier reasoning API) ——
  { model: /^kimi-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^moonshot-v1/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^pro\/moonshotai\/kimi/i, variants: DEFAULT_ONLY_VARIANTS },

  // —— Xiaomi MiMo ——
  { model: /^mimo-v2\.5-pro$/i, variants: ANTHROPIC_THINKING_BUDGET },
  { model: /^mimo-v2/i, variants: DEFAULT_ONLY_VARIANTS },

  // —— Zhipu GLM ——
  { model: /^glm-4\.7|^glm-5/i, variants: ANTHROPIC_THINKING_BUDGET },

  // —— Claude (native + proxies) ——
  { model: /^claude-/i, variants: ANTHROPIC_THINKING_BUDGET },
  { model: /^anthropic\/claude/i, variants: ANTHROPIC_THINKING_BUDGET },

  // —— Aggregator / legacy IDs ——
  { model: /^minimax-m2\.5$/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^minimax-m2\.7$/i, variants: DEFAULT_ONLY_VARIANTS },

  // —— Common chat models (no public effort API) ——
  { model: /^gpt-4o$/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^gpt-5/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^o[0-9]+-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^qwen/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^doubao-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^longcat-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^kat-coder/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^bailing/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^hy3-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^step-/i, variants: DEFAULT_ONLY_VARIANTS },
  { model: /^minimax-text/i, variants: DEFAULT_ONLY_VARIANTS },
];

export function stripRoutingPrefixForThinking(modelId: string): string {
  return String(modelId || "").trim().toLowerCase();
}

function normalizeModelId(modelId: string): string {
  return stripRoutingPrefixForThinking(modelId);
}

function normalizeProviderId(providerId: string): string {
  return String(providerId || "").trim().toLowerCase();
}

function ruleExplicit(variants: ThinkingVariant[]): RegistryRuleExplicit {
  return variants.length > 1 ? "multi" : "default-only";
}

/** Registry lookup with explicit tier policy; null = no static rule. */
export function resolveRegistryThinkingRule(
  providerId: string,
  modelId: string,
): RegistryThinkingRule | null {
  const providerKey = normalizeProviderId(providerId);
  const modelKey = normalizeModelId(modelId);
  if (!modelKey) return null;

  for (const rule of RULES) {
    if (rule.provider && !rule.provider.test(providerKey)) continue;
    if (!rule.model.test(modelKey)) continue;
    const variants = [...rule.variants];
    return { variants, explicit: ruleExplicit(variants) };
  }
  return null;
}

/** Registry lookup; null = no static rule. */
export function resolveRegistryThinkingVariants(
  providerId: string,
  modelId: string,
): ThinkingVariant[] | null {
  const rule = resolveRegistryThinkingRule(providerId, modelId);
  return rule ? rule.variants : null;
}

export function hasRegistryThinkingProfile(providerId: string, modelId: string): boolean {
  return resolveRegistryThinkingRule(providerId, modelId) !== null;
}

/** @deprecated Heuristic ladder removed — registry is SSOT; unknown models are default-only. */
export function modelSupportsThinkingHeuristic(_modelId: string): boolean {
  return false;
}

/** Static registry only; unknown models expose default-only (UI hides strength column). */
export function resolveThinkingVariantsForModel(
  providerId: string,
  modelId: string,
): ThinkingVariant[] {
  const rule = resolveRegistryThinkingRule(providerId, modelId);
  if (rule) return rule.variants;
  return [...DEFAULT_ONLY_VARIANTS];
}

/** Clamp UI / session thinking level; invalid legacy values reset to default. */
export function normalizeThinkingLevel(
  providerId: string,
  modelId: string,
  thinkingLevel: string | null | undefined,
  variants?: ThinkingVariant[],
): string {
  const allowed = variants
    || resolveThinkingVariantsForModel(providerId, modelId);
  const level = String(thinkingLevel || "default").trim().toLowerCase() || "default";
  if (allowed.some((v) => v.id === level)) return level;
  return "default";
}

/** Normalize persisted composer thinking level for the active provider/model binding. */
export function normalizeStoredThinkingLevel(
  providerId: string,
  modelId: string,
  thinkingLevel: string | null | undefined,
): string {
  return normalizeThinkingLevel(providerId, modelId, thinkingLevel);
}
