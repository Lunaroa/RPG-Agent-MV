import fs from "node:fs";
import path from "node:path";

import { resolveShippedPath } from "../workspace-paths.ts";
import { ConsoleSettingsDao } from "../db/dao/console-settings-dao.ts";
import { ProviderDao } from "../db/dao/provider-dao.ts";
import * as providerRegistry from "./provider-registry.ts";
import type { OpencodeAuthConfig, ProviderPatch } from "./provider-registry.ts";
import {
  listOpencodeCatalogProviders,
  type OpencodeCatalogProvider,
} from "../workflow/agent/opencode/catalog.ts";

const PROVIDER_SEED_RELATIVE_PATH = path.join("config", "provider-seeds", "providers.json");

export interface ProviderSeedEntry {
  id: string;
  label: string;
  protocol?: string;
  baseUrl: string;
  modelsUrl?: string;
  models?: Array<string | {
    id: string;
    label?: string;
    inputModalities?: string[];
    limit?: { context?: number; output?: number };
  }>;
  supportedEngines?: string[];
  opencodeAuth?: OpencodeAuthConfig;
  disableModelFetch?: boolean;
}

export interface ProviderSeedFile {
  version: number;
  providers: ProviderSeedEntry[];
}

export interface SyncProviderSeedsResult {
  imported: string[];
  skipped: string[];
  errors: Array<{ providerId: string; error: string }>;
  /** 本地种子库文件路径。 */
  seedPath: string;
  /** 本次从 opencode 目录写入的供应商数量。 */
  catalogCount: number;
  /** 本次从产品种子写入的供应商数量。 */
  seedCount: number;
  /** 被清理的无 Key 且不在 catalog∪seed 中的遗留供应商数量。 */
  clearedCount: number;
}

export interface SyncProviderSeedsDeps {
  listCatalog?: typeof listOpencodeCatalogProviders;
}

export interface EnsureProviderSeedsResult {
  initialized: boolean;
  existingCount: number;
  imported: string[];
  skipped: string[];
  errors: Array<{ providerId: string; error: string }>;
  seedPath: string;
}

export interface WriteProviderSeedFileResult {
  seedPath: string;
  written: number;
}

