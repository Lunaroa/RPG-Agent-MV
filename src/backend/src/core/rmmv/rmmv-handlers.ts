import path from "node:path";

import { readJson } from "./json.ts";
import { buildPluginInventory } from "./plugin-inventory.ts";
import { analyzeStateSlots } from "./state-slots.ts";
import { buildAssetInventory } from "./asset-inventory.ts";
import { buildRmmvMapIndex } from "./map-index.ts";
import { buildRmmvDbCatalog, type RmmvDbTableName } from "./db-catalog.ts";
import { listRmmvDatabaseTableKeys } from "./database-schema.ts";
import { findCommonEventReferences } from "./common-event-references.ts";
import { applyPatchToProject, previewPatch, COMMAND_LEVEL_OPS, validateAgentPatchSpec } from "./patcher.ts";
import { applyAgentPagePatch } from "../desktop/story-page-sync-service.ts";
import { writeEventContextOutputs } from "../report/write-event-context-report.ts";
import { writePatchReport } from "../report/write-patch-report.ts";
import { writePluginInventoryOutputs } from "../report/write-plugin-inventory-report.ts";
import { writeStateSlotsOutputs } from "../report/write-state-slots-report.ts";
import { writeAssetInventoryOutputs } from "../report/write-asset-inventory-report.ts";
import { prepareOutputPath } from "../workflow/output-safety.ts";
import { buildEventContext } from "../workflow/event/event-context.ts";
import { runCli as runMapEventsCli } from "../desktop/map-events-cli.ts";
import { runCli as runEventRegistryCli } from "../workflow/event/event-registry.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import {
  captureConsole,
  inputToCliArgs,
  resolveDefaultOut,
  resolveProjectRoot,
  resolveWorkflowRootFromInput,
} from "./rmmv-handler-utils.ts";
import { EventContractDao } from "../db/dao/event-contract-dao.ts";
import { EventFeedbackDao, type FeedbackVerdict, type FeedbackSummary } from "../db/dao/event-feedback-dao.ts";
import { writeFeedbackCard } from "../report/write-feedback-card.ts";
import {
  buildMapIndex as buildDesktopMapIndex,
  buildMapPayload,
  buildTilesetIndex,
  createMapDraft,
  deleteMapDraft,
  duplicateMapDraft,
  postMapTiles,
  updateMapPropertiesDraft,
} from "../desktop/map-service.ts";
import {
  createEvent,
  removeEvent,
  updateEvent,
} from "../desktop/event-service.ts";
import {
  applyProjectStaging,
  applyStagedMap,
  discardProjectStaging,
  discardStagedMap,
  getProjectStagingStatus,
  getStagingStatus,
} from "../desktop/staging-service.ts";
import type { StorySyncActor } from "../desktop/story-page-sync-service.ts";
import { patchRequiresAgentGuard } from "../desktop/controlled-editing-policy.ts";

