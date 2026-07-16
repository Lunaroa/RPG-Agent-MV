import fs from "fs";
import path from "path";
import { EventContractDao } from "../../db/dao/event-contract-dao.ts";
import { eventContentFingerprint } from "./event-fingerprint.ts";
import { adoptedOrphanPurpose, eventRegistryDefaultDialogue } from "./eventRegistryLocalization.ts";
import { updateMapEvent } from "../map/map-event-edit.ts";
import {
  KNOWN_COMMAND_KINDS,
  COMMAND_KIND_ALIASES,
  normalizeCommands,
  validateCommandSemantics,
} from "../../rmmv/event-page-compiler.ts";
import { validateEventCommandBasic } from "../../rmmv/event-command-registry.ts";
import { inspectRmmvProject } from "../../rmmv/rmmv-layout.ts";
import type { RpgMakerEngine } from "../../rmmv/rpg-maker-engine.ts";

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const SCENE_OR_QUEST_PATTERN = /^[a-z][a-z0-9-]*$/;
const TRIGGER_ENUM = new Set([
  "action-button",
  "player-touch",
  "event-touch",
  "autorun",
  "parallel",
  "none"
]);
const OPERATION_ENUM = new Set(["add-map-event", "add-event-page", "add-common-event"]);
const SELF_SWITCH_ENUM = new Set(["A", "B", "C", "D"]);
const STATUS_ENUM = new Set(["reviewing", "draft", "placed", "verified", "rejected", "abandoned"]);
const AIWF_TOKEN_RE = /AIWF:(?:rid|story|event-contract):/;

function isRpgMakerEngine(value: unknown): value is RpgMakerEngine {
  return value === "rpg-maker-mv" || value === "rpg-maker-mz";
}

function contractEngine(contract: EventContract): RpgMakerEngine {
  return isRpgMakerEngine(contract.engine) ? contract.engine : "rpg-maker-mv";
}

interface RegistryOptions {
  runtimeRoot?: string;
  persist?: boolean;
}

interface RefBlock {
  switches?: { id: number }[];
  variables?: { id: number }[];
  selfSwitches?: { name: string }[];
  [key: string]: unknown;
}

interface RmmvTarget {
  operation: string;
  mapId?: number;
  eventId?: number;
  eventName?: string;
  x?: number;
  y?: number;
  commonEventId?: number;
  trigger?: string;
  [key: string]: unknown;
}

interface PlacementRecord {
  mapId: number;
  eventId: number;
  x: number;
  y: number;
  placedAt?: string;
  /** 放置时对写入地图事件取的内容指纹；对账据此判断玩家是否手改了内容。 */
  contentHash?: string;
  [key: string]: unknown;
}

interface EventContract {
  engine: RpgMakerEngine;
  kind: string;
  /** 自增整数主键（系统分配的稳定身份锚点，不随 id 改名/复用漂移）。 */
  rid?: number;
  id: string;
  purpose: string;
  summary?: string;
  sceneId?: string;
  questline?: string;
  status?: string;
  rmmvTarget: RmmvTarget;
  implementation: {
    commands?: unknown[];
    pages?: unknown[];
    [key: string]: unknown;
  };
  preconditions?: RefBlock;
  effects?: RefBlock;
  placement?: PlacementRecord;
  recordedBy?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ValidationError {
  field: string;
  message: string;
}

interface Conflict {
  code: string;
  message: string;
  otherId: string;
  slotId?: number;
  mapId?: number;
  eventName?: string;
  [key: string]: unknown;
}

interface RegistryFile {
  path: string;
  project: string;
  contracts: EventContract[];
  updatedAt: string | null;
}

interface RegisterResult {
  status: "ok" | "rejected";
  action?: "created" | "updated";
  contract?: EventContract;
  registryPath?: string;
  contractCount?: number;
  reason?: string;
  errors: ValidationError[];
  conflicts: Conflict[];
  hints?: string[];
  normalizedFields?: string[];
}

interface ListResult {
  project: string;
  registryPath: string;
  updatedAt: string | null;
  count: number;
  contracts: {
    rid: number | undefined;
    id: string;
    status: string;
    purpose: string;
    operation: string | undefined;
    mapId: number | undefined;
    eventId: number | undefined;
    x: number | undefined;
    y: number | undefined;
    eventName: string | undefined;
    commonEventId: number | undefined;
    sceneId: string | undefined;
    questline: string | undefined;
  }[];
}

interface ShowResult {
  status: "ok" | "not-found";
  contract?: EventContract;
  contractId?: string;
  registryPath: string;
}

interface Drift {
  contractId?: string;
  rid?: number;
  code: string;
  mapId?: number;
  eventId?: number;
  eventName?: string;
  x?: number;
  y?: number;
  status?: string;
  message?: string;
  commonEventId?: number;
  matchedBy?: string;
  expectedHash?: string;
  actualHash?: string;
  switches?: number[];
  variables?: number[];
  referencedId?: string;
}

interface ReconcileResult {
  project: string;
  registryPath: string;
  dataDir?: string;
  drifts: Drift[];
  driftCount?: number;
  appliedCount?: number;
  status: string;
  message?: string;
}

interface PlacementUpdate {
  mapId: number;
  eventId: number;
  x: number;
  y: number;
  placedAt?: string;
  contentHash?: string;
}

interface PlacementUpdateResult {
  status: "ok" | "not-found";
  contractId: string;
  contract?: EventContract;
  /** reject 时回传被拒前的状态，供 UI 撤回时精确还原。 */
  previousStatus?: string;
  registryPath: string;
}

function defaultStatusForContract(contract: EventContract, existing?: EventContract): string {
  if (contract.status) return contract.status;
  if (existing?.status) return existing.status;
  return contract.rmmvTarget?.operation === "add-map-event" ? "reviewing" : "draft";
}

interface VerificationUpdateResult {
  status: "ok" | "not-found" | "not-placed";
  contractId: string;
  contract?: EventContract;
  registryPath: string;
}

interface MatchedMapEvent {
  id: number;
  name?: string;
  note?: string;
  x?: number;
  y?: number;
  matchedBy: string;
}

interface CliArgs {
  _positional: string[];
  [key: string]: unknown;
}

function isInt(value: unknown): value is number {
  return Number.isInteger(value);
}

function projectName(projectPath: string): string {
  return path.basename(path.resolve(projectPath));
}

function runtimeRoot(options?: RegistryOptions | null): string {
  return options && options.runtimeRoot
    ? path.resolve(options.runtimeRoot)
    : path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "runtime");
}

/** Logical registry scope for CLI messages (SQLite is SSOT; no contracts.json on disk). */
function registryPathFor(projectPath: string, options?: RegistryOptions | null): string {
  return path.join(runtimeRoot(options), "event-registry", projectName(projectPath));
}

function loadRegistry(projectPath: string, options?: RegistryOptions | null): RegistryFile {
  const filePath: string = registryPathFor(projectPath, options);
  const project = projectName(projectPath);
  const rows = EventContractDao.listByProject(project);
  const contracts = rows.map((c) => ({
    ...(c.contract as unknown as EventContract),
    rid: Number.isInteger((c.contract as Record<string, unknown>).rid) ? (c.contract as EventContract).rid : c.rid,
    status: typeof (c.contract as Record<string, unknown>).status === "string"
      ? String((c.contract as Record<string, unknown>).status)
      : c.status,
  }));
  const updatedAt = rows.length > 0 ? rows[rows.length - 1]!.updated_at : null;
  return { path: filePath, project, contracts, updatedAt };
}

/** 当前注册表与 SQLite 全局已用的最大 rid（无则 0）。 */
function maxRid(registry: RegistryFile): number {
  let max = EventContractDao.maxRid();
  for (const c of registry.contracts) {
    if (Number.isInteger(c.rid) && (c.rid as number) > max) max = c.rid as number;
  }
  return max;
}

/**
 * 给注册表里所有缺 rid 的契约分配自增主键（max+1 起，永不复用）。
 * rid 是单一分配口：写进 contract.rid，DAO 再据此显式落 SQLite 主键。
 * 已有 rid 的契约保持不变。
 */
