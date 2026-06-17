import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ProviderPatch } from "./provider-registry.ts";
import { writeProviderSeedFile, type ProviderSeedEntry } from "./provider-seeds.ts";

/**
 * 离线导入（开发/构建期工具，非产品运行时路径）。
 *
 * 从 cc-switch **内置供应商预设目录**（`src/config/opencodeProviderPresets.ts`）读取
 * OpenCode CLI 可用的供应商模板，写入产品本地种子库。
 *
 * 不读取 `~/.cc-switch/cc-switch.db` 的 `providers` 表——那是用户已保存的个人配置，
 * 不是 cc-switch「添加供应商」里的预设清单。
 *
 * 纪律：种子文件绝不含 API Key；产品运行时只读本地种子库，不访问 cc-switch。
 */

interface CcSwitchOpencodeOptions {
  baseURL?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  apiToken?: unknown;
}

interface CcSwitchOpencodeSettings {
  npm?: unknown;
  name?: unknown;
  options?: CcSwitchOpencodeOptions;
  models?: Record<string, { name?: unknown } | null | undefined>;
}

export interface CcSwitchOpencodePreset {
  name: string;
  nameKey?: string;
  websiteUrl?: string;
  category?: string;
  settingsConfig: CcSwitchOpencodeSettings;
}

export interface CcSwitchOpencodeCandidate {
  providerId: string;
  patch: ProviderPatch;
}

export interface ReadCcSwitchOpencodeResult {
  sourcePath: string;
  candidates: CcSwitchOpencodeCandidate[];
  skipped: Array<{ providerId: string; reason: string }>;
  errors: Array<{ providerId: string; error: string }>;
}

const PRESET_RELATIVE_PATH = path.join("src", "config", "opencodeProviderPresets.ts");

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugifyProviderId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** cc-switch opencode 供应商 npm 字段 → 产品内部 protocol。不支持的返回 null（显式跳过，不回退）。 */
function protocolFromNpm(npm: string): "openai-compatible" | "anthropic" | null {
  if (npm === "@ai-sdk/openai-compatible" || npm === "@ai-sdk/openai") return "openai-compatible";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  return null;
}

function endsWithVersionSegment(url: string): boolean {
  const last = url.split("/").pop() || "";
  if (!last.startsWith("v")) return false;
  const digits = last.slice(1);
  return digits.length > 0 && /^[0-9]+$/.test(digits);
}

function resolveModelsUrlForPreset(baseUrl: string): string | undefined {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (!trimmed || !endsWithVersionSegment(trimmed)) return undefined;
  return `${trimmed}/models`;
}

function resolveOpencodeEnvVarForPreset(baseUrl: string, protocol: "openai-compatible" | "anthropic"): string {
  if (protocol === "anthropic") return "ANTHROPIC_API_KEY";
  if (/volces\.com|bytepluses\.com/i.test(baseUrl)) return "ARK_API_KEY";
  return "OPENAI_API_KEY";
}

function normalizeModels(models: CcSwitchOpencodeSettings["models"]): Array<{ id: string; label: string }> {
  if (!models || typeof models !== "object") return [];
  const out: Array<{ id: string; label: string }> = [];
  const seen = new Set<string>();
  for (const [rawId, meta] of Object.entries(models)) {
    const id = stringValue(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = meta && typeof meta === "object" ? stringValue(meta.name) : "";
    out.push({ id, label: label || id });
  }
  return out;
}

/**
 * 定位 cc-switch 源码根目录（含 `src/config/opencodeProviderPresets.ts`）。
 * 优先 `CC_SWITCH_ROOT`，其次常见本机 checkout 路径。
 */
export function resolveCcSwitchRoot(explicitRoot?: string): string {
  const fromArg = stringValue(explicitRoot);
  if (fromArg) return assertCcSwitchPresetSource(fromArg);

  const fromEnv = stringValue(process.env.CC_SWITCH_ROOT);
  if (fromEnv) return assertCcSwitchPresetSource(fromEnv);

  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Temp", "opencode", "cc-switch"),
    path.join(os.homedir(), "project", "cc-switch"),
    path.join(os.homedir(), "projects", "cc-switch"),
  ];

  for (const candidate of candidates) {
    const presetPath = path.join(candidate, PRESET_RELATIVE_PATH);
    if (fs.existsSync(presetPath)) return path.resolve(candidate);
  }

  throw new Error(
    `未找到 cc-switch 供应商预设源码（${PRESET_RELATIVE_PATH}）。` +
      "请克隆 cc-switch 仓库或设置环境变量 CC_SWITCH_ROOT 指向其根目录，然后重新运行 dev-import-provider-seeds。",
  );
}

function assertCcSwitchPresetSource(root: string): string {
  const resolved = path.resolve(root);
  const presetPath = path.join(resolved, PRESET_RELATIVE_PATH);
  if (!fs.existsSync(presetPath)) {
    throw new Error(
      `CC_SWITCH_ROOT 无效：未找到供应商预设文件 ${presetPath}。` +
        "请指向 cc-switch 仓库根目录（含 src/config/opencodeProviderPresets.ts）。",
    );
  }
  return resolved;
}

export async function loadCcSwitchOpencodePresets(ccSwitchRoot: string): Promise<CcSwitchOpencodePreset[]> {
  const presetPath = path.join(path.resolve(ccSwitchRoot), PRESET_RELATIVE_PATH);
  const mod = (await import(pathToFileURL(presetPath).href)) as {
    opencodeProviderPresets?: unknown;
  };
  const presets = mod.opencodeProviderPresets;
  if (!Array.isArray(presets)) {
    throw new Error(`cc-switch 预设导出无效（非数组）：${presetPath}`);
  }
  return presets as CcSwitchOpencodePreset[];
}

