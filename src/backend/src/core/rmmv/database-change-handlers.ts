import {
  commitRmmvDatabaseChanges,
  dryRunRmmvDatabaseChanges,
  validateRmmvDatabaseChanges,
  type RmmvDatabaseChange,
} from "./database-changes.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

export function runRmmvDatabaseChanges(input: RmmvHandlerInput): RmmvHandlerResult {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const action = String(input.action || "");
  if (action === "validate") {
    const validation = validateRmmvDatabaseChanges(workflowRoot, project, {
      changes: requireChanges(input.changes),
    });
    return {
      summary: validation.ok
        ? "Database change batch is valid. Unknown plugin semantics were not validated."
        : `Database change batch has ${validation.issues.filter((issue) => issue.severity === "error").length} blocking error(s).`,
      data: validation,
    };
  }
  if (action === "dry-run") {
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, {
      changes: requireChanges(input.changes),
    });
    return {
      summary: `Prepared database dry run ${plan.planHash} for ${plan.files.length} file(s); no draft or source file was written.`,
      data: plan,
    };
  }
  if (action === "commit") {
    const committed = commitRmmvDatabaseChanges(workflowRoot, project, {
      changes: requireChanges(input.changes),
      planHash: requireString(input.planHash, "planHash"),
      ...(typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
    });
    return {
      summary: `Saved approved database changes to ${committed.files.length} project file(s) atomically.`,
      data: committed,
    };
  }
  throw new Error(`Unsupported RmmvDatabase action: ${action}`);
}

function requireChanges(value: unknown): RmmvDatabaseChange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("changes must be a non-empty database change array.");
  }
  return value as RmmvDatabaseChange[];
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
