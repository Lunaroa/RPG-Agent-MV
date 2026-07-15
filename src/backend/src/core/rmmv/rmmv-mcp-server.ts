#!/usr/bin/env node
/**
 * Stdio MCP server for RMMV tools.
 *
 * Started by opencode via stdio transport.
 *
 * Legacy RmmvTest remains removed. RmmvVerify runs one strict, isolated
 * staged-project probe in a bounded worker process.
 *
 * Action naming conventions:
 *   - RmmvReadContext:  project, asset, plugin, and map facts
 *   - RmmvDatabase:     validate, dry-run, stage, or discard controlled database changes
 *   - RmmvDatabaseApply: apply one approved staged database operation by operationId
 *   - RmmvVerify:       run a strict isolated playtest probe for the main Agent
 *   - RmmvMap:          current map-editor write operations
 *   - RmmvEvent:        "registry.list" | "registry.validate" | "registry.scaffold" |
 *                       "registry.register" | "registry.show" | "registry.reconcile" |
 *                       "registry.verify" | "registry.adopt" | "registry.reject" |
 *                       "registry.approve" |
 *                       "patch.dryRun" | "patch.apply" |
 *                       "map.remove" | "map.removeBatch" |
 *                       "feedback.record" | "feedback.list" | "feedback.summary"
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import "../../suppress-warnings.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { normalizeProductLanguage } from "../../../../contract/i18n.ts";
import { bootstrapDatabase } from "../db/bootstrap.ts";
import { initFileLogger, toolLogger } from "../file-log.ts";
import { dispatchRmmvTool } from "./rmmv-tool-dispatch.ts";
import { withProductLanguage } from "../i18n/request-language.ts";
import type { RmmvHandlerInput } from "./rmmv-handler-types.ts";
import { resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

// MCP stdio owns stdout. Route incidental logs to stderr without replacing
// process.stdout.write, because the SDK transport uses it for protocol frames.
console.log = (...args: unknown[]) => {
  process.stderr.write(`${args.map(String).join(" ")}\n`);
};

// ── JSON field materialization ──────────────────────────────────────

const JSON_FILE_FIELDS = ["spec", "evidence", "contract"] as const;

const RMMV_DATABASE_TABLES = [
  "actors", "classes", "skills", "items", "weapons", "armors", "enemies", "troops",
  "states", "animations", "tilesets", "commonEvents", "system", "types", "terms",
] as const;
const RMMV_ARRAY_DATABASE_TABLES = [
  "actors", "classes", "skills", "items", "weapons", "armors", "enemies", "troops",
  "states", "animations", "tilesets", "commonEvents",
] as const;
const RMMV_TYPE_LIST_FIELDS = ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"] as const;

function materializeInlineJsonFields(input: RmmvHandlerInput, tmpDirs: string[]): void {
  for (const field of JSON_FILE_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;

    let json: string;
    if (typeof value === "object") {
      json = JSON.stringify(value);
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
      try { JSON.parse(trimmed); } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${field} looks like inline JSON but failed to parse: ${detail}`);
      }
      json = trimmed;
    } else {
      continue;
    }

    const dir = mkdtempSync(path.join(tmpdir(), "rmmv-spec-"));
    const file = path.join(dir, `${field}.json`);
    writeFileSync(file, json, "utf8");
    tmpDirs.push(dir);
    input[field] = file;
  }
}

// ── Action resolver ─────────────────────────────────────────────────

const ACTION_TO_COMMAND: Record<string, string> = {
  // RmmvReadContext
  "eventContext": "event-context",
  // RmmvEvent
  "registry.list": "event-registry",
  "registry.validate": "event-registry",
  "registry.scaffold": "event-registry",
  "registry.register": "event-registry",
  "registry.show": "event-registry",
  "registry.reconcile": "event-registry",
  "registry.verify": "event-registry",
  "registry.adopt": "event-registry",
  "registry.reject": "event-registry",
  "registry.approve": "event-registry",
  "patch.dryRun": "patch",
  "patch.apply": "patch",
  "map.remove": "map-events",
  "map.removeBatch": "map-events",
  "feedback.record": "event-feedback",
  "feedback.list": "event-feedback",
  "feedback.summary": "event-feedback",
  "memory.list": "memory",
  "memory.read": "memory",
  "memory.write": "memory",
  "memory.remove": "memory",
  "memory.reindex": "memory",
  "memory.read-profile": "memory",
  "memory.write-profile": "memory",
  "progress.write": "memory",
  "workflow.propose": "workflow-propose",
  "stage.validate": "event-registry",
  "stage.register": "event-registry",
  "editor.update": "event-editor",
  "editor.move": "event-editor",
  "editor.remove": "event-editor",
  // RmmvReadContext extras
  "mapIndex": "map-index",
  "assetInventory": "asset-inventory",
  "pluginInventory": "plugin-inventory",
  "mapData": "map-editor",
  "tilesets": "map-editor",
  "projectStaging": "map-editor",
  "mapStaging": "map-editor",
  "dbCatalog": "db-catalog",
  "dbEntry": "db-entry",
  "stateSlots": "state-slots",
  "commonEventReferences": "common-event-references",
  // RmmvDatabase
  "validate": "database-changes",
  "dryRun": "database-changes",
  "stage": "database-changes",
  "discard": "database-changes",
  // RmmvVerify
  "playtest.probe": "verify",
  // RmmvMap
  "create": "map-editor",
  "updateProperties": "map-editor",
  "duplicate": "map-editor",
  "remove": "map-editor",
  "paint": "map-editor",
  "applyMap": "map-editor",
  "discardMap": "map-editor",
  "applyProject": "map-editor",
  "discardProject": "map-editor",
  // Deprecated (simplified workflow 2026-06):
  // RmmvTest actions (playability, runtime) → unreliable in RMMV environment
};

/** Strip the domain prefix and convert to the handler action value. */
function resolveSubAction(action: string): string {
  if (action === "patch.apply") return "apply-event-command-ops";
  if (action === "progress.write") return action;
  const dot = action.lastIndexOf(".");
  const tail = dot >= 0 ? action.slice(dot + 1) : action;
  // CamelCase → kebab-case (e.g. dryRun → dry-run)
  if (/[A-Z]/.test(tail)) {
    return tail.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
  }
  return tail;
}