function normalizeAction(action: unknown): string {
  const raw = String(action || "");
  return raw.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

function resultSummary(summary: string, data?: unknown, artifacts?: string[]): RmmvHandlerResult {
  return { summary, data, artifacts };
}

function requireAction(input: RmmvHandlerInput): string {
  if (!input.action) throw new Error("Missing action");
  return normalizeAction(input.action);
}

function requirePositiveIntField(input: RmmvHandlerInput, field: string): number {
  const value = Number(input[field]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`"${field}" must be a positive integer.`);
  return value;
}

function requireNonNegativeIntField(input: RmmvHandlerInput, field: string): number {
  const value = Number(input[field]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`"${field}" must be an integer >= 0.`);
  return value;
}

function requireRecordField(input: RmmvHandlerInput, field: string): Record<string, unknown> {
  const value = input[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function mapPropertiesFromInput(input: RmmvHandlerInput, includeParent: boolean): Record<string, unknown> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error('"name" must be a non-empty string.');
  const width = requirePositiveIntField(input, "width");
  const height = requirePositiveIntField(input, "height");
  if (width > 256 || height > 256) throw new Error('"width" and "height" must be <= 256.');
  const tilesetId = requirePositiveIntField(input, "tilesetId");
  const properties: Record<string, unknown> = { name, width, height, tilesetId };
  if (includeParent) properties.parentId = requireNonNegativeIntField(input, "parentId");
  return properties;
}

function assertMapParentExists(workflowRoot: string, project: string, parentId: number): void {
  if (parentId === 0) return;
  const exists = buildDesktopMapIndex(workflowRoot, project).maps.some((map) => map.id === parentId);
  if (!exists) throw new Error(`Parent map does not exist: ${parentId}`);
}

function assertTilesetExists(workflowRoot: string, project: string, tilesetId: number): void {
  const exists = buildTilesetIndex(workflowRoot, project).tilesets.some((tileset) => tileset.id === tilesetId);
  if (!exists) throw new Error(`Tileset does not exist: ${tilesetId}`);
}

function agentMutationActor(input: RmmvHandlerInput): StorySyncActor {
  return {
    actorType: "agent",
    actorId: typeof input.agent === "string" && input.agent.trim() ? input.agent.trim() : "rmmv-mcp",
    sessionId: typeof input.taskId === "string" && input.taskId.trim() ? input.taskId.trim() : undefined,
  };
}

export function runRmmvEventContext(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const projectRoot = resolveProjectRoot(input);
  const mapId = Number(input.mapId);
  const eventId = Number(input.eventId);
  if (!Number.isInteger(mapId)) throw new Error("Missing mapId");
  if (!Number.isInteger(eventId)) throw new Error("Missing eventId");
  const outDir =
    typeof input.out === "string"
      ? path.resolve(input.out)
      : resolveDefaultOut(
          workflowRoot,
          `map-${String(mapId).padStart(3, "0")}-event-${String(eventId).padStart(3, "0")}-context`,
        );
  const context = buildEventContext(projectRoot, mapId, eventId);
  const { rendered } = writeEventContextOutputs(context as never, outDir);
  return resultSummary(rendered, { projectRoot, outDir }, [outDir]);
}

export function runRmmvMapIndex(input: RmmvHandlerInput): RmmvHandlerResult {
  const project = resolveProjectRoot(input);
  const result = buildRmmvMapIndex(project);
  const summary = `Map index: ${result.maps.length} map(s)`;
  return resultSummary(summary, result);
}

export function runRmmvMapEditor(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const action = requireAction(input);
  let data: unknown;

  if (action === "map-data") {
    const mapId = requirePositiveIntField(input, "mapId");
    data = buildMapPayload(workflowRoot, project, mapId);
  } else if (action === "tilesets") {
    data = buildTilesetIndex(workflowRoot, project);
  } else if (action === "project-staging") {
    data = getProjectStagingStatus(workflowRoot, project);
  } else if (action === "map-staging") {
    data = getStagingStatus(workflowRoot, project, requirePositiveIntField(input, "mapId"));
  } else if (action === "create") {
    const properties = mapPropertiesFromInput(input, true);
    assertMapParentExists(workflowRoot, project, Number(properties.parentId));
    assertTilesetExists(workflowRoot, project, Number(properties.tilesetId));
    data = createMapDraft(workflowRoot, project, properties);
  } else if (action === "update-properties") {
    const mapId = requirePositiveIntField(input, "mapId");
    const properties = mapPropertiesFromInput(input, false);
    assertTilesetExists(workflowRoot, project, Number(properties.tilesetId));
    data = updateMapPropertiesDraft(workflowRoot, project, mapId, properties);
  } else if (action === "duplicate") {
    const mapId = requirePositiveIntField(input, "mapId");
    const parentId = requireNonNegativeIntField(input, "parentId");
    assertMapParentExists(workflowRoot, project, parentId);
    data = duplicateMapDraft(workflowRoot, project, mapId, parentId);
  } else if (action === "remove") {
    data = deleteMapDraft(workflowRoot, project, requirePositiveIntField(input, "mapId"));
  } else if (action === "paint") {
    const edits = input.edits;
    if (!Array.isArray(edits) || edits.length === 0) throw new Error('"edits" must be a non-empty array.');
    data = postMapTiles(workflowRoot, project, requirePositiveIntField(input, "mapId"), edits as never);
  } else if (action === "apply-map") {
    data = applyStagedMap(workflowRoot, project, requirePositiveIntField(input, "mapId"));
  } else if (action === "discard-map") {
    data = discardStagedMap(workflowRoot, project, requirePositiveIntField(input, "mapId"));
  } else if (action === "apply-project") {
    data = applyProjectStaging(workflowRoot, project);
  } else if (action === "discard-project") {
    data = discardProjectStaging(workflowRoot, project);
  } else {
    throw new Error(`Unsupported map-editor action: ${action}`);
  }

  return resultSummary(`Map editor ${action} completed.`, data);
}

export function runRmmvEventEditor(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const action = requireAction(input);
  const mapId = requirePositiveIntField(input, "mapId");
  const actor = agentMutationActor(input);
  let data: unknown;

  if (action === "create") {
    throw new Error(
      "Agent cannot create new map events directly. Register an EventContract with RmmvEvent action=registry.register, then wait for user approval and manual placement.",
    );
  } else if (action === "update") {
    const patch = requireRecordField(input, "event");
    if ("x" in patch || "y" in patch) {
      throw new Error(
        "editor.update must not set x/y for map event placement. New events use registry.register and desktop manual placement; relocate existing events with editor.move.",
      );
    }
    data = updateEvent(
      workflowRoot,
      project,
      mapId,
      requirePositiveIntField(input, "eventId"),
      patch,
      actor,
    );
  } else if (action === "move") {
    data = updateEvent(
      workflowRoot,
      project,
      mapId,
      requirePositiveIntField(input, "eventId"),
      {
        x: requireNonNegativeIntField(input, "x"),
        y: requireNonNegativeIntField(input, "y"),
      },
      actor,
    );
  } else if (action === "duplicate") {
    throw new Error(
      "Agent cannot duplicate map events directly because it creates a new map event. Register an EventContract with RmmvEvent action=registry.register, then wait for user approval and manual placement.",
    );
  } else if (action === "remove") {
    data = removeEvent(workflowRoot, project, mapId, requirePositiveIntField(input, "eventId"), actor);
  } else {
    throw new Error(`Unsupported event-editor action: ${action}`);
  }

  return resultSummary(`Event editor ${action} completed.`, data);
}

export function runRmmvDbCatalog(input: RmmvHandlerInput): RmmvHandlerResult {
  const project = resolveProjectRoot(input);
  const tables = parseDbCatalogTables(input.tables);
  const queryRaw = input.query;
  const query = typeof queryRaw === "string" && queryRaw.trim() ? queryRaw : undefined;
  const limit = parsePositiveInt(input.limit);
  const result = buildRmmvDbCatalog(project, { tables, query, limit });
  const counts = Object.entries(result.tables)
    .map(([name, rows]) => `${name}=${rows.length}`)
    .join(" ");
  return resultSummary(`DB catalog: ${counts || "(empty)"}`, result);
}

export function runRmmvCommonEventReferences(input: RmmvHandlerInput): RmmvHandlerResult {
  const project = resolveProjectRoot(input);
  const commonEventId = Number(input.commonEventId);
  if (!Number.isInteger(commonEventId) || commonEventId <= 0) {
    throw new Error("Missing commonEventId");
  }
  const result = findCommonEventReferences(project, commonEventId);
  const summary = `Common event ${commonEventId}: ${result.referencedBy.length} reference(s)`;
  return resultSummary(summary, result);
}

const DB_CATALOG_TABLE_NAMES: ReadonlySet<RmmvDbTableName> = new Set(listRmmvDatabaseTableKeys());

function parseDbCatalogTables(raw: unknown): RmmvDbTableName[] {
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    entries = raw.split(/[,\s]+/).filter(Boolean);
  } else if (raw === undefined || raw === null) {
    throw new Error(
      `RmmvDbCatalog requires 'tables'; allowed values: ${Array.from(DB_CATALOG_TABLE_NAMES).join(", ")}`,
    );
  } else {
    throw new Error("RmmvDbCatalog 'tables' must be an array of names");
  }

  const seen = new Set<RmmvDbTableName>();
  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new Error("RmmvDbCatalog 'tables' entries must be strings");
    }
    if (!DB_CATALOG_TABLE_NAMES.has(entry as RmmvDbTableName)) {
      throw new Error(
        `Unknown table '${entry}'; allowed values: ${Array.from(DB_CATALOG_TABLE_NAMES).join(", ")}`,
      );
    }
    seen.add(entry as RmmvDbTableName);
  }
  if (seen.size === 0) throw new Error("RmmvDbCatalog 'tables' must list at least one table");
  return Array.from(seen);
}

