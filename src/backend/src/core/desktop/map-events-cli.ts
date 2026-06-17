import fs from "node:fs";
import path from "node:path";

import { readJson } from "../rmmv/json.ts";
import { resolveWorkflowRoot } from "../workspace-paths.ts";
import { removeEvent } from "./event-service.ts";

interface CliArgs {
  project?: string;
  mapId?: number | string;
  eventId?: number | string;
  spec?: string;
  dryRun?: boolean;
  _positional?: string[];
  [key: string]: unknown;
}

interface MapEventRef {
  mapId: number;
  eventId: number;
}

interface RemoveBatchSpec {
  events?: MapEventRef[];
  deletions?: MapEventRef[];
}

function parseFlags(rest: string[]): CliArgs {
  const args: CliArgs = { _positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._positional!.push(token);
    }
  }
  return args;
}

function requireFlag(args: CliArgs, name: string): void {
  if (args[name] === undefined || args[name] === "") {
    throw new Error(`Missing required flag --${name}.`);
  }
}

function parsePositiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function normalizeRefs(payload: RemoveBatchSpec | MapEventRef[]): MapEventRef[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.events)
      ? payload.events
      : Array.isArray(payload.deletions)
        ? payload.deletions
        : null;
  if (!list || !list.length) {
    throw new Error("Batch spec must be a non-empty array or an object with events[] / deletions[].");
  }
  return list.map((entry, index) => ({
    mapId: parsePositiveInt(entry.mapId, `events[${index}].mapId`),
    eventId: parsePositiveInt(entry.eventId, `events[${index}].eventId`),
  }));
}

function loadBatchSpec(specPath: string): MapEventRef[] {
  const resolved = path.resolve(specPath);
  const payload = readJson(resolved) as RemoveBatchSpec | MapEventRef[];
  return normalizeRefs(payload);
}

export function removeMapEvent(
  workflowRoot: string,
  projectPath: string,
  mapId: number,
  eventId: number,
  options?: { dryRun?: boolean },
) {
  if (options?.dryRun) {
    return {
      op: "delete",
      mapId,
      eventId,
      dryRun: true,
      project: path.resolve(projectPath),
    };
  }
  return removeEvent(workflowRoot, projectPath, mapId, eventId);
}

export function removeMapEventsBatch(
  workflowRoot: string,
  projectPath: string,
  refs: MapEventRef[],
  options?: { dryRun?: boolean },
) {
  const results: unknown[] = [];
  const errors: Array<{ mapId: number; eventId: number; message: string }> = [];
  for (const ref of refs) {
    try {
      results.push(removeMapEvent(workflowRoot, projectPath, ref.mapId, ref.eventId, options));
    } catch (error) {
      errors.push({
        mapId: ref.mapId,
        eventId: ref.eventId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    project: path.resolve(projectPath),
    requested: refs.length,
    removed: results.length,
    failed: errors.length,
    dryRun: Boolean(options?.dryRun),
    results,
    errors,
    status: errors.length ? "partial" : "ok",
  };
}

async function runRemove(workflowRoot: string, args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  requireFlag(args, "map-id");
  requireFlag(args, "event-id");
  const projectPath = path.resolve(args.project as string);
  const mapId = parsePositiveInt(args["map-id"], "--map-id");
  const eventId = parsePositiveInt(args["event-id"], "--event-id");
  const result = removeMapEvent(workflowRoot, projectPath, mapId, eventId, {
    dryRun: Boolean(args["dry-run"]),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function runRemoveBatch(workflowRoot: string, args: CliArgs): Promise<number> {
  requireFlag(args, "project");
  requireFlag(args, "spec");
  const projectPath = path.resolve(args.project as string);
  const specPath = path.resolve(args.spec as string);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }
  const refs = loadBatchSpec(specPath);
  const result = removeMapEventsBatch(workflowRoot, projectPath, refs, {
    dryRun: Boolean(args["dry-run"]),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "ok" ? 0 : 1;
}

function printUsage(): number {
  process.stderr.write(
    "Map event removal is exposed through mcp__rmmv__RmmvEvent actions: map.remove and map.removeBatch.\n",
  );
  return 1;
}

export async function runCli(argv?: string[]): Promise<number> {
  const [sub, ...rest] = argv || [];
  if (!sub) {
    return printUsage();
  }
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const args = parseFlags(rest);
  try {
    if (sub === "remove") {
      return await runRemove(workflowRoot, args);
    }
    if (sub === "remove-batch") {
      return await runRemoveBatch(workflowRoot, args);
    }
    process.stderr.write(`map-events: unknown subcommand "${sub}".\n`);
    return printUsage();
  } catch (error) {
    process.stderr.write(`map-events ${sub} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
