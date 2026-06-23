import * as providerRegistry from "../llm/provider-registry.ts";
import { normalizeApiKey } from "../llm/list-models-resolve.ts";
import * as openaiClient from "../llm/client/openai-compatible.ts";
import * as anthropicClient from "../llm/client/anthropic.ts";
import { listTopics } from "./memory-store.ts";
import type { RecalledBody } from "./memory-preamble.ts";

/** The model used for the lightweight recall side-query. Empty ⇒ recall is OFF. */
export interface RecallModelRef {
  providerId: string;
  modelId: string;
}

export interface RecallManifestEntry {
  slug: string;
  name: string;
  description: string;
  type: string;
}

/** Hard cap on how many topic bodies recall pre-loads (Claude Code `findRelevantMemories` parity). */
export const RECALL_MAX = 5;

/** Build the recall manifest from topic frontmatter HEADERS only — never reads bodies. */
export function buildRecallManifest(workflowRoot: string, projectId: string): RecallManifestEntry[] {
  return listTopics(workflowRoot, projectId).map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    type: t.type,
  }));
}

export interface SelectRelevantInput {
  workflowRoot: string;
  manifest: RecallManifestEntry[];
  taskIntent: string;
  recallModel: RecallModelRef | null;
  signal?: AbortSignal;
  /**
   * Slugs already surfaced earlier in this conversation (Claude Code `alreadySurfaced` parity).
   * Excluded from the manifest before the side-query so the model never re-selects them — the
   * agent has already seen those bodies, so re-injecting wastes tokens and noise.
   */
  alreadySurfaced?: string[];
  /** Injectable completion fn (prompt → raw text) for testing; defaults to a provider-backed call. */
  complete?: (prompt: string) => Promise<string>;
}

/**
 * Select up to RECALL_MAX relevant topic slugs for the current task via a lightweight LLM
 * side-query. Recall is OFF (returns []) when no model is configured or the manifest is empty.
 * Topics in `alreadySurfaced` are filtered out before the query (already shown this conversation).
 * Any model/parse error returns [] — the index is still injected, bodies just aren't pre-loaded.
 * There is NO heuristic/keyword fallback (fail-soft to index-only, never fabricate relevance).
 */
export async function selectRelevantTopics(input: SelectRelevantInput): Promise<string[]> {
  const { workflowRoot, taskIntent, recallModel, signal } = input;
  if (!recallModel || !recallModel.providerId || !recallModel.modelId) return [];
  const surfaced = new Set((input.alreadySurfaced || []).map((s) => s.trim()).filter(Boolean));
  const manifest = input.manifest.filter((m) => !surfaced.has(m.slug));
  if (!manifest.length) return [];
  const validSlugs = new Set(manifest.map((m) => m.slug));
  const complete = input.complete || ((prompt: string) => runRecallModel(workflowRoot, recallModel, prompt, signal));
  try {
    const raw = await complete(buildRecallPrompt(manifest, taskIntent));
    return parseSelectedSlugs(raw, validSlugs);
  } catch (err) {
    console.warn("[memory recall] side-query failed; injecting index only:", (err as Error).message);
    return [];
  }
}

/** Load the bodies of the selected topics (path-locked reads via the store), in selection order. */
export function loadRecalledBodies(workflowRoot: string, projectId: string, slugs: string[]): RecalledBody[] {
  if (!slugs.length) return [];
  const bySlug = new Map(listTopics(workflowRoot, projectId).map((t) => [t.slug, t]));
  const out: RecalledBody[] = [];
  for (const slug of slugs) {
    const topic = bySlug.get(slug);
    if (topic && topic.body.trim()) out.push({ slug, name: topic.name, body: topic.body });
  }
  return out;
}

/** Parse the model's reply into a validated, deduped, capped slug list. Pure + exported for tests. */
export function parseSelectedSlugs(raw: string, validSlugs: Set<string>): string[] {
  const text = String(raw || "");
  let arr: unknown = null;
  try {
    arr = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        arr = JSON.parse(match[0]);
      } catch {
        arr = null;
      }
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    const slug = typeof item === "string"
      ? item.trim()
      : item && typeof item === "object"
        ? String((item as Record<string, unknown>).slug || "").trim()
        : "";
    if (!slug || !validSlugs.has(slug) || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= RECALL_MAX) break;
  }
  return out;
}

function buildRecallPrompt(manifest: RecallManifestEntry[], taskIntent: string): string {
  const list = manifest
    .map((m) => `- ${m.slug} — ${m.name}${m.description ? ` — ${m.description}` : ""}`)
    .join("\n");
  return [
    "You are selecting which stored memory notes are relevant to an agent's current task.",
    "",
    "TASK:",
    String(taskIntent || "").trim() || "(no explicit task)",
    "",
    "AVAILABLE MEMORY NOTES (slug — name — description):",
    list,
    "",
    `Return ONLY a JSON array of up to ${RECALL_MAX} slugs (strings), most relevant first, for`,
    "notes that could plausibly help with the TASK. If none are relevant, return [].",
    "Output the JSON array and nothing else — no prose, no explanation, no code fences.",
  ].join("\n");
}

async function runRecallModel(
  workflowRoot: string,
  recallModel: RecallModelRef,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const provider = doc.providers[recallModel.providerId];
  if (!provider) throw new Error(`recall provider not found: ${recallModel.providerId}`);
  const baseUrl = provider.baseUrl;
  const apiKey = normalizeApiKey(provider.credentialValue || "");
  if (!baseUrl) throw new Error("recall provider has no baseUrl configured");
  if (!apiKey) throw new Error("recall provider has no usable credential");
  const messages = [{ role: "user", content: prompt }];

  if (provider.protocol === "anthropic") {
    const payload = await anthropicClient.chat({ baseUrl, apiKey, model: recallModel.modelId, messages, maxTokens: 256, signal });
    return anthropicClient.extractMessageText(payload);
  }
  const payload = await openaiClient.chat({ baseUrl, apiKey, model: recallModel.modelId, messages, maxTokens: 256, signal });
  return extractOpenAiText(payload);
}

function extractOpenAiText(payload: unknown): string {
  const choices = (payload as Record<string, unknown>)?.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  return typeof message?.content === "string" ? message.content : "";
}