const COMMANDS_REQUIRING_ACTION = new Set([
  "event-editor",
  "event-registry",
  "event-feedback",
  "map-editor",
  "map-events",
  "patch",
  "memory",
  "workflow-propose",
  "database-changes",
]);

// ── Tool specs ──────────────────────────────────────────────────────

const jsonLike = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string()]).optional();

const eventCommandInput = z.record(z.string(), z.unknown()).describe(
  "One abstract event command, e.g. { kind: \"text\", text: \"...\" }.",
);

const eventContractInput = z.union([
  z.object({
    engine: z.literal("rpg-maker-mv").optional().describe("Required by registry: always \"rpg-maker-mv\"."),
    kind: z.literal("EventContract").optional().describe("Required by registry: always \"EventContract\"."),
    id: z.string().optional().describe("Required dotted id, e.g. town.villager.elder."),
    purpose: z.string().optional().describe("Required human-readable purpose, >= 10 chars."),
    summary: z.string().optional().describe("Optional short UI summary."),
    sceneId: z.string().optional().describe("Optional kebab-case scene id."),
    questline: z.string().optional().describe("Optional kebab-case questline id."),
    status: z.enum(["reviewing", "draft", "placed", "verified", "rejected", "abandoned"]).optional(),
    rmmvTarget: z.object({
      operation: z.enum(["add-map-event", "add-event-page", "add-common-event"]).optional()
        .describe("New events use \"add-map-event\"."),
      mapId: z.number().int().positive().optional().describe("Required for add-map-event/add-event-page."),
      eventId: z.number().int().positive().optional().describe("Required for add-event-page."),
      eventName: z.string().optional().describe("Required for add-map-event, e.g. EV_VillagerElder."),
      commonEventId: z.number().int().positive().optional().describe("Required for add-common-event."),
      trigger: z.enum(["action-button", "player-touch", "event-touch", "autorun", "parallel", "none"]).optional(),
    }).passthrough().optional().describe("Required target block. Do not include x/y for new map events; placement is manual."),
    implementation: z.object({
      commands: z.array(eventCommandInput).optional()
        .describe("Single-page abstract commands. Minimal dialogue: [{ kind: \"text\", text: \"...\" }]."),
      pages: z.array(z.object({
        trigger: z.enum(["action-button", "player-touch", "event-touch", "autorun", "parallel", "none"]).optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        commands: z.array(eventCommandInput).optional(),
      }).passthrough()).optional().describe("Multi-page abstract event implementation."),
    }).passthrough().optional().describe("Required implementation block with commands[] or pages[]."),
    preconditions: z.record(z.string(), z.unknown()).optional(),
    effects: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  z.string().describe("JSON string containing the EventContract object."),
]).optional().describe(
  "registry.register/validate EventContract. After register, event stays in reviewing preview until user approves into placement queue. Do not include x/y in rmmvTarget for new map events.",
);

const databasePatchOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: z.string() }).strict(),
]);