function seedPath(workflowRoot: string): string {
  return resolveShippedPath(workflowRoot, PROVIDER_SEED_RELATIVE_PATH);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function normalizeModelLimit(value: unknown): { context?: number; output?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const context = positiveInteger(record.context);
  const output = positiveInteger(record.output);
  if (!context && !output) return undefined;
  return {
    ...(context ? { context } : {}),
    ...(output ? { output } : {}),
  };
}

function normalizeModels(models: ProviderSeedEntry["models"]): NonNullable<ProviderPatch["models"]> {
  const out: NonNullable<ProviderPatch["models"]> = [];
  const seen = new Set<string>();
  for (const model of models || []) {
    const id = typeof model === "string" ? model : stringValue(model?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry: Record<string, unknown> = {
      id,
      label: typeof model === "string" ? id : stringValue(model.label) || id,
    };
    const limit = typeof model === "string" ? undefined : normalizeModelLimit(model.limit);
    if (limit) entry.limit = limit;
    if (typeof model !== "string" && Array.isArray(model.inputModalities)) {
      entry.inputModalities = [...new Set(model.inputModalities.map(String).filter(Boolean))];
    }
    out.push(entry);
  }
  return out;
}

function providerSeedToPatch(entry: ProviderSeedEntry): { providerId: string; patch: ProviderPatch } {
  const providerId = stringValue(entry.id);
  if (!providerId) throw new Error("provider seed id is required");
  const label = stringValue(entry.label) || providerId;
  const baseUrl = stringValue(entry.baseUrl);
  if (!baseUrl) throw new Error(`provider seed ${providerId} missing baseUrl`);

  return {
    providerId,
    patch: {
      label,
      protocol: stringValue(entry.protocol) || "anthropic",
      baseUrl,
      modelsUrl: stringValue(entry.modelsUrl) || undefined,
      models: normalizeModels(entry.models),
      supportedEngines: Array.isArray(entry.supportedEngines)
        ? entry.supportedEngines.map(String)
        : undefined,
      presetKind: "product-seed",
      opencodeAuth:
        entry.opencodeAuth && typeof entry.opencodeAuth === "object"
          ? entry.opencodeAuth
          : { enabled: true, envVar: "ANTHROPIC_API_KEY" },
      disableModelFetch: typeof entry.disableModelFetch === "boolean"
        ? entry.disableModelFetch
        : undefined,
    },
  };
}

function clearDeletedProviderBindings(importedProviderIds: Set<string>): void {
  const stored = ConsoleSettingsDao.get("agentExecution");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
  const settings = stored as Record<string, unknown>;
  const bindings = settings.bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return;

  const nextBindings: Record<string, unknown> = {};
  let changed = false;
  for (const [engine, binding] of Object.entries(bindings as Record<string, unknown>)) {
    const providerId = binding && typeof binding === "object"
      ? stringValue((binding as Record<string, unknown>).providerId)
      : "";
    if (providerId && !importedProviderIds.has(providerId)) {
      changed = true;
      continue;
    }
    nextBindings[engine] = binding;
  }

  if (!changed) return;
  const nextSettings: Record<string, unknown> = {
    ...settings,
    bindings: nextBindings,
  };
  delete nextSettings.lastSyncedAt;
  delete nextSettings.claudeDefaultProfileId;
  ConsoleSettingsDao.set("agentExecution", nextSettings);
}

export function readProviderSeedFile(workflowRoot: string): ProviderSeedFile {
  const filePath = seedPath(workflowRoot);
  if (!fs.existsSync(filePath)) {
    throw new Error(`provider seed file not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ProviderSeedFile>;
  if (!Array.isArray(parsed.providers)) {
    throw new Error(`provider seed file must contain providers array: ${filePath}`);
  }
  return {
    version: Number(parsed.version || 1),
    providers: parsed.providers,
  };
}

export function writeProviderSeedFile(
  workflowRoot: string,
  providers: ProviderSeedEntry[],
): WriteProviderSeedFileResult {
  const filePath = seedPath(workflowRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const doc: ProviderSeedFile = {
    version: 1,
    providers: [...providers].sort((a, b) => a.id.localeCompare(b.id)),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return { seedPath: filePath, written: doc.providers.length };
}

function catalogProviderToPatch(
  provider: OpencodeCatalogProvider,
): { providerId: string; patch: ProviderPatch } {
  const providerId = stringValue(provider.id);
  if (!providerId) throw new Error("catalog provider id is required");
  // Some models.dev providers omit api URL (SDK supplies the default at runtime).
  // Still persist the preset so Sync can import the full catalog; user may fill baseUrl later.
  const baseUrl = stringValue(provider.baseUrl);

  const models: NonNullable<ProviderPatch["models"]> = [];
  const seen = new Set<string>();
  for (const model of provider.models || []) {
    const id = stringValue(model.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry: Record<string, unknown> = {
      id,
      label: stringValue(model.label) || id,
    };
    const limit = normalizeModelLimit(model.limit);
    if (limit) entry.limit = limit;
    if (Array.isArray(model.inputModalities)) entry.inputModalities = [...model.inputModalities];
    models.push(entry);
  }

  return {
    providerId,
    patch: {
      label: stringValue(provider.label) || providerId,
      protocol: provider.protocol || "openai-compatible",
      baseUrl,
      models,
      supportedEngines: ["opencode"],
      presetKind: "opencode",
      opencodeAuth: {
        enabled: true,
        envVar: stringValue(provider.envVar)
          || (provider.protocol === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"),
      },
    },
  };
}

async function upsertMergedProvider(
  workflowRoot: string,
  providerId: string,
  patch: ProviderPatch,
): Promise<void> {
  const existing = await providerRegistry.getProvider(workflowRoot, providerId);
  const nextPatch: ProviderPatch = { ...patch };
  if (existing && Array.isArray(patch.models)) {
    nextPatch.models = mergeSeedModels(
      existing.models,
      patch.models as NonNullable<ProviderPatch["models"]>,
    );
  }
  await providerRegistry.upsertProvider(workflowRoot, providerId, nextPatch);
}

/**
 * 同步供应商到本地库：opencode 运行时目录 ∪ 产品种子。
 *
 * - 先写 catalog（含 models[].limit），再写种子（同 id 时种子覆盖产品字段）。
 * - 不传 Key：已填的 credentialValue 一律保留。
 * - models 按 id 合并，不整表盲替换。
 * - 清理：无 Key 且不在 catalog∪seed 中的遗留项。
 * - 拉 catalog 失败则整次失败（不回退成只同步种子）。
 */
export async function syncProviderSeeds(
  workflowRoot: string,
  deps: SyncProviderSeedsDeps = {},
): Promise<SyncProviderSeedsResult> {
  const listCatalog = deps.listCatalog ?? listOpencodeCatalogProviders;
  const catalog = await listCatalog(workflowRoot);
  const seed = readProviderSeedFile(workflowRoot);

  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  const keepIds = new Set<string>();
  let catalogCount = 0;
  let seedCount = 0;

  for (const entry of catalog) {
    const providerId = stringValue(entry.id);
    if (!providerId) {
      skipped.push("");
      continue;
    }
    keepIds.add(providerId);
    try {
      const candidate = catalogProviderToPatch(entry);
      await upsertMergedProvider(workflowRoot, candidate.providerId, candidate.patch);
      imported.push(candidate.providerId);
      catalogCount += 1;
    } catch (error) {
      errors.push({
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const seenSeedIds = new Set<string>();
  for (const entry of seed.providers) {
    const providerId = stringValue(entry.id);
    if (!providerId) {
      skipped.push("");
      continue;
    }
    if (seenSeedIds.has(providerId)) {
      skipped.push(providerId);
      continue;
    }
    seenSeedIds.add(providerId);
    keepIds.add(providerId);
    try {
      const candidate = providerSeedToPatch(entry);
      await upsertMergedProvider(workflowRoot, candidate.providerId, candidate.patch);
      if (!imported.includes(candidate.providerId)) imported.push(candidate.providerId);
      seedCount += 1;
    } catch (error) {
      errors.push({
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const existing = await providerRegistry.listProviders(workflowRoot);
  let clearedCount = 0;
  for (const provider of existing) {
    if (keepIds.has(provider.id)) continue;
    if (!provider.credentialPresent) {
      if (await providerRegistry.removeProvider(workflowRoot, provider.id)) clearedCount += 1;
    }
  }

  const remaining = await providerRegistry.listProviders(workflowRoot);
  clearDeletedProviderBindings(new Set(remaining.map((provider) => provider.id)));

  return {
    imported,
    skipped,
    errors,
    seedPath: seedPath(workflowRoot),
    catalogCount,
    seedCount,
    clearedCount,
  };
}

/**
 * 将种子库里的目录元数据（modelsUrl、opencodeAuth 等）合并进已有供应商，不碰 API Key。
 * 用于升级安装包后补齐 Agent Plan 等预设的拉模型地址，避免旧库缺字段导致 401/404。
 */
export async function refreshProviderSeedCatalogFields(workflowRoot: string): Promise<{ updated: string[] }> {
  const seed = readProviderSeedFile(workflowRoot);
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const updated: string[] = [];

  for (const entry of seed.providers) {
    const providerId = stringValue(entry.id);
    if (!providerId || !doc.providers[providerId]) continue;

    const patch: ProviderPatch = {};
    const modelsUrl = stringValue(entry.modelsUrl);
    if (modelsUrl) patch.modelsUrl = modelsUrl;
    if (entry.opencodeAuth && typeof entry.opencodeAuth === "object") {
      patch.opencodeAuth = entry.opencodeAuth;
    }
    if (typeof entry.disableModelFetch === "boolean") {
      patch.disableModelFetch = entry.disableModelFetch;
    }
    const seedModels = normalizeModels(entry.models);
    if (seedModels.some(modelHasLimit)) {
      patch.models = mergeSeedModels(doc.providers[providerId].models, seedModels);
    }
    if (Object.keys(patch).length === 0) continue;

    await providerRegistry.upsertProvider(workflowRoot, providerId, patch);
    updated.push(providerId);
  }

  return { updated };
}

function modelIdOf(model: unknown): string {
  if (typeof model === "string") return stringValue(model);
  if (model && typeof model === "object" && !Array.isArray(model)) {
    return stringValue((model as Record<string, unknown>).id);
  }
  return "";
}

function modelHasLimit(model: unknown): boolean {
  return Boolean(
    model
    && typeof model === "object"
    && !Array.isArray(model)
    && (model as Record<string, unknown>).limit,
  );
}

function mergeSeedModels(
  existingModels: unknown,
  seedModels: NonNullable<ProviderPatch["models"]>,
): NonNullable<ProviderPatch["models"]> {
  const existing = Array.isArray(existingModels) ? existingModels : [];
  const seedById = new Map<string, Record<string, unknown>>();
  for (const seed of seedModels) {
    const id = modelIdOf(seed);
    if (id && typeof seed === "object" && !Array.isArray(seed)) {
      seedById.set(id, seed as Record<string, unknown>);
    }
  }

  const merged: NonNullable<ProviderPatch["models"]> = [];
  const seen = new Set<string>();
  for (const model of existing) {
    const id = modelIdOf(model);
    if (!id) continue;
    seen.add(id);
    const seed = seedById.get(id);
    if (model && typeof model === "object" && !Array.isArray(model)) {
      const record = model as Record<string, unknown>;
      merged.push({
        ...record,
        ...(seed?.limit ? { limit: seed.limit } : {}),
        ...(seed && Object.hasOwn(seed, 'inputModalities')
          ? { inputModalities: seed.inputModalities }
          : {}),
      });
    } else {
      merged.push(seed ?? { id, label: id });
    }
  }

  for (const seed of seedModels) {
    const id = modelIdOf(seed);
    if (!id || seen.has(id)) continue;
    merged.push(seed);
  }
  return merged;
}

export async function ensureProviderSeedsInitialized(workflowRoot: string): Promise<EnsureProviderSeedsResult> {
  const existingCount = ProviderDao.count();
  if (existingCount > 0) {
    return {
      initialized: false,
      existingCount,
      imported: [],
      skipped: [],
      errors: [],
      seedPath: seedPath(workflowRoot),
    };
  }

  const seed = readProviderSeedFile(workflowRoot);
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  const seenProviderIds = new Set<string>();

  for (const entry of seed.providers) {
    const providerId = stringValue(entry.id);
    if (!providerId) {
      skipped.push("");
      continue;
    }
    if (seenProviderIds.has(providerId)) {
      skipped.push(providerId);
      continue;
    }
    seenProviderIds.add(providerId);
    try {
      const candidate = providerSeedToPatch(entry);
      await providerRegistry.upsertProvider(workflowRoot, candidate.providerId, candidate.patch);
      imported.push(candidate.providerId);
    } catch (error) {
      errors.push({
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to initialize built-in providers: ${errors.map((item) => `${item.providerId}: ${item.error}`).join("; ")}`);
  }

  return {
    initialized: true,
    existingCount,
    imported,
    skipped,
    errors,
    seedPath: seedPath(workflowRoot),
  };
}