function allocateRids(registry: RegistryFile): void {
  let cursor = EventContractDao.maxRid();
  for (const c of registry.contracts) {
    if (!Number.isInteger(c.rid)) {
      cursor += 1;
      c.rid = cursor;
    }
  }
}

function saveRegistry(registry: RegistryFile): void {
  allocateRids(registry);
  for (const contract of registry.contracts) {
    const existing = EventContractDao.get(contract.id);
    if (existing) {
      EventContractDao.update(contract.id, contract as unknown as Record<string, unknown>, contract.status);
    } else {
      EventContractDao.create(
        contract.id,
        registry.project,
        contract as unknown as Record<string, unknown>,
        contract.status || "draft",
      );
    }
  }
}

function normalizeContractEnvelope(contract: EventContract): { contract: EventContract; normalizedFields: string[] } {
  const normalizedFields: string[] = [];
  const raw = contract as EventContract & { type?: string; contractType?: string };
  const next: EventContract = { ...contract };
  const rawEngine = (contract as unknown as { engine?: unknown }).engine;

  if (rawEngine === undefined || rawEngine === null || rawEngine === "") {
    next.engine = "rpg-maker-mv";
    normalizedFields.push("engine");
  }
  if (next.kind === undefined || next.kind === null || next.kind === "") {
    const alias = raw.type ?? raw.contractType;
    if (typeof alias === "string" && alias.toLowerCase().replace(/_/g, "-") === "event-contract") {
      next.kind = "EventContract";
      normalizedFields.push("kind(from type alias)");
    } else {
      next.kind = "EventContract";
      normalizedFields.push("kind");
    }
  }

  // 命令级确定性归一化：把模型自由发挥的 kind/字段变体重写成编译器规范形态，
  // 让 validate 与落库看到的都是 canonical command（治 schema 一致性这道残余缺口）。
  const impl = next.implementation;
  if (impl && typeof impl === "object") {
    const changed: string[] = [];
    const nextImpl = { ...impl } as typeof impl & { commands?: unknown; pages?: unknown };
    if (Array.isArray(nextImpl.commands)) {
      const r = normalizeCommands(nextImpl.commands);
      nextImpl.commands = r.commands;
      changed.push(...r.changed);
    }
    if (Array.isArray(nextImpl.pages)) {
      nextImpl.pages = (nextImpl.pages as unknown[]).map((page) => {
        if (page && typeof page === "object" && Array.isArray((page as { commands?: unknown }).commands)) {
          const r = normalizeCommands((page as { commands: unknown }).commands);
          changed.push(...r.changed);
          return { ...(page as object), commands: r.commands };
        }
        return page;
      });
    }
    if (changed.length) {
      next.implementation = nextImpl;
      normalizedFields.push(`commands[${[...new Set(changed)].join(", ")}]`);
    }
  }

  return { contract: next, normalizedFields };
}

function buildValidationHints(errors: ValidationError[], normalizedFields: string[] = []): string[] {
  const hints: string[] = [];
  const fields = new Set(errors.map((error) => error.field));

  if (normalizedFields.length > 0) {
    hints.push(
      `Auto-filled missing envelope fields: ${normalizedFields.join(", ")}. `
      + "Always include the selected project's engine and \"kind\": \"EventContract\" at the top of every contract.",
    );
  }

  if (fields.has("engine") || fields.has("kind")) {
    hints.push(
      "Required envelope: { \"engine\": \"rpg-maker-mv\" | \"rpg-maker-mz\", \"kind\": \"EventContract\", ... }. "
      + "Create one with: event-registry scaffold --id <scene.role.beat> --map-id <N> "
      + "--purpose \"...\" --out ../../runtime/out/<task>/contract.json",
    );
  }
  if (fields.has("id")) {
    hints.push("id must be dotted lowercase like village.smith.intro (at least one '.', letters/digits/./-/_ only).");
  }
  if (fields.has("purpose")) {
    hints.push("purpose is a human-readable sentence >= 10 chars (not placeholder text).");
  }
  if (fields.has("implementation") || fields.has("rmmvTarget") || fields.has("rmmvTarget.mapId") || fields.has("rmmvTarget.eventName")) {
    hints.push(
      "Minimal add-map-event shape: rmmvTarget { operation, mapId, eventName, trigger } "
      + "and implementation { commands: [{ kind: \"text\", text: \"...\" }] }. Do not write x/y — placement is manual.",
    );
  }
  if ([...fields].some((field) => field.endsWith(".kind") && field !== "kind")) {
    hints.push(
      "Command kinds must match the compiler whitelist (see rules/tools/patch.md). "
      + "Dialogue is { kind: \"text\", text: \"...\" } (NOT \"show-text\"; face is faceName/faceIndex). "
      + "Change game state with switch / variable / self-switch commands.",
    );
  }

  return hints;
}

function scaffoldContract(options: {
  engine?: RpgMakerEngine;
  id: string;
  mapId: number;
  purpose: string;
  eventName?: string;
  trigger?: string;
  text?: string;
  sceneId?: string;
}): EventContract {
  const eventName = options.eventName?.trim()
    || `EV_${options.id.split(".").map((part) => part.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean).join("_")}`;
  return {
    engine: options.engine ?? "rpg-maker-mv",
    kind: "EventContract",
    id: options.id,
    purpose: options.purpose,
    sceneId: options.sceneId,
    rmmvTarget: {
      operation: "add-map-event",
      mapId: options.mapId,
      eventName,
      trigger: options.trigger || "action-button",
    },
    implementation: {
      commands: [
        { kind: "text", text: options.text || eventRegistryDefaultDialogue() },
      ],
    },
  };
}