function parsePositiveInt(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("'limit' must be a positive integer");
  }
  return value;
}
export function runRmmvStateSlots(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const out = typeof input.out === "string" ? path.resolve(input.out) : resolveDefaultOut(workflowRoot, "state-slots");
  const slots = analyzeStateSlots(project, {
    switches: input.switches as number | undefined,
    variables: input.variables as number | undefined,
    commonEvents: input.commonEvents as number | undefined,
  });
  const { rendered } = writeStateSlotsOutputs(slots, out);
  return resultSummary(rendered, slots, [out]);
}

export function runRmmvAssetInventory(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const out = typeof input.out === "string" ? path.resolve(input.out) : resolveDefaultOut(workflowRoot, "asset-inventory");
  const inventory = buildAssetInventory(project);
  writeAssetInventoryOutputs(inventory, out);
  return resultSummary(`Asset inventory written to ${out}`, inventory, [out]);
}

export function runRmmvPluginInventory(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const out = typeof input.out === "string" ? path.resolve(input.out) : resolveDefaultOut(workflowRoot, "plugin-inventory");
  const inventory = buildPluginInventory(project);
  writePluginInventoryOutputs(inventory, out);
  return resultSummary(`Plugin inventory written to ${out}`, inventory, [out]);
}

// event-registry's legacy argv adapter is heterogeneous: each subcommand takes
// a different set of fields, several read a positional contract id
// (show/verify/reject), and adopt uses --map/--event while scaffold uses
// --map-id. The generic inputToCliArgs cannot express positionals or these
// per-action field names, so we map the MCP tool input to the exact argv per
// action here. contract / evidence arrive as temp file paths materialized by
// the MCP server.
function buildEventRegistryArgv(action: string, input: RmmvHandlerInput): string[] {
  const project = (): string => resolveProjectRoot(input);
  const need = (field: string): string => {
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      throw new Error(`RmmvEventRegistry ${action} requires "${field}".`);
    }
    return String(value);
  };
  const pushOpt = (argv: string[], flag: string, field: string): void => {
    const value = input[field];
    if (value !== undefined && value !== null && value !== "") argv.push(flag, String(value));
  };

  switch (action) {
    case "list":
      return ["list", "--project", project()];
    case "validate":
      return ["validate", "--contract", need("contract")];
    case "register":
      return ["register", "--project", project(), "--contract", need("contract")];
    case "scaffold": {
      const argv = ["scaffold", "--id", need("id"), "--map-id", need("mapId"), "--purpose", need("purpose"), "--out", need("out")];
      pushOpt(argv, "--event-name", "eventName");
      pushOpt(argv, "--trigger", "trigger");
      pushOpt(argv, "--text", "text");
      pushOpt(argv, "--scene-id", "sceneId");
      return argv;
    }
    case "show":
      return ["show", "--project", project(), need("id")];
    case "reconcile": {
      const argv = ["reconcile", "--project", project()];
      if (input.apply) argv.push("--apply");
      if (input.orphans) argv.push("--orphans");
      return argv;
    }
    case "verify":
      return ["verify", "--project", project(), need("id"), "--evidence", need("evidence")];
    case "reject": {
      const argv = ["reject", "--project", project(), need("id")];
      if (input.abandon) argv.push("--abandon");
      pushOpt(argv, "--reason", "reason");
      return argv;
    }
    case "approve": {
      const argv = ["approve", "--project", project(), need("id")];
      pushOpt(argv, "--note", "note");
      return argv;
    }
    case "adopt": {
      const argv = ["adopt", "--project", project(), "--map", need("mapId"), "--event", need("eventId"), "--id", need("id")];
      pushOpt(argv, "--purpose", "purpose");
      pushOpt(argv, "--scene-id", "sceneId");
      pushOpt(argv, "--questline", "questline");
      return argv;
    }
    default:
      throw new Error(`Unsupported event-registry action: ${action}`);
  }
}

