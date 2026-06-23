import { ConsoleSettingsDao } from "../db/dao/console-settings-dao.ts";
import type { RecallModelRef } from "./recall.ts";

/**
 * Backend-owned memory settings, read directly by the dispatch layer AND by the desktop
 * Settings page (via backend core). Stored in `console_settings` under the `memory` key.
 *
 * Phase 2a+ fields only. The old electron-side runtime toggles are a separate,
 * inert stub and are NOT mirrored here.
 */
export interface MemorySettings {
  /** Master switch (记忆总开关). Default ON — preserves Phase 1 behavior. */
  enabled: boolean;
  /** Model for the recall side-query. null ⇒ recall OFF (index injected, bodies not). */
  recallModel: RecallModelRef | null;
  /** Background auto-extraction (Phase 2c). Default OFF — each turn forks a scribe pass when ON. */
  autoExtractEnabled: boolean;
}

const SETTINGS_KEY = "memory";

function normalizeRecallModel(raw: unknown): RecallModelRef | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const providerId = typeof obj.providerId === "string" ? obj.providerId.trim() : "";
  const modelId = typeof obj.modelId === "string" ? obj.modelId.trim() : "";
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export function readMemorySettings(): MemorySettings {
  const raw = ConsoleSettingsDao.get(SETTINGS_KEY) as Partial<MemorySettings> | null;
  return {
    enabled: raw?.enabled !== false, // default true unless explicitly disabled
    recallModel: normalizeRecallModel(raw?.recallModel),
    autoExtractEnabled: raw?.autoExtractEnabled === true, // default false unless explicitly enabled
  };
}

export interface MemorySettingsPatch {
  enabled?: boolean;
  /** Pass null to clear (turn recall off); omit to leave unchanged. */
  recallModel?: RecallModelRef | null;
  autoExtractEnabled?: boolean;
}

export function writeMemorySettings(patch: MemorySettingsPatch): MemorySettings {
  const current = readMemorySettings();
  const next: MemorySettings = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    recallModel: "recallModel" in patch ? normalizeRecallModel(patch.recallModel) : current.recallModel,
    autoExtractEnabled: typeof patch.autoExtractEnabled === "boolean" ? patch.autoExtractEnabled : current.autoExtractEnabled,
  };
  ConsoleSettingsDao.set(SETTINGS_KEY, next);
  return next;
}