function validateContract(contract: EventContract): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!contract || typeof contract !== "object") {
    return [{ field: "<root>", message: "Contract must be a JSON object." }];
  }

  if (!isRpgMakerEngine(contract.engine)) {
    errors.push({ field: "engine", message: 'engine must be "rpg-maker-mv" or "rpg-maker-mz".' });
  }
  if (contract.kind !== "EventContract") {
    errors.push({ field: "kind", message: 'kind must be "EventContract".' });
  }

  if (typeof contract.id !== "string" || !contract.id) {
    errors.push({ field: "id", message: "id is required (non-empty string)." });
  } else {
    if (!ID_PATTERN.test(contract.id)) {
      errors.push({ field: "id", message: `id must match /^[A-Za-z0-9_.:-]+$/. Got: ${contract.id}` });
    }
    if (!contract.id.includes(".")) {
      errors.push({
        field: "id",
        message: "id must use dotted naming like '<scene>.<character>.<purpose>' (at least one '.').",
      });
    }
  }

  if (typeof contract.purpose !== "string" || contract.purpose.trim().length < 10) {
    errors.push({ field: "purpose", message: "purpose is required and must be >= 10 chars after trim." });
  } else {
    const trimmed: string = contract.purpose.trim();
    if (/^(.)\1+$/.test(trimmed.replace(/\s+/g, ""))) {
      errors.push({ field: "purpose", message: "purpose looks like a placeholder (single repeated char)." });
    }
  }

  if (contract.summary !== undefined && contract.summary !== null) {
    if (typeof contract.summary !== "string" || contract.summary.trim().length < 5) {
      errors.push({ field: "summary", message: "summary, if present, must be >= 5 chars." });
    }
  }

  if (contract.sceneId !== undefined && !SCENE_OR_QUEST_PATTERN.test(contract.sceneId || "")) {
    errors.push({ field: "sceneId", message: "sceneId must be kebab-case starting with a letter." });
  }
  if (contract.questline !== undefined && !SCENE_OR_QUEST_PATTERN.test(contract.questline || "")) {
    errors.push({ field: "questline", message: "questline must be kebab-case starting with a letter." });
  }
  if (contract.status !== undefined && !STATUS_ENUM.has(contract.status)) {
    errors.push({ field: "status", message: 'status must be one of "reviewing" / "draft" / "placed" / "verified" / "rejected" / "abandoned".' });
  }
  if (contract.rid !== undefined && (!Number.isInteger(contract.rid) || (contract.rid as number) < 1)) {
    errors.push({ field: "rid", message: "rid, if present, must be a positive integer (system-assigned)." });
  }

  const target = contract.rmmvTarget;
  if (!target || typeof target !== "object") {
    errors.push({ field: "rmmvTarget", message: "rmmvTarget object is required." });
  } else {
    if (!OPERATION_ENUM.has(target.operation)) {
      errors.push({
        field: "rmmvTarget.operation",
        message: `operation must be one of: ${[...OPERATION_ENUM].join(", ")}.`,
      });
    }
    if (target.operation === "add-map-event") {
      if (!Number.isInteger(target.mapId) || (target.mapId as number) < 1) {
        errors.push({ field: "rmmvTarget.mapId", message: "add-map-event requires mapId >= 1." });
      }
      if (typeof target.eventName !== "string" || !target.eventName.trim()) {
        errors.push({ field: "rmmvTarget.eventName", message: "add-map-event requires eventName." });
      }
    } else if (target.operation === "add-event-page") {
      if (!Number.isInteger(target.mapId) || (target.mapId as number) < 1) {
        errors.push({ field: "rmmvTarget.mapId", message: "add-event-page requires mapId >= 1." });
      }
      if (!Number.isInteger(target.eventId) || (target.eventId as number) < 1) {
        errors.push({ field: "rmmvTarget.eventId", message: "add-event-page requires eventId >= 1." });
      }
    } else if (target.operation === "add-common-event") {
      if (!Number.isInteger(target.commonEventId) || (target.commonEventId as number) < 1) {
        errors.push({ field: "rmmvTarget.commonEventId", message: "add-common-event requires commonEventId >= 1." });
      }
    }
    if (target.trigger !== undefined && !TRIGGER_ENUM.has(target.trigger)) {
      errors.push({
        field: "rmmvTarget.trigger",
        message: `trigger must be one of: ${[...TRIGGER_ENUM].join(", ")}.`,
      });
    }
  }

  const impl = contract.implementation;
  if (!impl || typeof impl !== "object") {
    errors.push({ field: "implementation", message: "implementation object is required." });
  } else {
    const hasCommands: boolean = Array.isArray(impl.commands) && impl.commands.length > 0;
    const hasPages: boolean = Array.isArray(impl.pages) && impl.pages.length > 0;
    if (!hasCommands && !hasPages) {
      errors.push({
        field: "implementation",
        message: "implementation must include either commands[] or pages[].",
      });
    }
    if (Array.isArray(impl.commands)) {
      validateCommandKinds(errors, "implementation.commands", impl.commands, contractEngine(contract));
    }
    if (Array.isArray(impl.pages)) {
      impl.pages.forEach((page, i) => {
        const cmds = page && typeof page === "object" ? (page as { commands?: unknown }).commands : undefined;
        if (Array.isArray(cmds)) {
          validateCommandKinds(errors, `implementation.pages[${i}].commands`, cmds, contractEngine(contract));
        }
      });
    }
  }

  validateStateBlock(errors, "preconditions", contract.preconditions);
  validateStateBlock(errors, "effects", contract.effects);

  return errors;
}

function validateStateBlock(errors: ValidationError[], label: string, block?: RefBlock): void {
  if (!block || typeof block !== "object") return;
  for (const key of ["switches", "variables"]) {
    const arr = block[key as keyof RefBlock] as { id: number }[] | undefined;
    if (arr !== undefined) {
      if (!Array.isArray(arr)) {
        errors.push({ field: `${label}.${key}`, message: `${key} must be an array.` });
        continue;
      }
      for (let i = 0; i < arr.length; i++) {
        const ref = arr[i];
        if (!ref || typeof ref !== "object" || !Number.isInteger(ref.id) || ref.id < 1) {
          errors.push({ field: `${label}.${key}[${i}].id`, message: "Each ref needs an integer id >= 1." });
        }
      }
    }
  }
  if (block.selfSwitches !== undefined) {
    if (!Array.isArray(block.selfSwitches)) {
      errors.push({ field: `${label}.selfSwitches`, message: "selfSwitches must be an array." });
    } else {
      for (let i = 0; i < block.selfSwitches.length; i++) {
        const ref = block.selfSwitches[i];
        if (!ref || typeof ref !== "object" || !SELF_SWITCH_ENUM.has(ref.name)) {
          errors.push({ field: `${label}.selfSwitches[${i}].name`, message: 'name must be "A" / "B" / "C" / "D".' });
        }
      }
    }
  }
}

/**
 * 校验与编译器一致的状态命令和条件分支语义，
 * 避免注册通过、拖到地图编译时才暴露字段或取值错误。
 */
function validateCommandFields(
  errors: ValidationError[],
  field: string,
  kind: string,
  cmd: Record<string, unknown>,
  engine: RpgMakerEngine,
): void {
  for (const issue of validateCommandSemantics(kind, cmd, engine)) {
    errors.push({
      field: issue.field ? `${field}.${issue.field}` : field,
      message: issue.message,
    });
  }
}

/**
 * 递归校验命令 `kind` 是否在编译器白名单内（含 conditional-branch / choice / loop 的嵌套命令）。
 * 这是「治本」：写错 kind（如 show-text）在 validate/register 当场报错并给出正确写法，
 * 不再骗过验证、注册成功、拖到放置时才抛 "Unsupported command kind"。
 */
function validateCommandKinds(errors: ValidationError[], label: string, commands: unknown[], engine: RpgMakerEngine): void {
  commands.forEach((raw, i) => {
    const field = `${label}[${i}]`;
    if (!raw || typeof raw !== "object") {
      errors.push({ field, message: "Each command must be an object." });
      return;
    }
    const cmd = raw as Record<string, unknown>;
    const kind = cmd.kind;
    if (typeof kind !== "string" || !kind) {
      errors.push({ field: `${field}.kind`, message: "command.kind is required (non-empty string)." });
      return;
    }
    if (!KNOWN_COMMAND_KINDS.has(kind)) {
      const alias = COMMAND_KIND_ALIASES[kind];
      errors.push({
        field: `${field}.kind`,
        message: `Unknown command kind "${kind}". ${alias ? `Did you mean "${alias}"? ` : ""}`
          + `Allowed kinds: ${[...KNOWN_COMMAND_KINDS].join(", ")}.`,
      });
    } else {
      validateCommandFields(errors, field, kind, cmd, engine);
    }
    if (kind === "raw-command" || kind === "mv-command" || kind === "mz-command") {
      try {
        if (kind === "mv-command" && engine !== "rpg-maker-mv") {
          throw new Error("mv-command cannot be used in an RPG Maker MZ contract.");
        }
        if (kind === "mz-command" && engine !== "rpg-maker-mz") {
          throw new Error("mz-command cannot be used in an RPG Maker MV contract.");
        }
        validateEventCommandBasic({
          code: cmd.code,
          indent: cmd.indent,
          parameters: cmd.parameters,
        }, field, engine);
      } catch (err) {
        errors.push({
          field,
          message: err instanceof Error ? err.message : "Invalid raw RPG Maker command.",
        });
      }
    }
    // 嵌套结构里的命令也要校验，否则错 kind 藏在分支/选项/循环里仍会漏到放置阶段。
    if (kind === "conditional-branch") {
      const then = (cmd.then ?? cmd.commands) as unknown;
      if (Array.isArray(then)) validateCommandKinds(errors, `${field}.then`, then, engine);
      if (Array.isArray(cmd.else)) validateCommandKinds(errors, `${field}.else`, cmd.else as unknown[], engine);
    } else if (kind === "loop") {
      if (Array.isArray(cmd.commands)) validateCommandKinds(errors, `${field}.commands`, cmd.commands as unknown[], engine);
    } else if (kind === "choice") {
      if (Array.isArray(cmd.choices)) {
        (cmd.choices as unknown[]).forEach((choice, j) => {
          const nested = choice && typeof choice === "object" ? (choice as { commands?: unknown }).commands : undefined;
          if (Array.isArray(nested)) validateCommandKinds(errors, `${field}.choices[${j}].commands`, nested, engine);
        });
      }
      if (Array.isArray(cmd.cancelCommands)) validateCommandKinds(errors, `${field}.cancelCommands`, cmd.cancelCommands as unknown[], engine);
    } else if (kind === "battle") {
      if (Array.isArray(cmd.onWin)) validateCommandKinds(errors, `${field}.onWin`, cmd.onWin as unknown[], engine);
      if (Array.isArray(cmd.onEscape)) validateCommandKinds(errors, `${field}.onEscape`, cmd.onEscape as unknown[], engine);
      if (Array.isArray(cmd.onLose)) validateCommandKinds(errors, `${field}.onLose`, cmd.onLose as unknown[], engine);
    }
  });
}

