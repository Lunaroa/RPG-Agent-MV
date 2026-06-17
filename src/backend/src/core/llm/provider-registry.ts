import { ProviderDao } from "../db/dao/provider-dao.ts";
import { normalizeApiKey } from "./list-models-resolve.ts";

interface ModelEntry {
  id: string;
  label: string;
}

interface OpencodeAuthConfig {
  enabled?: boolean;
  envVar?: string;
}

interface ProviderRecord {
  label: string;
  protocol: string;
  baseUrl: string;
  /** Override for GET model list; runtime baseUrl unchanged. */
  modelsUrl?: string;
  credentialValue: string;
  models: ModelEntry[];
  hiddenModelIds?: string[];
  supportedEngines?: string[];
  presetKind?: string;
  opencodeAuth?: OpencodeAuthConfig;
  [key: string]: unknown;
}

interface ProviderDocument {
  version: number;
  providers: Record<string, ProviderRecord>;
  profiles: Record<string, unknown>;
}

interface SerializedProvider {
  id: string;
  label: string;
  protocol: string;
  baseUrl: string;
  modelsUrl?: string;
  models: ModelEntry[];
  hiddenModelIds: string[];
  supportedEngines?: string[];
  presetKind?: string;
  opencodeAuth?: OpencodeAuthConfig;
  credentialMask: string;
  credentialPresent: boolean;
}

interface ProviderPatch {
  label?: string;
  protocol?: string;
  baseUrl?: string;
  modelsUrl?: string;
  credentialValue?: string;
  models?: unknown[];
  hiddenModelIds?: unknown[];
  supportedEngines?: string[];
  presetKind?: string;
  opencodeAuth?: Partial<OpencodeAuthConfig> | null;
}

function loadDocument(_workflowRoot: string): ProviderDocument {
  const providers = ProviderDao.list();
  const providerMap: Record<string, ProviderRecord> = {};
  for (const p of providers) {
    providerMap[p.id] = p.config as ProviderRecord;
  }
  return { version: 1, providers: providerMap, profiles: {} };
}

function saveDocument(_workflowRoot: string, document: ProviderDocument): void {
  for (const [id, provider] of Object.entries(document.providers || {})) {
    ProviderDao.upsert(id, provider as Record<string, unknown>);
  }
}

function listProviders(workflowRoot: string): SerializedProvider[] {
  const doc = loadDocument(workflowRoot);
  const out: SerializedProvider[] = [];
  for (const [id, provider] of Object.entries(doc.providers || {})) {
    out.push(serializeProvider(id, provider));
  }
  return out;
}

function getProvider(workflowRoot: string, id: string): SerializedProvider | null {
  const doc = loadDocument(workflowRoot);
  const provider = doc.providers[id];
  if (!provider) return null;
  return serializeProvider(id, provider);
}

function upsertProvider(workflowRoot: string, id: string, patch: ProviderPatch): SerializedProvider {
  if (!id) throw new Error("provider id is required");
  const doc = loadDocument(workflowRoot);
  const previous = doc.providers[id] || {} as ProviderRecord;

  const merged: ProviderRecord = {
    label: pickString(patch.label, previous.label, id),
    protocol: pickString(patch.protocol, previous.protocol, "openai-compatible"),
    baseUrl: pickString(patch.baseUrl, previous.baseUrl, ""),
    modelsUrl: pickString(patch.modelsUrl, previous.modelsUrl, "") || undefined,
    credentialValue: patch.credentialValue !== undefined
      ? normalizeApiKey(String(patch.credentialValue))
      : pickString(previous.credentialValue, ""),
    models: Array.isArray(patch.models) ? normalizeModels(patch.models) : (previous.models || []),
    hiddenModelIds: Array.isArray(patch.hiddenModelIds)
      ? normalizeHiddenModelIds(patch.hiddenModelIds)
      : (previous.hiddenModelIds || []),
    supportedEngines: Array.isArray(patch.supportedEngines)
      ? patch.supportedEngines.map(String)
      : (previous.supportedEngines || undefined),
    presetKind: pickString(patch.presetKind, previous.presetKind, "") || undefined,
    opencodeAuth: patch.opencodeAuth !== undefined
      ? normalizeOpencodeAuth(patch.opencodeAuth, previous.opencodeAuth)
      : previous.opencodeAuth,
  };

  doc.providers[id] = merged;
  saveDocument(workflowRoot, doc);
  return serializeProvider(id, merged);
}

