import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";
import { resolveActiveProjectId } from "../memory/active-project.ts";
import {
  clearProjectMemory,
  listProjectMemory,
  readMemoryFile,
  readUserProfile,
  reindexProjectMemory,
  removeTopic,
  writeCurrentProgress,
  writeTopic,
  writeUserProfile,
} from "../memory/memory-store.ts";

/**
 * `RmmvMemory` MCP handler: the inner agent's only write path into durable memory.
 *
 * The path-lock lives in memory-store (`assertInsideMemoryDir`); this handler just
 * resolves the active project (basename of the RMMV project root, matching
 * `event_contracts.project_id`) and delegates. It never touches files outside the
 * project's `memory/main/<projectId>/` directory.
 */
export function runRmmvMemory(input: RmmvHandlerInput): RmmvHandlerResult {
  const action = String(input.action ?? "").trim().toLowerCase();
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const projectId = resolveActiveProjectId({ projectPath: resolveProjectRoot(input) });
  if (!projectId) {
    throw new Error("Cannot resolve the active project; pass --project pointing at the RMMV project root.");
  }

  switch (action) {
    case "list": {
      const snapshot = listProjectMemory(workflowRoot, projectId);
      const summary = snapshot.files.length
        ? `Memory for "${projectId}" (${snapshot.files.length} file(s)):\n`
          + snapshot.files.map((f) => `  ${f.relPath}${f.description ? ` — ${f.description}` : ""}`).join("\n")
        : `Memory for "${projectId}" is empty.`;
      return { summary, data: snapshot };
    }
    case "read": {
      const relPath = stringField(input, ["relPath", "path", "file"]);
      if (!relPath) throw new Error('memory read requires "relPath" (e.g. topics/foo.md, MEMORY.md, AGENTS.md).');
      const content = readMemoryFile(workflowRoot, projectId, relPath);
      return { summary: content || `(empty) ${relPath}`, data: { relPath, content } };
    }
    case "write": {
      const name = stringField(input, ["name"]);
      const description = stringField(input, ["description"]);
      const body = stringField(input, ["body", "content", "text"]);
      const type = stringField(input, ["type"]) || "convention";
      const slug = stringField(input, ["slug"]) || undefined;
      if (!name) throw new Error('memory write requires "name".');
      if (!body) throw new Error('memory write requires "body".');
      const result = writeTopic(workflowRoot, projectId, { name, description, type, body, slug });
      return { summary: `Saved memory "${result.slug}" for "${projectId}".`, data: result };
    }
    case "remove": {
      const slug = stringField(input, ["slug", "name"]);
      if (!slug) throw new Error('memory remove requires "slug" (or the topic name).');
      const removed = removeTopic(workflowRoot, projectId, slug);
      return {
        summary: removed ? `Removed memory "${slug}" for "${projectId}".` : `No memory "${slug}" found for "${projectId}".`,
        data: { slug, removed },
      };
    }
    case "reindex": {
      const index = reindexProjectMemory(workflowRoot, projectId);
      return { summary: `Rebuilt the long-term index for "${projectId}".`, data: { index } };
    }
    case "progress.write": {
      const sessionId = stringField(input, ["sessionId"]);
      const current = stringField(input, ["current", "body", "content", "text"]);
      const next = stringField(input, ["next"]);
      const blockers = stringField(input, ["blockers", "blocker"]);
      const status = stringField(input, ["status"]);
      const progress = writeCurrentProgress(workflowRoot, projectId, {
        sessionId,
        status,
        current,
        next,
        blockers,
      });
      return {
        summary: `Updated current progress for "${progress.sessionId}".`,
        data: { progress },
      };
    }
    case "read-profile": {
      // The author profile (USER.md) is shared across projects, not scoped to projectId.
      const content = readUserProfile(workflowRoot);
      return { summary: content || "(empty) shared author profile (USER.md).", data: { content } };
    }
    case "write-profile": {
      const body = stringField(input, ["body", "content", "text"]);
      if (!body) throw new Error('memory write-profile requires "body" (the full author profile to store).');
      writeUserProfile(workflowRoot, body);
      return {
        summary: "Updated the shared author profile (USER.md).",
        data: { bytes: Buffer.byteLength(body, "utf8") },
      };
    }
    case "clear": {
      const cleared = clearProjectMemory(workflowRoot, projectId);
      return { summary: cleared ? `Cleared all memory for "${projectId}".` : `No memory to clear for "${projectId}".`, data: { cleared } };
    }
    default:
      throw new Error(`Unknown memory action: ${action || "(none)"}. Use list | read | write | remove | reindex | clear | progress.write | read-profile | write-profile.`);
  }
}

function stringField(input: RmmvHandlerInput, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