function detectConflicts(contract: EventContract, existing: EventContract[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const incomingId: string = contract.id;
  const target: RmmvTarget = contract.rmmvTarget || {} as RmmvTarget;
  const effects: RefBlock = contract.effects || {};
  const incomingSwitches: number[] = (effects.switches || []).map((ref) => ref.id);
  const incomingVariables: number[] = (effects.variables || []).map((ref) => ref.id);

  for (const other of existing) {
    if (other.id === incomingId) continue;
    const otherEffects: RefBlock = other.effects || {};
    const otherSwitches: number[] = (otherEffects.switches || []).map((ref) => ref.id);
    const otherVariables: number[] = (otherEffects.variables || []).map((ref) => ref.id);
    const otherTarget: RmmvTarget = other.rmmvTarget || {} as RmmvTarget;

    for (const sid of incomingSwitches) {
      if (otherSwitches.includes(sid)) {
        conflicts.push({
          code: "switch-write-write",
          message: `Switch id ${sid} effect overlaps with already-registered ${other.id}.`,
          otherId: other.id,
          slotId: sid,
        });
      }
    }
    for (const vid of incomingVariables) {
      if (otherVariables.includes(vid)) {
        conflicts.push({
          code: "variable-write-write",
          message: `Variable id ${vid} effect overlaps with already-registered ${other.id}.`,
          otherId: other.id,
          slotId: vid,
        });
      }
    }
    if (target.operation === "add-map-event" && otherTarget.operation === "add-map-event") {
      if (target.mapId === otherTarget.mapId && target.eventName && target.eventName === otherTarget.eventName) {
        conflicts.push({
          code: "duplicate-event-name",
          message: `Map ${target.mapId} already has event name "${target.eventName}" registered as ${other.id}.`,
          otherId: other.id,
          mapId: target.mapId,
          eventName: target.eventName,
        });
      }
    }
    if (target.operation === "add-event-page" && otherTarget.operation === "add-event-page") {
      if (target.mapId === otherTarget.mapId && target.eventId === otherTarget.eventId) {
        conflicts.push({
          code: "duplicate-event-page",
          message: `Map ${target.mapId} event ${target.eventId} page already claimed by ${other.id}.`,
          otherId: other.id,
        });
      }
    }
    if (target.operation === "add-common-event" && otherTarget.operation === "add-common-event") {
      if (target.commonEventId === otherTarget.commonEventId) {
        conflicts.push({
          code: "duplicate-common-event",
          message: `Common event ${target.commonEventId} already claimed by ${other.id}.`,
          otherId: other.id,
        });
      }
    }
  }
  return conflicts;
}

async function validateContractFile(
  contract: EventContract,
  options?: { skipNormalize?: boolean; projectPath?: string },
): Promise<RegisterResult> {
  const normalized = options?.skipNormalize
    ? { contract, normalizedFields: [] as string[] }
    : normalizeContractEnvelope(contract);
  const errors: ValidationError[] = validateContract(normalized.contract);
  if (options?.projectPath && errors.length === 0) {
    const projectEngine = inspectRmmvProject(options.projectPath).engine;
    if (normalized.contract.engine !== projectEngine) {
      errors.push({
        field: "engine",
        message: `Contract engine ${normalized.contract.engine} does not match project engine ${projectEngine}.`,
      });
    }
  }
  if (errors.length) {
    return {
      status: "rejected",
      reason: "schema",
      errors,
      conflicts: [],
      hints: buildValidationHints(errors, normalized.normalizedFields),
      normalizedFields: normalized.normalizedFields,
    };
  }
  return {
    status: "ok",
    contract: normalized.contract,
    errors: [],
    conflicts: [],
    hints: normalized.normalizedFields.length
      ? buildValidationHints([], normalized.normalizedFields)
      : undefined,
    normalizedFields: normalized.normalizedFields,
  };
}

async function registerContract(projectPath: string, contract: EventContract, options?: RegistryOptions): Promise<RegisterResult> {
  const normalized = normalizeContractEnvelope(contract);
  const errors: ValidationError[] = validateContract(normalized.contract);
  if (errors.length === 0) {
    const projectEngine = inspectRmmvProject(projectPath).engine;
    if (normalized.contract.engine !== projectEngine) {
      errors.push({
        field: "engine",
        message: `Contract engine ${normalized.contract.engine} does not match project engine ${projectEngine}.`,
      });
    }
  }
  if (errors.length) {
    return {
      status: "rejected",
      reason: "schema",
      errors,
      conflicts: [],
      hints: buildValidationHints(errors, normalized.normalizedFields),
      normalizedFields: normalized.normalizedFields,
    };
  }
  const contractToStore = normalized.contract;
  const registry = loadRegistry(projectPath, options);
  const conflicts: Conflict[] = detectConflicts(contractToStore, registry.contracts);
  if (conflicts.length) {
    return { status: "rejected", reason: "conflict", errors: [], conflicts };
  }
  const existingIndex: number = registry.contracts.findIndex((c) => c.id === contractToStore.id);
  const existing = existingIndex >= 0 ? registry.contracts[existingIndex] : undefined;
  const stored: EventContract = {
    ...contractToStore,
    // rid 是稳定身份：重新登记同一契约时必须沿用已分配的 rid，不可重新分配。
    ...(Number.isInteger(contractToStore.rid) ? {} : existing?.rid !== undefined ? { rid: existing.rid } : {}),
    status: defaultStatusForContract(contractToStore, existing),
    recordedBy: {
      ...(contractToStore.recordedBy || {}),
      registeredAt: new Date().toISOString(),
    },
  };
  let action: "created" | "updated";
  if (existingIndex >= 0) {
    registry.contracts[existingIndex] = stored;
    action = "updated";
  } else {
    registry.contracts.push(stored);
    action = "created";
  }
  if (!options || options.persist !== false) {
    saveRegistry(registry);
  }
  return {
    status: "ok",
    action,
    contract: stored,
    registryPath: registry.path,
    contractCount: registry.contracts.length,
    errors: [],
    conflicts: [],
    normalizedFields: normalized.normalizedFields.length ? normalized.normalizedFields : undefined,
    hints: normalized.normalizedFields.length
      ? buildValidationHints([], normalized.normalizedFields)
      : undefined,
  };
}

async function listContracts(projectPath: string, options?: RegistryOptions): Promise<ListResult> {
  const registry = loadRegistry(projectPath, options);
  return {
    project: registry.project,
    registryPath: registry.path,
    updatedAt: registry.updatedAt,
    count: registry.contracts.length,
    contracts: registry.contracts.map((c) => ({
      rid: c.rid,
      id: c.id,
      status: c.status || "draft",
      purpose: c.purpose,
      operation: c.rmmvTarget && c.rmmvTarget.operation,
      mapId: c.rmmvTarget && c.rmmvTarget.mapId,
      eventId: c.rmmvTarget && c.rmmvTarget.eventId,
      x: c.rmmvTarget && c.rmmvTarget.x,
      y: c.rmmvTarget && c.rmmvTarget.y,
      eventName: c.rmmvTarget && c.rmmvTarget.eventName,
      commonEventId: c.rmmvTarget && c.rmmvTarget.commonEventId,
      sceneId: c.sceneId,
      questline: c.questline,
    })),
  };
}

/** rid 标记串：放置事件 note 里首选的耐久锚点。 */
function ridToken(contract: EventContract): string | null {
  return Number.isInteger(contract.rid) ? `AIWF:rid:${contract.rid}` : null;
}

function contractNoteTokens(contract: EventContract): string[] {
  const tokens: string[] = [];
  const rt = ridToken(contract);
  if (rt) tokens.push(rt);
  tokens.push(`AIWF:event-contract:${contract.id}`, `AIWF:story:${contract.id}`);
  if (contract.sceneId) tokens.push(`AIWF:story:${contract.sceneId}`);
  return [...new Set(tokens)];
}

function toMatched(event: Record<string, unknown>, matchedBy: string): MatchedMapEvent {
  return {
    id: event.id as number,
    name: typeof event.name === "string" ? event.name : undefined,
    note: typeof event.note === "string" ? event.note : undefined,
    x: isInt(event.x) ? event.x : undefined,
    y: isInt(event.y) ? event.y : undefined,
    matchedBy,
  };
}

/**
 * 把契约对应到地图事件。优先级（防失联三重锚点）：
 *   ① AIWF:rid:<rid> 标记  → ② placement.eventId 锚点（已放置且同图）
 *   → ③ 旧 AIWF:story/event-contract:<contractId> 标记  → ④ eventName 兜底
 * 这样玩家删了备注、agent 改了 contractId，都不会断链。
 */
function matchMapEvent(contract: EventContract, events: unknown[]): MatchedMapEvent | null {
  const typed = events
    .filter(Boolean)
    .map((event) => event as Record<string, unknown>)
    .filter((event) => isInt(event.id));

  // ① rid 标记
  const rt = ridToken(contract);
  if (rt) {
    const byRid = typed.find((e) => typeof e.note === "string" && (e.note as string).includes(rt));
    if (byRid) return toMatched(byRid, "rid-token");
  }

  // ② placement.eventId 锚点（仅当 placement 与当前 target 同图时可信）
  const placement = contract.placement;
  const target = contract.rmmvTarget || {} as RmmvTarget;
  if (placement && isInt(placement.eventId) && placement.mapId === target.mapId) {
    const byAnchor = typed.find((e) => e.id === placement.eventId);
    if (byAnchor) return toMatched(byAnchor, "placement-eventId");
  }

  // ③ 旧 contractId / sceneId 标记
  const tokens = contractNoteTokens(contract);
  for (const event of typed) {
    const note = typeof event.note === "string" ? event.note : "";
    const token = tokens.find((item) => note.includes(item));
    if (token) return toMatched(event, token);
  }

  // ④ eventName 兜底
  if (target.eventName) {
    const byName = typed.find((event) => event.name === target.eventName);
    if (byName) return toMatched(byName, "eventName");
  }
  return null;
}

function updateContractPlacement(
  projectPath: string,
  contractId: string,
  placement: PlacementUpdate,
  options?: RegistryOptions,
): PlacementUpdateResult {
  const registry = loadRegistry(projectPath, options);
  const index = registry.contracts.findIndex((c) => c.id === contractId);
  if (index < 0) {
    return { status: "not-found", contractId, registryPath: registry.path };
  }
  const contract = registry.contracts[index];
  const placedAt = placement.placedAt || new Date().toISOString();
  const hasHash = typeof placement.contentHash === "string" && placement.contentHash.length > 0;
  const next: EventContract = {
    ...contract,
    status: "placed",
    rmmvTarget: {
      ...(contract.rmmvTarget || {} as RmmvTarget),
      operation: contract.rmmvTarget?.operation || "add-map-event",
      mapId: placement.mapId,
      eventId: placement.eventId,
      x: placement.x,
      y: placement.y,
    },
    placement: {
      mapId: placement.mapId,
      eventId: placement.eventId,
      x: placement.x,
      y: placement.y,
      placedAt,
      ...(hasHash ? { contentHash: placement.contentHash } : {}),
    },
    recordedBy: {
      ...(contract.recordedBy || {}),
      placedAt,
      ...(hasHash ? { contentHashAt: placedAt } : {}),
    },
  };
  registry.contracts[index] = next;
  saveRegistry(registry);
  return { status: "ok", contractId, contract: next, registryPath: registry.path };
}

function verifyContract(
  projectPath: string,
  contractId: string,
  evidence: Record<string, unknown>,
  options?: RegistryOptions,
): VerificationUpdateResult {
  const registry = loadRegistry(projectPath, options);
  const index = registry.contracts.findIndex((contract) => contract.id === contractId);
  if (index < 0) return { status: "not-found", contractId, registryPath: registry.path };
  const contract = registry.contracts[index];
  if (!contract.placement || !isInt(contract.placement.eventId)) {
    return { status: "not-placed", contractId, contract, registryPath: registry.path };
  }
  const verifiedAt = new Date().toISOString();
  const next: EventContract = {
    ...contract,
    status: "verified",
    validation: {
      ...((contract.validation as Record<string, unknown> | undefined) || {}),
      verificationEvidence: evidence,
      verifiedAt,
    },
    recordedBy: {
      ...(contract.recordedBy || {}),
      verifiedAt,
    },
  };
  registry.contracts[index] = next;
  saveRegistry(registry);
  return { status: "ok", contractId, contract: next, registryPath: registry.path };
}

async function showContract(projectPath: string, contractId: string, options?: RegistryOptions): Promise<ShowResult> {
  const registry = loadRegistry(projectPath, options);
  const contract = registry.contracts.find((c) => c.id === contractId);
  if (!contract) {
    return { status: "not-found", contractId, registryPath: registry.path };
  }
  const { contract: normalized } = normalizeContractEnvelope(contract);
  return { status: "ok", contract: normalized, registryPath: registry.path };
}

/** 抽取契约声明的 state writer（开关/变量 id）。 */
function effectWriters(contract: EventContract): { switches: number[]; variables: number[] } {
  const e: RefBlock = contract.effects || {};
  return {
    switches: (e.switches || []).map((r) => r.id).filter(isInt),
    variables: (e.variables || []).map((r) => r.id).filter(isInt),
  };
}

function hasWriters(w: { switches: number[]; variables: number[] }): boolean {
  return w.switches.length > 0 || w.variables.length > 0;
}

interface MapReconcileEntry {
  mapId: number;
  mapFile: string;
  events: Record<string, unknown>[];
  claimed: Set<number>;
}

async function reconcile(
  projectPath: string,
  options?: RegistryOptions & { apply?: boolean; orphans?: boolean },
): Promise<ReconcileResult> {
  const registry = loadRegistry(projectPath, options);
  const drifts: Drift[] = [];
  let appliedCount = 0;
  const projectRoot: string = path.resolve(projectPath);
  const dataDir: string | null = findDataDir(projectRoot);
  if (!dataDir) {
    return {
      project: registry.project,
      registryPath: registry.path,
      status: "no-data-dir",
      message: "Could not locate www/data or data/ in project; skipped reconciliation.",
      drifts: [],
    };
  }

  const mapCache = new Map<number, MapReconcileEntry | null>();
  function loadMapEntry(mapId: number): MapReconcileEntry | null {
    if (mapCache.has(mapId)) return mapCache.get(mapId)!;
    const mapFile: string = path.join(dataDir!, `Map${String(mapId).padStart(3, "0")}.json`);
    if (!fs.existsSync(mapFile)) {
      mapCache.set(mapId, null);
      return null;
    }
    const mapData = JSON.parse(fs.readFileSync(mapFile, "utf8")) as Record<string, unknown>;
    const events = ((mapData.events || []) as unknown[])
      .filter(Boolean)
      .map((e) => e as Record<string, unknown>)
      .filter((e) => isInt(e.id));
    const entry: MapReconcileEntry = { mapId, mapFile, events, claimed: new Set<number>() };
    mapCache.set(mapId, entry);
    return entry;
  }

  for (const contract of registry.contracts) {
    const target: RmmvTarget = contract.rmmvTarget || {} as RmmvTarget;
    const status = contract.status;
    const reviewing = status === "reviewing";
    const dropped = status === "rejected" || status === "abandoned";
    const writers = effectWriters(contract);

    if (target.operation === "add-map-event" && isInt(target.mapId)) {
      const m = loadMapEntry(target.mapId);

      if (reviewing) {
        if (m) {
          const reviewingMatch = matchMapEvent(contract, m.events);
          if (reviewingMatch) {
            m.claimed.add(reviewingMatch.id);
            drifts.push({
              contractId: contract.id,
              rid: contract.rid,
              code: "status-stale-reviewing",
              mapId: target.mapId,
              eventId: reviewingMatch.id,
              eventName: reviewingMatch.name || target.eventName,
              x: reviewingMatch.x,
              y: reviewingMatch.y,
              status,
              matchedBy: reviewingMatch.matchedBy,
              message: "Event exists in map but registry still says reviewing; approve before placement.",
            });
          }
        }
        continue;
      }

      if (dropped) {
        // 被拒绝/弃用的契约不预期被放置：认领残留事件避免误报孤儿，只提示写入方缺失。
        if (m) {
          const droppedMatch = matchMapEvent(contract, m.events);
          if (droppedMatch) m.claimed.add(droppedMatch.id);
        }
        if (hasWriters(writers)) {
          drifts.push({
            contractId: contract.id,
            rid: contract.rid,
            code: "state-writer-missing",
            status,
            switches: writers.switches,
            variables: writers.variables,
            message: "Rejected/abandoned contract no longer writes its declared switches/variables; downstream readers may break.",
          });
        }
        continue;
      }

      if (!m) {
        drifts.push({ contractId: contract.id, rid: contract.rid, code: "map-missing", mapId: target.mapId });
        continue;
      }
      const found = matchMapEvent(contract, m.events);
      if (found) m.claimed.add(found.id);

      if (!found) {
        drifts.push({
          contractId: contract.id,
          rid: contract.rid,
          code: "event-not-placed",
          mapId: target.mapId,
          eventName: target.eventName,
          status,
        });
        continue;
      }

      const liveEvent = m.events.find((e) => e.id === found.id) as Record<string, unknown>;

      if (status === "draft") {
        drifts.push({
          contractId: contract.id,
          rid: contract.rid,
          code: "status-stale-draft",
          mapId: target.mapId,
          eventId: found.id,
          eventName: found.name || target.eventName,
          x: found.x,
          y: found.y,
          status,
          matchedBy: found.matchedBy,
          message: "Event exists in map but registry still says draft.",
        });
        if (options?.apply && isInt(found.x) && isInt(found.y)) {
          updateContractPlacement(projectPath, contract.id, {
            mapId: target.mapId,
            eventId: found.id,
            x: found.x,
            y: found.y,
            contentHash: eventContentFingerprint(liveEvent),
          }, options);
          appliedCount += 1;
        }
      }

      // 内容指纹漂移：放置时记录过基线 hash，且当前内容与之不符 → 玩家手改了内容。
      const expected = contract.placement?.contentHash;
      if (typeof expected === "string" && expected) {
        const actual = eventContentFingerprint(liveEvent);
        if (actual !== expected) {
          drifts.push({
            contractId: contract.id,
            rid: contract.rid,
            code: "event-modified",
            mapId: target.mapId,
            eventId: found.id,
            eventName: found.name || target.eventName,
            status,
            matchedBy: found.matchedBy,
            expectedHash: expected,
            actualHash: actual,
            message: "Event content changed since placement (likely a manual player edit). Not auto-reverted.",
          });
        }
      }

      // 防失联：仅当靠 eventId 锚点命中（note 里已无任何标记、只能用记录的
      // eventId 兜底）且缺 rid 标记时报告，并可 --apply 补回标记。
      const rt = ridToken(contract);
      if (rt && found.matchedBy === "placement-eventId") {
        const note = typeof liveEvent.note === "string" ? liveEvent.note : "";
        if (!note.includes(rt)) {
          drifts.push({
            contractId: contract.id,
            rid: contract.rid,
            code: "note-token-missing",
            mapId: target.mapId,
            eventId: found.id,
            status,
            matchedBy: found.matchedBy,
            message: "Map event lost its AIWF:rid marker; matched via eventId anchor.",
          });
          if (options?.apply) {
            const lines = note.split(/\r?\n/).filter((l) => l.trim() !== "");
            lines.push(rt);
            updateMapEvent({ project: projectRoot, mapId: target.mapId, eventId: found.id, event: { note: lines.join("\n") } });
            appliedCount += 1;
          }
        }
      }
    } else if (target.operation === "add-common-event" && Number.isInteger(target.commonEventId)) {
      if (dropped) {
        if (hasWriters(writers)) {
          drifts.push({
            contractId: contract.id,
            rid: contract.rid,
            code: "state-writer-missing",
            status,
            switches: writers.switches,
            variables: writers.variables,
            message: "Rejected/abandoned contract no longer writes its declared switches/variables; downstream readers may break.",
          });
        }
        continue;
      }
      const commonFile: string = path.join(dataDir, "CommonEvents.json");
      if (!fs.existsSync(commonFile)) {
        drifts.push({ contractId: contract.id, rid: contract.rid, code: "common-events-missing" });
      } else {
        const list = JSON.parse(fs.readFileSync(commonFile, "utf8")) as unknown[];
        const found = (list || [])[target.commonEventId as number];
        if (!found) {
          drifts.push({
            contractId: contract.id,
            rid: contract.rid,
            code: "common-event-not-implemented",
            commonEventId: target.commonEventId,
          });
        }
      }
    } else if (dropped && hasWriters(writers)) {
      drifts.push({
        contractId: contract.id,
        rid: contract.rid,
        code: "state-writer-missing",
        status,
        switches: writers.switches,
        variables: writers.variables,
        message: "Rejected/abandoned contract no longer writes its declared switches/variables; downstream readers may break.",
      });
    }
  }

  // 孤儿扫描：遍历所有 Map###.json，找不被任何契约认领的事件。
  //   - orphan-tagged（带 AIWF:* 标记但 rid/contractId 不在注册表）：高信号，默认报告。
  //   - orphan-untracked（无标记的遗留/手工事件）：噪音大，仅 --orphans 时报告。
  const mapFiles = fs.readdirSync(dataDir).filter((f) => /^Map\d+\.json$/.test(f));
  for (const file of mapFiles) {
    const mapId = parseInt(file.slice(3), 10);
    if (!Number.isInteger(mapId)) continue;
    const m = loadMapEntry(mapId);
    if (!m) continue;
    for (const event of m.events) {
      const eventId = event.id as number;
      if (m.claimed.has(eventId)) continue;
      const note = typeof event.note === "string" ? event.note : "";
      const eventName = typeof event.name === "string" ? event.name : undefined;
      if (AIWF_TOKEN_RE.test(note)) {
        const ref = /AIWF:(?:rid|story|event-contract):([^\s\\]+)/.exec(note);
        drifts.push({
          code: "orphan-tagged",
          mapId,
          eventId,
          eventName,
          referencedId: ref ? ref[1] : undefined,
          message: "Map event carries an AIWF marker but no matching registry contract.",
        });
      } else if (options?.orphans) {
        drifts.push({
          code: "orphan-untracked",
          mapId,
          eventId,
          eventName,
          message: "Hand-made/legacy event not tracked by the registry. Adopt it to manage.",
        });
      }
    }
  }

  return {
    project: registry.project,
    registryPath: registry.path,
    dataDir,
    drifts,
    driftCount: drifts.length,
    appliedCount,
    status: drifts.length > appliedCount ? "drifted" : appliedCount > 0 ? "synced" : "clean",
  };
}

/**
 * 拒绝/弃用一个契约：玩家不接受放置时给它明确状态，注册表不再"撒谎"停在 draft。
 * idOrRid 可传 contractId 或 rid（数字/纯数字串按 rid 解析）。
 */
function rejectContract(
  projectPath: string,
  idOrRid: string | number,
  options?: RegistryOptions & { reason?: string; abandon?: boolean },
): PlacementUpdateResult {
  const registry = loadRegistry(projectPath, options);
  const index = findContractIndex(registry, idOrRid);
  if (index < 0) {
    return { status: "not-found", contractId: String(idOrRid), registryPath: registry.path };
  }
  const contract = registry.contracts[index];
  const now = new Date().toISOString();
  const next: EventContract = {
    ...contract,
    status: options?.abandon ? "abandoned" : "rejected",
    recordedBy: {
      ...(contract.recordedBy || {}),
      rejectedAt: now,
      ...(options?.reason ? { rejectReason: options.reason } : {}),
    },
  };
  registry.contracts[index] = next;
  saveRegistry(registry);
  return { status: "ok", contractId: contract.id, contract: next, previousStatus: contract.status, registryPath: registry.path };
}

/**
 * 批准一个待确认契约进入待放置队列：reviewing -> draft。
 * 非 reviewing 契约保持原状态，避免误把 placed/rejected 改回待放置。
 */
function approveContract(
  projectPath: string,
  idOrRid: string | number,
  options?: RegistryOptions & { note?: string },
): PlacementUpdateResult {
  const registry = loadRegistry(projectPath, options);
  const index = findContractIndex(registry, idOrRid);
  if (index < 0) {
    return { status: "not-found", contractId: String(idOrRid), registryPath: registry.path };
  }
  const contract = registry.contracts[index];
  if (contract.status !== "reviewing") {
    return { status: "ok", contractId: contract.id, contract, previousStatus: contract.status, registryPath: registry.path };
  }
  const now = new Date().toISOString();
  const next: EventContract = {
    ...contract,
    status: "draft",
    recordedBy: {
      ...(contract.recordedBy || {}),
      approvedAt: now,
      ...(options?.note ? { approvalNote: options.note } : {}),
    },
  };
  registry.contracts[index] = next;
  saveRegistry(registry);
  return { status: "ok", contractId: contract.id, contract: next, previousStatus: contract.status, registryPath: registry.path };
}

/**
 * 撤回一次 reject：把状态还原（默认回 "draft" 待放置态）并清掉 rejectedAt/rejectReason。
 * 供 UI 误点拒绝后的 Ctrl+Z 撤回；status 传 reject 时返回的 previousStatus 可精确还原。
 */
function unrejectContract(
  projectPath: string,
  idOrRid: string | number,
  options?: RegistryOptions & { status?: string },
): PlacementUpdateResult {
  const registry = loadRegistry(projectPath, options);
  const index = findContractIndex(registry, idOrRid);
  if (index < 0) {
    return { status: "not-found", contractId: String(idOrRid), registryPath: registry.path };
  }
  const contract = registry.contracts[index];
  const recordedBy = { ...(contract.recordedBy || {}) };
  delete (recordedBy as Record<string, unknown>).rejectedAt;
  delete (recordedBy as Record<string, unknown>).rejectReason;
  const next: EventContract = {
    ...contract,
    status: options?.status || "draft",
    recordedBy,
  };
  registry.contracts[index] = next;
  saveRegistry(registry);
  return { status: "ok", contractId: contract.id, contract: next, registryPath: registry.path };
}

/** 按 contractId 或 rid 定位契约下标。纯数字（或数字串）按 rid，否则按 id。 */
function findContractIndex(registry: RegistryFile, idOrRid: string | number): number {
  if (typeof idOrRid === "number" && Number.isInteger(idOrRid)) {
    return registry.contracts.findIndex((c) => c.rid === idOrRid);
  }
  const asStr = String(idOrRid);
  if (/^\d+$/.test(asStr)) {
    const rid = Number(asStr);
    const byRid = registry.contracts.findIndex((c) => c.rid === rid);
    if (byRid >= 0) return byRid;
  }
  return registry.contracts.findIndex((c) => c.id === asStr);
}

interface AdoptResult {
  status: "ok" | "not-found" | "rejected";
  contractId?: string;
  rid?: number;
  contract?: EventContract;
  registryPath?: string;
  reason?: string;
  errors?: ValidationError[];
}

/**
 * 收编孤儿：把地图里既有的事件反向登记进注册表，分配 rid、记录内容指纹、补盖
 * AIWF:rid 标记，使其纳入管理与对账。implementation 用事件真实 pages（不反编译）。
 */
function adoptOrphan(
  projectPath: string,
  opts: { mapId: number; eventId: number; id: string; purpose?: string; sceneId?: string; questline?: string },
  options?: RegistryOptions,
): AdoptResult {
  const projectRoot = path.resolve(projectPath);
  const dataDir = findDataDir(projectRoot);
  if (!dataDir) {
    return { status: "not-found", reason: "no-data-dir" };
  }
  const mapFile = path.join(dataDir, `Map${String(opts.mapId).padStart(3, "0")}.json`);
  if (!fs.existsSync(mapFile)) {
    return { status: "not-found", reason: `Map ${opts.mapId} not found.` };
  }
  const mapData = JSON.parse(fs.readFileSync(mapFile, "utf8")) as { events?: (Record<string, unknown> | null)[] };
  const event = (mapData.events || []).find((e) => e && (e as Record<string, unknown>).id === opts.eventId) as Record<string, unknown> | undefined;
  if (!event) {
    return { status: "not-found", reason: `Event ${opts.eventId} not found on map ${opts.mapId}.` };
  }

  const registry = loadRegistry(projectPath, options);
  if (registry.contracts.some((c) => c.id === opts.id)) {
    return { status: "rejected", reason: `Contract id "${opts.id}" already exists.` };
  }

  // 预分配 rid（单线程下安全），先补盖 note 再回读规范化后的事件取指纹。
  const rid = maxRid(registry) + 1;
  const ridLine = `AIWF:rid:${rid}`;
  const contractLine = `AIWF:event-contract:${opts.id}`;
  const existingNote = typeof event.note === "string" ? event.note : "";
  const noteLines = existingNote.split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const line of [ridLine, contractLine]) {
    if (!noteLines.includes(line)) noteLines.push(line);
  }
  updateMapEvent({ project: projectRoot, mapId: opts.mapId, eventId: opts.eventId, event: { note: noteLines.join("\n") } });

  // 回读规范化后的事件，确保指纹基线 == 磁盘真实内容。
  const after = JSON.parse(fs.readFileSync(mapFile, "utf8")) as { events?: (Record<string, unknown> | null)[] };
  const placed = (after.events || []).find((e) => e && (e as Record<string, unknown>).id === opts.eventId) as Record<string, unknown>;
  if (!placed) {
    return { status: "not-found", reason: `Event ${opts.eventId} not found after normalize on map ${opts.mapId}.` };
  }
  placed.note = noteLines.join("\n");
  fs.writeFileSync(mapFile, JSON.stringify(after, null, 2), "utf8");
  const contentHash = eventContentFingerprint(placed);
  const now = new Date().toISOString();
  const eventName = typeof placed.name === "string" ? placed.name : `EV${String(opts.eventId).padStart(3, "0")}`;
  const x = isInt(placed.x) ? (placed.x as number) : 0;
  const y = isInt(placed.y) ? (placed.y as number) : 0;
  const purpose = opts.purpose && opts.purpose.trim().length >= 10
    ? opts.purpose.trim()
    : adoptedOrphanPurpose(opts.mapId, opts.eventId, eventName);

  const contract: EventContract = {
    engine: inspectRmmvProject(projectPath).engine,
    kind: "EventContract",
    rid,
    id: opts.id,
    purpose,
    ...(opts.sceneId ? { sceneId: opts.sceneId } : {}),
    ...(opts.questline ? { questline: opts.questline } : {}),
    status: "placed",
    rmmvTarget: {
      operation: "add-map-event",
      mapId: opts.mapId,
      eventName,
      eventId: opts.eventId,
      x,
      y,
    },
    implementation: {
      note: contractLine,
      pages: Array.isArray(placed.pages) ? (placed.pages as unknown[]) : [],
    },
    placement: { mapId: opts.mapId, eventId: opts.eventId, x, y, placedAt: now, contentHash },
    recordedBy: { registeredAt: now, placedAt: now, adoptedAt: now, contentHashAt: now },
  };

  const errors = validateContract(contract);
  if (errors.length) {
    return { status: "rejected", reason: "schema", errors };
  }
  registry.contracts.push(contract);
  saveRegistry(registry);
  const saved = EventContractDao.get(contract.id);
  const finalRid = Number.isInteger(saved?.rid) ? saved!.rid : rid;
  if (finalRid !== rid) {
    contract.rid = finalRid;
  }
  const finalNoteLines = String(placed.note || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("AIWF:"));
  for (const line of [`AIWF:rid:${finalRid}`, contractLine]) {
    if (!finalNoteLines.includes(line)) finalNoteLines.push(line);
  }
  placed.note = finalNoteLines.join("\n");
  fs.writeFileSync(mapFile, JSON.stringify(after, null, 2), "utf8");
  const finalContentHash = eventContentFingerprint(placed);
  if (contract.placement) {
    contract.placement.contentHash = finalContentHash;
  }
  contract.recordedBy = {
    ...(contract.recordedBy || {}),
    contentHashAt: now,
  };
  EventContractDao.update(contract.id, contract as unknown as Record<string, unknown>, contract.status);
  return { status: "ok", contractId: opts.id, rid: finalRid, contract, registryPath: registry.path };
}

