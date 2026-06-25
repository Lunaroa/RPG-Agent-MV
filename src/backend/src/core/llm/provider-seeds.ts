import fs from "node:fs";
import path from "node:path";

import { resolveShippedPath } from "../workspace-paths.ts";
import { ConsoleSettingsDao } from "../db/dao/console-settings-dao.ts";
import { ProviderDao } from "../db/dao/provider-dao.ts";
import * as providerRegistry from "./provider-registry.ts";
import type { OpencodeAuthConfig, ProviderPatch } from "./provider-registry.ts";

const PROVIDER_SEED_RELATIVE_PATH = path.join("config", "provider-seeds", "providers.json");

export interface ProviderSeedEntry {
  id: string;
  label: string;
  protocol?: string;
  baseUrl: string;
  modelsUrl?: string;
  models?: Array<string | { id: string; label?: string }>;
  supportedEngines?: string[];
  opencodeAuth?: OpencodeAuthConfig;
}

export interface ProviderSeedFile {
  version: number;
  providers: ProviderSeedEntry[];
}

export interface SyncProviderSeedsResult {
  imported: string[];
  skipped: string[];
  errors: Array<{ providerId: string; error: string }>;
  /** 本地种子库文件路径（运行时唯一来源）。 */
  seedPath: string;
  /** 被清理的旧 Claude 格式（anthropic 且无 Key）供应商数量。 */
  clearedCount: number;
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

function normalizeModels(models: ProviderSeedEntry["models"]): NonNullable<ProviderPatch["models"]> {
  const out: NonNullable<ProviderPatch["models"]> = [];
  const seen = new Set<string>();
  for (const model of models || []) {
    const id = typeof model === "string" ? model : stringValue(model?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof model === "string" ? id : stringValue(model.label) || id,
    });
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
      opencodeAuth:
        entry.opencodeAuth && typeof entry.opencodeAuth === "object"
          ? entry.opencodeAuth
          : { enabled: true, envVar: "ANTHROPIC_API_KEY" },
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

/**
 * 从本地种子库（committed 出厂文件）同步供应商到供应商库。完全离线，不读取 cc-switch。
 *
 * - 合并保留已有 Key：种子库不含 Key，已填的 Key 一律保留（不清空）。
 * - 清理旧 Claude 格式种子：删除 anthropic 协议且未填 Key、且不在新种子里的遗留供应商；带 Key 或自定义供应商一律保留。
 */
export async function syncProviderSeeds(workflowRoot: string): Promise<SyncProviderSeedsResult> {
  const seed = readProviderSeedFile(workflowRoot);
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  const seenProviderIds = new Set<string>();
  const seedIds = new Set<string>();

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
    seedIds.add(providerId);
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

  const existing = await providerRegistry.listProviders(workflowRoot);
  let clearedCount = 0;
  for (const provider of existing) {
    if (seedIds.has(provider.id)) continue;
    if (provider.protocol === "anthropic" && !provider.credentialPresent) {
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
    if (Object.keys(patch).length === 0) continue;

    await providerRegistry.upsertProvider(workflowRoot, providerId, patch);
    updated.push(providerId);
  }

  return { updated };
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