function buildCandidateFromPreset(preset: CcSwitchOpencodePreset): CcSwitchOpencodeCandidate {
  const settings = preset.settingsConfig;
  if (!settings || typeof settings !== "object") {
    throw new Error("missing-settingsConfig");
  }

  const npm = stringValue(settings.npm);
  const protocol = protocolFromNpm(npm);
  if (!protocol) throw new Error(`unsupported-npm:${npm || "unknown"}`);

  const options = settings.options && typeof settings.options === "object" ? settings.options : {};
  const baseUrl = stringValue(options.baseURL) || stringValue(options.baseUrl);
  if (!baseUrl) throw new Error("missing-baseURL");

  const label = stringValue(settings.name) || stringValue(preset.name);
  if (!label) throw new Error("missing-label");

  const providerId = slugifyProviderId(label);
  if (!providerId) throw new Error("missing-provider-id");

  const envVar = resolveOpencodeEnvVarForPreset(baseUrl, protocol);
  const modelsUrl = resolveModelsUrlForPreset(baseUrl);

  return {
    providerId,
    patch: {
      label,
      protocol,
      baseUrl,
      modelsUrl,
      models: normalizeModels(settings.models),
      supportedEngines: ["opencode"],
      presetKind: "cc-switch-opencode-preset",
      opencodeAuth: { enabled: true, envVar },
    },
  };
}

/** 将 cc-switch 内置 OpenCode 预设列表转为产品种子候选（纯函数，供测试使用）。 */
export function buildCandidatesFromOpencodePresets(
  presets: CcSwitchOpencodePreset[],
): Pick<ReadCcSwitchOpencodeResult, "candidates" | "skipped" | "errors"> {
  const candidates: CcSwitchOpencodeCandidate[] = [];
  const skipped: Array<{ providerId: string; reason: string }> = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  const seenProviderIds = new Set<string>();

  for (const preset of presets) {
    const fallbackId = slugifyProviderId(stringValue(preset.settingsConfig?.name) || stringValue(preset.name) || "preset");
    const category = stringValue(preset.category);
    if (category === "omo" || category === "omo-slim") {
      skipped.push({ providerId: fallbackId, reason: "unsupported-category:omo" });
      continue;
    }

    try {
      const candidate = buildCandidateFromPreset(preset);
      if (seenProviderIds.has(candidate.providerId)) {
        skipped.push({ providerId: candidate.providerId, reason: "duplicate-provider-id" });
        continue;
      }
      seenProviderIds.add(candidate.providerId);
      candidates.push(candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("unsupported-npm:") ||
        message === "missing-baseURL" ||
        message === "missing-settingsConfig" ||
        message === "missing-label" ||
        message === "missing-provider-id"
      ) {
        skipped.push({ providerId: fallbackId, reason: message });
      } else {
        errors.push({ providerId: fallbackId, error: message });
      }
    }
  }

  return { candidates, skipped, errors };
}

/**
 * 读取 cc-switch 内置 OpenCode 供应商预设（非用户 DB 配置）。
 */
export async function readCcSwitchOpencodeProviderCandidates(
  options: { ccSwitchRoot?: string; presets?: CcSwitchOpencodePreset[] } = {},
): Promise<ReadCcSwitchOpencodeResult> {
  const ccSwitchRoot = options.presets ? undefined : resolveCcSwitchRoot(options.ccSwitchRoot);
  const presets = options.presets ?? (await loadCcSwitchOpencodePresets(ccSwitchRoot!));
  const built = buildCandidatesFromOpencodePresets(presets);

  return {
    sourcePath: ccSwitchRoot
      ? path.join(ccSwitchRoot, PRESET_RELATIVE_PATH)
      : "inline-presets",
    ...built,
  };
}

export interface WriteOpencodeProviderSeedResult {
  seedPath: string;
  written: number;
  sourcePath: string;
  skipped: Array<{ providerId: string; reason: string }>;
  errors: Array<{ providerId: string; error: string }>;
}

/**
 * 离线导入入口：把 cc-switch 内置 OpenCode 供应商预设写进本地种子库（key-free）。
 */
export async function writeOpencodeProviderSeedFile(
  workflowRoot: string,
  options: { ccSwitchRoot?: string; presets?: CcSwitchOpencodePreset[] } = {},
): Promise<WriteOpencodeProviderSeedResult> {
  const source = await readCcSwitchOpencodeProviderCandidates(options);
  const providers: ProviderSeedEntry[] = source.candidates.map(({ providerId, patch }) => ({
    id: providerId,
    label: String(patch.label || providerId),
    protocol: patch.protocol,
    baseUrl: String(patch.baseUrl || ""),
    models: (patch.models || []) as ProviderSeedEntry["models"],
    supportedEngines: Array.isArray(patch.supportedEngines) ? patch.supportedEngines.map(String) : undefined,
    opencodeAuth:
      patch.opencodeAuth && typeof patch.opencodeAuth === "object"
        ? {
            enabled: Boolean(patch.opencodeAuth.enabled),
            envVar: patch.opencodeAuth.envVar ? String(patch.opencodeAuth.envVar) : undefined,
          }
        : undefined,
  }));
  const written = writeProviderSeedFile(workflowRoot, providers);
  return {
    seedPath: written.seedPath,
    written: written.written,
    sourcePath: source.sourcePath,
    skipped: source.skipped,
    errors: source.errors,
  };
}