function findDataDir(projectRoot: string): string | null {
  const candidates: string[] = [path.join(projectRoot, "www", "data"), path.join(projectRoot, "data")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function runCli(argv?: string[]): Promise<number> {
  const [sub, ...rest] = argv || [];
  if (!sub) {
    return printUsageAndFail();
  }
  const args = parseFlags(rest);
  try {
    if (sub === "list") {
      return await runList(args);
    }
    if (sub === "register") {
      return await runRegister(args);
    }
    if (sub === "validate") {
      return await runValidate(args);
    }
    if (sub === "scaffold") {
      return await runScaffold(args);
    }
    if (sub === "show") {
      return await runShow(args);
    }
    if (sub === "reconcile") {
      return await runReconcile(args);
    }
    if (sub === "reject") {
      return await runReject(args);
    }
    if (sub === "approve") {
      return await runApprove(args);
    }
    if (sub === "verify") {
      return await runVerify(args);
    }
    if (sub === "adopt") {
      return await runAdopt(args);
    }
    process.stderr.write(`event-registry: unknown subcommand "${sub}".\n`);
    return printUsageAndFail();
  } catch (err) {
    process.stderr.write(`event-registry ${sub} failed: ${(err as Error).message}\n`);
    return 1;
  }
}

async function runList(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const result = await listContracts(args.project as string);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

function readContractFromFlag(args: CliArgs): EventContract {
  requireFlag(args, "contract");
  const contractText: string = fs.readFileSync(path.resolve(args.contract as string), "utf8");
  return JSON.parse(contractText) as EventContract;
}

async function runRegister(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const contract = readContractFromFlag(args);
  const result = await registerContract(args.project as string, contract);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runValidate(args: CliArgs): Promise<number> {
  const contract = readContractFromFlag(args);
  const result = await validateContractFile(contract, {
    projectPath: args.project ? String(args.project) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runScaffold(args: CliArgs): Promise<number> {
  requireFlag(args, "id");
  requireFlag(args, "map-id");
  requireFlag(args, "purpose");
  requireFlag(args, "out");
  const mapId = Number(args["map-id"]);
  if (!Number.isInteger(mapId) || mapId < 1) {
    throw new Error("--map-id must be an integer >= 1.");
  }
  const contract = scaffoldContract({
    engine: args.project ? inspectRmmvProject(String(args.project)).engine : "rpg-maker-mv",
    id: String(args.id),
    mapId,
    purpose: String(args.purpose),
    eventName: args["event-name"] ? String(args["event-name"]) : undefined,
    trigger: args.trigger ? String(args.trigger) : undefined,
    text: args.text ? String(args.text) : undefined,
    sceneId: args["scene-id"] ? String(args["scene-id"]) : undefined,
  });
  const errors = validateContract(contract);
  const outPath = path.resolve(String(args.out));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify({
    status: errors.length ? "rejected" : "ok",
    out: outPath,
    contract,
    errors,
    hints: errors.length ? buildValidationHints(errors) : [
      "Edit implementation.commands[], then run event-registry validate --contract <file> before register.",
    ],
  }, null, 2) + "\n");
  return errors.length ? 1 : 0;
}

async function runShow(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const id = args._positional && args._positional[0];
  if (!id) throw new Error("show requires a contract id positional argument.");
  const result = await showContract(args.project as string, id);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runReconcile(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const result = await reconcile(args.project as string, {
    apply: Boolean(args.apply),
    orphans: Boolean(args.orphans),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "synced") return 0;
  return result.status === "drifted" ? 1 : 0;
}

async function runReject(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const idOrRid = args._positional && args._positional[0];
  if (!idOrRid) throw new Error("reject requires a contract id or rid positional argument.");
  const result = rejectContract(args.project as string, idOrRid, {
    abandon: Boolean(args.abandon),
    reason: args.reason ? String(args.reason) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runApprove(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  const idOrRid = args._positional && args._positional[0];
  if (!idOrRid) throw new Error("approve requires a contract id or rid positional argument.");
  const result = approveContract(args.project as string, idOrRid, {
    note: args.note ? String(args.note) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runVerify(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  requireFlag(args, "evidence");
  const id = args._positional && args._positional[0];
  if (!id) throw new Error("verify requires a contract id positional argument.");
  const evidence = JSON.parse(fs.readFileSync(path.resolve(String(args.evidence)), "utf8")) as Record<string, unknown>;
  const result = verifyContract(args.project as string, id, evidence);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

async function runAdopt(args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  requireFlag(args, "map");
  requireFlag(args, "event");
  requireFlag(args, "id");
  const mapId = Number(args.map);
  const eventId = Number(args.event);
  if (!Number.isInteger(mapId) || mapId < 1) throw new Error("--map must be an integer >= 1.");
  if (!Number.isInteger(eventId) || eventId < 1) throw new Error("--event must be an integer >= 1.");
  const result = adoptOrphan(args.project as string, {
    mapId,
    eventId,
    id: String(args.id),
    purpose: args.purpose ? String(args.purpose) : undefined,
    sceneId: args["scene-id"] ? String(args["scene-id"]) : undefined,
    questline: args.questline ? String(args.questline) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

function parseFlags(rest: string[]): CliArgs {
  const args: CliArgs = { _positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const token: string = rest[i];
    if (token.startsWith("--")) {
      const key: string = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._positional.push(token);
    }
  }
  return args;
}

function requireFlag(args: CliArgs, name: string): void {
  if (!args[name]) {
    throw new Error(`Missing required flag --${name}.`);
  }
}

function printUsageAndFail(): number {
  process.stderr.write(
    "Usage: npm --prefix src/backend run cli -- event-registry <list|register|validate|scaffold|show|reconcile|verify> [args]\n" +
    "  list      --project <p>\n" +
    "  register  --project <p> --contract <file.json>\n" +
    "  validate  --contract <file.json> [--project <p>]\n" +
    "  scaffold  --id <dotted.id> --map-id <N> --purpose \"...\" --out <file.json> [--project <p>] [--event-name EV_Name] [--trigger action-button] [--text \"...\"] [--scene-id scene-id]\n" +
    "  show      --project <p> <contractId>\n" +
    "  reconcile --project <p> [--apply] [--orphans]\n" +
    "  verify    --project <p> <contractId> --evidence <verification.json>\n" +
    "  reject    --project <p> <contractId|rid> [--abandon] [--reason \"...\"]\n" +
    "  approve   --project <p> <contractId|rid> [--note \"...\"]\n" +
    "  adopt     --project <p> --map <N> --event <N> --id <dotted.id> [--purpose \"...\"] [--scene-id scene-id] [--questline questline]\n"
  );
  return 1;
}

export {
  ID_PATTERN,
  normalizeContractEnvelope,
  buildValidationHints,
  scaffoldContract,
  validateContractFile,
  validateContract,
  validateStateBlock,
  detectConflicts,
  registerContract,
  listContracts,
  showContract,
  updateContractPlacement,
  verifyContract,
  reconcile,
  approveContract,
  rejectContract,
  unrejectContract,
  adoptOrphan,
  loadRegistry,
  saveRegistry,
  allocateRids,
  registryPathFor,
  runCli,
};
