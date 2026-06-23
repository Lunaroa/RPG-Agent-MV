#!/usr/bin/env node
/**
 * Stdio MCP server for RMMV tools.
 *
 * Started by opencode via stdio transport.
 *
 * Simplified workflow (2026-06): removed RmmvTest
 * (playability/runtime checks unreliable in RMMV).
 *
 * Action naming conventions:
 *   - RmmvReadContext:  project, asset, plugin, and map facts
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
import { DEFAULT_PRODUCT_LANGUAGE } from "../../../../contract/i18n.ts";
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
  "stateSlots": "state-slots",
  "commonEventReferences": "common-event-references",
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
      "Read project facts: eventContext, mapIndex, assetInventory, pluginInventory, mapData, tilesets, projectStaging, mapStaging, dbCatalog, stateSlots, and commonEventReferences.",
    inputSchema: {
      action: z.enum([
        "eventContext", "mapIndex", "assetInventory", "pluginInventory", "mapData", "tilesets", "projectStaging", "mapStaging",
        "dbCatalog", "stateSlots", "commonEventReferences",
      ]),
      project: z.string().optional().describe("RMMV project root. Defaults to the MCP process cwd."),
      mapId: z.number().int().optional().describe("eventContext/mapData/mapStaging: map id."),
      eventId: z.number().int().optional().describe("eventContext: event id."),
      tables: z.array(z.string()).optional().describe(
        "dbCatalog: tables to read. One or more of: actors, classes, skills, items, weapons, armors, enemies, troops, states, animations, tilesets, commonEvents, system, types, terms.",
      ),
      query: z.string().optional().describe("dbCatalog: case-insensitive name substring filter."),
      limit: z.number().int().optional().describe("dbCatalog: per-table row cap (default 50)."),
      switches: z.number().int().optional().describe("stateSlots: max switch candidates to surface."),
      variables: z.number().int().optional().describe("stateSlots: max variable candidates to surface."),
      commonEvents: z.number().int().optional().describe("stateSlots: max common-event candidates to surface."),
      commonEventId: z.number().int().optional().describe("commonEventReferences: id to look up."),
    },
    readOnly: true,
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
      + "New map events: registry.register with the full implementation, the user previews it in the sidebar, the agent asks whether to apply it to the placement queue with apply/adjust/cancel options, and after approval the user drags it onto the RPG-Agent-MV desktop map canvas through createPlacementEvent. "
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
  // Deprecated (simplified workflow 2026-06):
  // RmmvTest — playability/runtime checks unreliable in RMMV environment
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
      const rawAction = String(args.action ?? "");
      const command = ACTION_TO_COMMAND[rawAction];
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
      const tmpDirs: string[] = [];
      try {
        materializeInlineJsonFields(handlerInput, tmpDirs);
        const result = await withProductLanguage(DEFAULT_PRODUCT_LANGUAGE, () => dispatchRmmvTool(command, handlerInput));
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
