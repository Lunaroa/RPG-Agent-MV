import path from "node:path";

/**
 * Resolve the canonical memory partition id for the active project.
 *
 * Memory is partitioned per project under `memory/main/<projectId>/`. The id MUST
 * match `event_contracts.project_id` so memory lines up with the hard-fact SQLite
 * stores. The event registry derives that id as `path.basename(projectRoot)`
 * (see rmmv-handlers `resolveFeedbackProjectId`), so we mirror it exactly.
 *
 * Resolution order:
 *  1. An explicit `projectId` override (already canonical), if provided.
 *  2. `basename` of the resolved project path.
 *  3. `null` — no resolvable project ⇒ shared-only scope (no per-project memory).
 */
export function resolveActiveProjectId(input: {
  projectId?: string | null;
  projectPath?: string | null;
}): string | null {
  const explicit = String(input.projectId ?? "").trim();
  if (explicit) {
    const id = sanitizeProjectId(explicit);
    if (id) return id;
  }

  const projectPath = String(input.projectPath ?? "").trim();
  if (projectPath) {
    const base = path.basename(path.resolve(projectPath));
    const id = sanitizeProjectId(base);
    if (id) return id;
  }
  return null;
}

/**
 * Guard the project id against path traversal: it becomes a single directory name
 * under the memory root, so it must not contain separators or `..`.
 */
function sanitizeProjectId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "";
  if (/[\\/]/.test(trimmed)) return "";
  return trimmed;
}