const databaseChange = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    table: z.enum(RMMV_ARRAY_DATABASE_TABLES),
    id: z.number().int().positive().optional(),
    patches: z.array(databasePatchOperation).optional(),
  }).strict(),
  z.object({
    op: z.literal("patch"),
    table: z.enum(RMMV_DATABASE_TABLES),
    id: z.number().int().nonnegative(),
    patches: z.array(databasePatchOperation).min(1),
  }).strict(),
  z.object({
    op: z.literal("reset"),
    table: z.enum(RMMV_ARRAY_DATABASE_TABLES),
    id: z.number().int().positive(),
  }).strict(),
  z.object({
    op: z.literal("type.rename"),
    field: z.enum(RMMV_TYPE_LIST_FIELDS),
    id: z.number().int().positive(),
    name: z.string(),
  }).strict(),
  z.object({
    op: z.literal("type.append"),
    field: z.enum(RMMV_TYPE_LIST_FIELDS),
    name: z.string(),
  }).strict(),
  z.object({
    op: z.literal("type.removeTail"),
    field: z.enum(RMMV_TYPE_LIST_FIELDS),
    id: z.number().int().positive(),
  }).strict(),
]);

type RmmvMcpToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  readOnly: boolean;
  destructive?: boolean;
};

const RMMV_MCP_TOOLS: RmmvMcpToolSpec[] = [
  {
    name: "RmmvReadContext",
    description:
      "Read project facts without mutating the project: eventContext, mapIndex, assetInventory, pluginInventory, mapData, tilesets, projectStaging, mapStaging, paginated dbCatalog, full dbEntry records, stateSlots, and commonEventReferences.",
    inputSchema: {
      action: z.enum([
        "eventContext", "mapIndex", "assetInventory", "pluginInventory", "mapData", "tilesets", "projectStaging", "mapStaging",
        "dbCatalog", "dbEntry", "stateSlots", "commonEventReferences",
      ]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      mapId: z.number().int().optional().describe("eventContext/mapData/mapStaging: map id."),
      eventId: z.number().int().optional().describe("eventContext: event id."),
      tables: z.array(z.enum(RMMV_DATABASE_TABLES)).optional().describe(
        "dbCatalog: tables to read. One or more of: actors, classes, skills, items, weapons, armors, enemies, troops, states, animations, tilesets, commonEvents, system, types, terms.",
      ),
      query: z.string().optional().describe("dbCatalog: case-insensitive name or decimal-id substring filter."),
      offset: z.number().int().nonnegative().optional().describe("dbCatalog: per-table result offset (default 0)."),
      limit: z.number().int().min(1).max(200).optional().describe("dbCatalog: per-table page size (default 50, maximum 200)."),
      includeUnnamed: z.boolean().optional().describe("dbCatalog: include unnamed non-null records (default true)."),
      table: z.enum(RMMV_DATABASE_TABLES).optional().describe("dbEntry: database table to read."),
      id: z.number().int().nonnegative().optional().describe("dbEntry: positive array-table id; System, Types, and Terms use id 0."),
      switches: z.number().int().optional().describe("stateSlots: max switch candidates to surface."),
      variables: z.number().int().optional().describe("stateSlots: max variable candidates to surface."),
      commonEvents: z.number().int().optional().describe("stateSlots: max common-event candidates to surface."),
      commonEventId: z.number().int().optional().describe("commonEventReferences: id to look up."),
    },
    readOnly: true,
  },
  {
    name: "RmmvDatabase",
    description:
      "Main-agent-only controlled database preparation. validate and dryRun never write; stage writes operation-owned drafts only; discard removes exactly one operation draft. Source project files are never applied by this tool.",
    inputSchema: {
      action: z.enum(["validate", "dryRun", "stage", "discard"]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      changes: z.array(databaseChange).min(1).optional().describe("Required for validate, dryRun, and stage."),
      planHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().describe("stage: exact planHash returned by the current dryRun."),
      operationId: z.string().optional().describe("discard: operation id to discard."),
      sessionId: z.string().optional().describe("stage: originating main-agent session id."),
    },
    readOnly: false,
    destructive: true,
  },
  {
    name: "RmmvDatabaseApply",
    description:
      "Apply exactly one previously staged database operation after native user approval. Accepts only operationId (plus project routing); rechecks source/draft hashes, plan metadata, input drift, and all semantic rules before an atomic source write.",
    inputSchema: {
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      operationId: z.string().min(1).describe("The staged database operation id shown on the approval card."),
    },
    readOnly: false,
    destructive: true,
  },
  {
    name: "RmmvVerify",
    description:
      "Main-agent-only strict playtest probe. Copies the source project without saves, overlays all current staging, optionally changes only the copied start position, and runs Game.exe in a hidden bounded worker. Returns verified only when screen, exact map/coordinates, runtime readiness, event idle, JavaScript-error absence, source/save/staging stability, process exit, and temporary cleanup are all proven.",
    inputSchema: {
      action: z.literal("playtest.probe"),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      mapId: z.number().int().positive().optional().describe("Optional map id. When provided, x and y are both required."),
      x: z.number().int().nonnegative().optional().describe("Optional copied-project start X; requires mapId and y."),
      y: z.number().int().nonnegative().optional().describe("Optional copied-project start Y; requires mapId and x."),
      timeoutSeconds: z.number().int().min(5).max(60).optional().describe("Probe limit in seconds (default 30; range 5-60)."),
    },
    readOnly: false,
  },
  {
    name: "RmmvMap",
    description:
      "Operate the current map editor backend: create/update/duplicate/remove maps, paint validated tile edits, and explicitly apply or discard staging. Only exposes features already present in the desktop map editor.",
    inputSchema: {
      action: z.enum([
        "create", "updateProperties", "duplicate", "remove", "paint",
        "applyMap", "discardMap", "applyProject", "discardProject",
      ]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      mapId: z.number().int().positive().optional().describe("Target map id."),
      parentId: z.number().int().nonnegative().optional().describe("Parent map id; 0 means project root."),
      name: z.string().optional().describe("Map editor name."),
      width: z.number().int().min(1).max(256).optional(),
      height: z.number().int().min(1).max(256).optional(),
      tilesetId: z.number().int().positive().optional(),
      edits: z.array(z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        layer: z.number().int().min(0).max(5),
        tileId: z.number().int().nonnegative().optional(),
        autotileKind: z.number().int().nonnegative().optional(),
      })).optional().describe("paint: non-empty validated cell edits."),
    },
    readOnly: false,
    destructive: true,
  },
  {
    name: "RmmvEvent",
    description:
      "Event contract registry, command patching, feedback, and editor operations on already-placed map events only. "
      + "New map events: registry.register with the full implementation, the user previews it in the sidebar, the agent asks whether to apply it to the placement queue with apply/adjust/cancel options, and after approval the user drags it onto the RPG Agent MV desktop map canvas through createPlacementEvent. "
      + "Never use editor.update or editor.move to set x/y for new events; never tell the user to place events in external RPG Maker MV editor.",
    inputSchema: {
      action: z.enum([
        "registry.list", "registry.validate", "registry.scaffold",
        "registry.register", "registry.show", "registry.reconcile",
        "registry.adopt", "registry.reject", "registry.approve",
        "patch.dryRun", "patch.apply",
        "map.remove", "map.removeBatch",
        "feedback.record", "feedback.list", "feedback.summary",
        "editor.update", "editor.move", "editor.remove",
      ]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      contract: eventContractInput,
      spec: jsonLike.describe("patch/map: spec data."),
      id: z.string().optional().describe("Contract id, dotted (e.g. tavern.bartender.intro)."),
      purpose: z.string().optional().describe("Contract purpose, >= 10 chars."),
      eventName: z.string().optional().describe("RMMV event name (e.g. EV_Intro)."),
      trigger: z.string().optional().describe("Event trigger (e.g. action-button)."),
      text: z.string().optional().describe("Initial dialogue text."),
      sceneId: z.string().optional().describe("Scene id, kebab-case."),
      questline: z.string().optional().describe("Questline id, kebab-case."),
      mapId: z.number().int().optional().describe("Map id. editor.* actions require an existing placed event on this map; not for new-event placement."),
      eventId: z.number().int().optional().describe("Existing map event id. Required for editor.update/move/remove on already-placed events."),
      apply: z.boolean().optional().describe("reconcile: apply instead of previewing."),
      orphans: z.boolean().optional().describe("reconcile: include orphan events."),
      abandon: z.boolean().optional().describe("reject: mark abandoned."),
      reason: z.string().optional().describe("reject: reason text."),
      agent: z.string().optional().describe("Agent attribution."),
      taskId: z.string().optional().describe("Task/session id."),
      contractId: z.string().optional().describe("feedback: EventContract id."),
      verdict: z.enum(["accept", "revise", "reject"]).optional().describe("feedback.record verdict."),
      tags: z.union([z.array(z.string()), z.string()]).optional().describe("feedback.record tags array or comma-separated string."),
      notes: z.string().optional().describe("feedback.record note."),
      note: z.string().optional().describe("feedback.record note."),
      session: z.string().optional().describe("feedback.record session id."),
      sessionId: z.string().optional().describe("feedback.record session id."),
      event: z.record(z.string(), z.unknown()).optional().describe("editor.update: partial fields for an existing placed event (commands/pages/conditions). Not for initial placement or x/y."),
      x: z.number().int().nonnegative().optional().describe("editor.move: target x for relocating an existing placed event. Not for new-event placement."),
      y: z.number().int().nonnegative().optional().describe("editor.move: target y for relocating an existing placed event. Not for new-event placement."),
    },
    readOnly: false,
    destructive: true,
  },
  {
    name: "RmmvMemory",
    description:
      "Durable, cross-session memory for THIS project. Record only soft knowledge (character voice, "
      + "user taste, rejected approaches, staging conventions, cross-session decisions) — keep hard facts "
      + "(events, outline, switches/variables) in their existing stores; a memory may point at a record but "
      + "must not copy it. Writes are path-locked to the project memory directory.",
    inputSchema: {
      action: z.enum(["memory.list", "memory.read", "memory.write", "memory.remove", "memory.reindex", "memory.read-profile", "memory.write-profile", "progress.write"]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      relPath: z.string().optional().describe("memory.read: file relative to the project memory dir (e.g. topics/foo.md, MEMORY.md, AGENTS.md)."),
      name: z.string().optional().describe("memory.write: short human title for the memory."),
      description: z.string().optional().describe("memory.write: one-line description used for recall."),
      type: z.enum(["character", "preference", "decision", "convention"]).optional().describe("memory.write: topic category (default convention)."),
      body: z.string().optional().describe("memory.write: markdown body of the durable note. memory.write-profile: the full shared author profile (USER.md) text to store (read-profile first, then merge, then write the whole thing back). progress.write: current progress summary."),
      slug: z.string().optional().describe("memory.write/remove: explicit topic slug; defaults to a slug of the name."),
      sessionId: z.string().optional().describe("progress.write: session id whose current progress is being updated."),
      status: z.enum(["pass", "blocked", "stopped", "failed", "error", "interrupted", "timeout", "unknown"]).optional().describe("progress.write: terminal status for this conversation."),
      current: z.string().optional().describe("progress.write: what this conversation accomplished or where it currently stands."),
      next: z.string().optional().describe("progress.write: concrete next step for continuation."),
      blockers: z.string().optional().describe("progress.write: blocker or missing input, if any."),
    },
    readOnly: false,
  },
  {
    name: "RmmvWorkflow",
    description:
      "Propose a read-only multi-agent workflow by writing a JS orchestration script for the user to approve. "
      + "workflow.propose does NOT run anything: it queues a proposal that the user approves as a PLAN in the desktop "
      + "(they read your natural-language `summary` plan, NOT the code) before it runs in the background. Every subagent "
      + "it spawns is hard-forced read-only — it can "
      + "read/grep/inspect the project but NEVER edits files or places events; the workflow only returns a report.\n"
      + "The script is an async body that may `return` a JSON-serializable report. Available globals (nothing else — "
      + "no require/process/fs/network):\n"
      + "  agent({ prompt, label, schema? }) -> Promise<{ ok, text, data? }>  // fan out one read-only subagent\n"
      + "  parallel([() => agent(...), ...]) -> Promise<any[]>                // barrier: run all, await together\n"
      + "  pipeline(items, stage1, stage2, ...) -> Promise<any[]>             // each item flows through stages, no barrier\n"
      + "  log(message)                                                       // progress line back to the chat\n"
      + "  args                                                               // optional inputs (usually unused; embed data in the script)\n"
      + "Quality pattern: fan out several reviewers (parallel), then adversarially verify each finding with independent "
      + "skeptics before keeping it. The submitted script is persisted to a standalone .js file (its path is returned), "
      + "which the user can review and edit before approving — the approved run executes the file's current contents. "
      + "Only the top-level conversation agent has this tool; read-only subagents do not, so workflows never nest.",
    inputSchema: {
      action: z.enum(["workflow.propose"]).optional().describe('Always "workflow.propose".'),
      script: z.string().describe("The JS orchestration script (async body using agent/parallel/pipeline/log; may return a report)."),
      summary: z.string().optional().describe("A short natural-language PLAN shown on the approval card — the user approves THIS, not the code. State what the workflow does, its stages, how many subagents it fans out, and the rough cost. Write it in the user's language; Markdown is fine."),
      title: z.string().optional().describe("Short title for the approval card."),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      sessionId: z.string().optional().describe("Originating conversation id, to route the report back."),
    },
    readOnly: false,
  },
  {
    name: "RmmvStage",
    description:
      "Workflow-only: register a PENDING (to-be-placed) event for the user to drop onto the map. "
      + "stage.register validates and stores an EventContract as a draft — it NEVER places the event, "
      + "never sets x/y, never edits the project or any already-placed event; the user manually places it "
      + "on the desktop map canvas afterwards. stage.validate checks a contract without storing anything. "
      + "This is the single controlled write available to read-only workflow subagents; everything else stays read-only. "
      + "Duplicate/conflicting registrations are rejected by the registry, so parallel subagents cannot double-stage.",
    inputSchema: {
      action: z.enum(["stage.validate", "stage.register"]),
      contract: eventContractInput,
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
    },
    readOnly: false,
  },
  // Deprecated: broad legacy RmmvTest actions remain removed. Use RmmvVerify
  // only for the strict isolated probe above.
];

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const workflowRoot = resolveWorkflowRootFromInput({});
  initFileLogger();
  await bootstrapDatabase(workflowRoot);

  const log = toolLogger("mcp-server");

  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args: unknown[]) => { log.warn(...args); origWarn(...args); };
  console.error = (...args: unknown[]) => { log.error(...args); origError(...args); };

  const server = new McpServer(
    { name: "rmmv-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  for (const spec of RMMV_MCP_TOOLS) {
    server.registerTool(spec.name, {
      description: spec.description,
      inputSchema: Object.keys(spec.inputSchema).length > 0 ? spec.inputSchema : undefined,
      annotations: { readOnlyHint: spec.readOnly, destructiveHint: Boolean(spec.destructive) },
    }, async (input: unknown) => {
      const args = (input as Record<string, unknown>) || {};
      const rawAction = spec.name === "RmmvDatabaseApply" ? "apply" : String(args.action ?? "");
      const command = spec.name === "RmmvDatabaseApply" ? "database-apply" : ACTION_TO_COMMAND[rawAction];
      if (!command) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `Unknown action: ${rawAction}` }) }],
          isError: true,
        };
      }

      const subAction = resolveSubAction(rawAction);
      const handlerInput: RmmvHandlerInput = {
        ...args,
        action: COMMANDS_REQUIRING_ACTION.has(command) ? subAction : undefined,
        workflowRoot,
      };
      // stage.register 是只读子 agent 的唯一受控写口，设计上只暂存待放置草稿（NEVER places）。
      // 拒绝调用方传入 placed/verified：这两个状态只能由桌面放置/核对动作写入，
      // 让子 agent 直接落 placed 会伪造注册表身份、污染对账（误认领已有事件）。
      if (rawAction === "stage.register") {
        const contract = handlerInput.contract as Record<string, unknown> | undefined;
        const contractStatus = typeof contract?.status === "string" ? contract.status : undefined;
        if (contractStatus === "placed" || contractStatus === "verified") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              ok: false,
              error: `stage.register cannot set status "${contractStatus}"; placed/verified are only set by the desktop placement/verification actions. Use draft or reviewing.`,
            }) }],
            isError: true,
          };
        }
      }
      const tmpDirs: string[] = [];
      try {
        materializeInlineJsonFields(handlerInput, tmpDirs);
        const productLanguage = normalizeProductLanguage(process.env.RMMV_PRODUCT_LANGUAGE);
        const result = await withProductLanguage(productLanguage, () => dispatchRmmvTool(command, handlerInput));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Tool execution failed [${command}/${rawAction}]: ${message}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
          isError: true,
        };
      } finally {
        for (const dir of tmpDirs) {
          try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[rmmv-mcp] ${RMMV_MCP_TOOLS.length} tools ready on stdio\n`);

  const shutdown = async () => { await server.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("disconnect", shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[rmmv-mcp] init failed: ${message}\n`);
  process.exit(1);
});