function removeProvider(_workflowRoot: string, id: string): boolean {
  return ProviderDao.delete(id);
}

function serializeModelEntries(models: ModelEntry[] | undefined): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const entry of models || []) {
    if (!entry) continue;
    if (typeof entry === "string") {
      out.push({ id: entry, label: entry });
      continue;
    }
    const id = String(entry.id || "");
    if (!id) continue;
    out.push({ id, label: entry.label ? String(entry.label) : id });
  }
  return out;
}

function serializeProvider(id: string, provider: ProviderRecord): SerializedProvider {
  const credentialValue = provider.credentialValue || "";
  return {
    id,
    label: provider.label || id,
    protocol: provider.protocol || "openai-compatible",
    baseUrl: provider.baseUrl || "",
    modelsUrl: provider.modelsUrl || undefined,
    models: serializeModelEntries(provider.models),
    hiddenModelIds: normalizeHiddenModelIds(provider.hiddenModelIds || []),
    supportedEngines: provider.supportedEngines,
    presetKind: provider.presetKind,
    opencodeAuth: provider.opencodeAuth,
    credentialMask: credentialValue ? maskValue(credentialValue) : "",
    credentialPresent: Boolean(credentialValue)
  };
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function normalizeModels(models: unknown[]): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const m of models) {
    if (!m) continue;
    if (typeof m === "string") {
      out.push({ id: m, label: m });
    } else if (typeof m === "object" && (m as Record<string, unknown>).id) {
      const obj = m as Record<string, unknown>;
      out.push({ id: String(obj.id), label: obj.label ? String(obj.label) : String(obj.id) });
    }
  }
  return out;
}

function normalizeHiddenModelIds(modelIds: unknown[]): string[] {
  return [...new Set(modelIds.map(String).filter(Boolean))];
}

function normalizeOpencodeAuth(
  incoming: Partial<OpencodeAuthConfig> | null | undefined,
  previous: OpencodeAuthConfig | null | undefined,
): OpencodeAuthConfig | undefined {
  if (!incoming || typeof incoming !== "object") return previous || undefined;
  const base = previous && typeof previous === "object" ? previous : { enabled: false };
  return {
    enabled: Boolean(incoming.enabled),
    envVar: pickString(incoming.envVar, base.envVar, "ANTHROPIC_API_KEY"),
  };
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") return v;
  }
  return "";
}

const asyncLoadDocument = (workflowRoot: string): Promise<ProviderDocument> => Promise.resolve(loadDocument(workflowRoot));
const asyncListProviders = (workflowRoot: string): Promise<SerializedProvider[]> => Promise.resolve(listProviders(workflowRoot));
const asyncGetProvider = (workflowRoot: string, id: string): Promise<SerializedProvider | null> => Promise.resolve(getProvider(workflowRoot, id));
const asyncUpsertProvider = (workflowRoot: string, id: string, patch: ProviderPatch): Promise<SerializedProvider> => Promise.resolve(upsertProvider(workflowRoot, id, patch));
const asyncRemoveProvider = (workflowRoot: string, id: string): Promise<boolean> => Promise.resolve(removeProvider(workflowRoot, id));

export type { ModelEntry, OpencodeAuthConfig, ProviderRecord, ProviderDocument, SerializedProvider, ProviderPatch };
export {
  asyncLoadDocument as loadDocument,
  asyncListProviders as listProviders,
  asyncGetProvider as getProvider,
  asyncUpsertProvider as upsertProvider,
  asyncRemoveProvider as removeProvider,
  serializeProvider,
  maskValue
};