function parseJsonSummary(summary: string): unknown {
  const text = summary.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatEventRegistryRejection(action: string, summary: string, data: unknown): string {
  const record = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const reason = typeof record.reason === "string" && record.reason
    ? ` (${record.reason})`
    : "";
  const errors = Array.isArray(record.errors) && record.errors.length
    ? ` errors=${JSON.stringify(record.errors)}`
    : "";
  const conflicts = Array.isArray(record.conflicts) && record.conflicts.length
    ? ` conflicts=${JSON.stringify(record.conflicts)}`
    : "";
  const hints = Array.isArray(record.hints) && record.hints.length
    ? ` hints=${JSON.stringify(record.hints)}`
    : "";
  const detail = `${errors}${conflicts}${hints}`;
  return `Event registry ${action} rejected${reason}.${detail || ` ${summary}`}`;
}

export async function runRmmvEventRegistry(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const action = requireAction(input);
  const argv = buildEventRegistryArgv(action, input);
  const { summary, result: exitCode } = await captureConsole(() => runEventRegistryCli(argv));
  const data = parseJsonSummary(summary);
  if ((action === "register" || action === "validate") && exitCode !== 0) {
    throw new Error(formatEventRegistryRejection(action, summary, data));
  }
  return resultSummary(summary, data);
}

// ---- 自进化：人类评估反馈（event-feedback）----
// record / list / summary。反馈关联到 EventContract（必须已注册）与 opencode 会话 id；
// project_id 与被评 contract 对齐（record 时从 contract 反查，list/summary 用 basename 规范化，
// 与 event_contracts.project_id 一致）。归纳与改 skill 仍人工，本工具只负责落库与聚合。
const FEEDBACK_VERDICTS = new Set<FeedbackVerdict>(["accept", "revise", "reject"]);

function parseFeedbackTags(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = String(value).trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function resolveFeedbackProjectId(input: RmmvHandlerInput): string {
  return path.basename(resolveProjectRoot(input));
}

function formatFeedbackSummary(projectId: string, s: FeedbackSummary): string {
  const lines = [
    `Feedback summary for "${projectId}":`,
    `  total=${s.total}  dissatisfaction=${(s.dissatisfactionRate * 100).toFixed(0)}%`,
    `  verdict: accept=${s.byVerdict.accept} revise=${s.byVerdict.revise} reject=${s.byVerdict.reject}`,
  ];
  if (s.tagCounts.length) {
    lines.push("  tags:");
    for (const { tag, count } of s.tagCounts) lines.push(`    ${tag}: ${count}`);
  } else {
    lines.push("  tags: (none)");
  }
  return lines.join("\n");
}

export function runRmmvEventFeedback(input: RmmvHandlerInput): RmmvHandlerResult {
  const action = requireAction(input);

  if (action === "record") {
    const contractId = String(input.contractId ?? input.id ?? "").trim();
    if (!contractId) throw new Error('event-feedback record requires "contractId".');
    const verdict = String(input.verdict ?? "").trim() as FeedbackVerdict;
    if (!FEEDBACK_VERDICTS.has(verdict)) {
      throw new Error('event-feedback record requires "verdict" = accept | revise | reject.');
    }
    const contract = EventContractDao.get(contractId);
    if (!contract) {
      throw new Error(`Unknown contractId "${contractId}"; register the event before giving feedback.`);
    }
    const tags = parseFeedbackTags(input.tags);
    const note = input.notes != null ? String(input.notes) : (input.note != null ? String(input.note) : null);
    const sessionId = input.session != null
      ? String(input.session)
      : input.sessionId != null ? String(input.sessionId) : null;
    const fb = EventFeedbackDao.record({
      projectId: contract.project_id,
      contractId,
      verdict,
      tags,
      note,
      sessionId,
    });
    const cardPath = writeFeedbackCard({
      workflowRoot: resolveWorkflowRootFromInput(input),
      projectId: contract.project_id,
      contractId,
    });
    return resultSummary(
      `Recorded feedback #${fb.rid} for "${contractId}": ${verdict}`
        + `${tags.length ? ` [${tags.join(", ")}]` : ""}`
        + `\nReview card: ${cardPath}`,
      fb,
      [cardPath],
    );
  }

  if (action === "list") {
    const contractId = String(input.contractId ?? input.id ?? "").trim();
    if (contractId) {
      const contract = EventContractDao.get(contractId);
      if (!contract) throw new Error(`Unknown contractId "${contractId}".`);
      const data = EventFeedbackDao.listByContract(contract.project_id, contractId);
      return resultSummary(JSON.stringify(data, null, 2), data);
    }
    const data = EventFeedbackDao.listByProject(resolveFeedbackProjectId(input));
    return resultSummary(JSON.stringify(data, null, 2), data);
  }

  if (action === "summary") {
    const projectId = resolveFeedbackProjectId(input);
    const summary = EventFeedbackDao.summary(projectId);
    return resultSummary(formatFeedbackSummary(projectId, summary), summary);
  }

  throw new Error(`Unsupported event-feedback action: ${action}`);
}

export { patchRequiresAgentGuard } from "../desktop/controlled-editing-policy.ts";

function assertApplyEventCommandOps(spec: Record<string, unknown>, input: RmmvHandlerInput): void {
  if (input.dryRun) {
    throw new Error(
      "--apply-event-command-ops cannot be combined with --dry-run; drop --dry-run to apply, or drop --apply-event-command-ops to preview",
    );
  }
  const operations = (spec.operations || []) as Array<Record<string, unknown>>;
  const offenders = operations
    .map((op, index) => ({ index, op: op?.op as string }))
    .filter((entry) => !COMMAND_LEVEL_OPS.has(entry.op));
  if (offenders.length) {
    const detail = offenders
      .map((entry) => `operations[${entry.index}].op=${entry.op || "<missing>"}`)
      .join(", ");
    throw new Error(
      `--apply-event-command-ops only accepts replace-event-command, insert-event-command, delete-event-command, patch-event-page; refused: ${detail}`,
    );
  }
}

export function runPatchCore(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  if (!input.project) throw new Error("Missing project");
  if (!input.spec) throw new Error("Missing spec");
  const project = path.resolve(String(input.project));
  const specPath = path.resolve(String(input.spec));
  const reportOut = prepareOutputPath(
    typeof input.out === "string" ? path.resolve(String(input.out)) : resolveDefaultOut(workflowRoot, "patch-report"),
    input as never,
  );
  const spec = readJson(specPath) as Record<string, unknown>;
  const action = input.action
    ? normalizeAction(input.action)
    : input.dryRun
      ? "dry-run"
      : input.applyEventCommandOps
        ? "apply-event-command-ops"
        : "apply";

  if (input.outProject) {
    throw new Error(
      "--out-project is no longer supported by the default Git-first workflow; apply patches directly to the project worktree.",
    );
  }

  let report: unknown;
  if (action === "dry-run" || action === "dryrun") {
    report = previewPatch(project, spec as never);
  } else if (action === "apply-event-command-ops" || action === "applyeventcommandops") {
    assertApplyEventCommandOps(spec, input);
    if (patchRequiresAgentGuard(input)) {
      report = applyAgentPagePatch(project, spec as { operations?: Array<Record<string, unknown>> }, {
        actorId: input.agent as string | undefined,
        sessionId: input.taskId as string | undefined,
      });
    } else {
      report = applyPatchToProject(project, spec as never);
    }
  } else if (action === "apply") {
    if (patchRequiresAgentGuard(input)) {
      validateAgentPatchSpec(spec as never);
      report = applyAgentPagePatch(project, spec as { operations?: Array<Record<string, unknown>> }, {
        actorId: input.agent as string | undefined,
        sessionId: input.taskId as string | undefined,
      });
    } else {
      report = applyPatchToProject(project, spec as never);
    }
  } else {
    throw new Error(`Unsupported patch action: ${action}`);
  }

  writePatchReport(report as never, reportOut);
  const dryRun = action === "dry-run" || action === "dryrun";
  return resultSummary(
    `Patch ${dryRun ? "dry-run" : "applied"}; report at ${reportOut}`,
    report,
    [path.join(reportOut, "patch-report.json"), path.join(reportOut, "patch-report.md")],
  );
}

export function runRmmvPatch(input: RmmvHandlerInput): RmmvHandlerResult {
  const action = requireAction(input);
  if (action !== "dry-run" && action !== "dryrun" && action !== "apply-event-command-ops" && action !== "applyeventcommandops") {
    throw new Error("Patch handler only supports dryRun or applyEventCommandOps");
  }
  return runPatchCore({ ...input, action });
}

export async function runRmmvMapEvents(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  let action = requireAction(input);
  if (action === "removebatch") action = "remove-batch";
  const { summary } = await captureConsole(() => runMapEventsCli([action, ...inputToCliArgs(input)]));
  return resultSummary(summary);
}
