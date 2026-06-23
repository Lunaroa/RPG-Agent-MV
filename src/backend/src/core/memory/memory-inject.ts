import { resolveActiveProjectId } from "./active-project.ts";
import { readMemorySettings } from "./memory-settings.ts";
import { composeMemoryPreamble, readMemoryPreambleParts, type MemoryPreambleMode } from "./memory-preamble.ts";
import { buildRecallManifest, loadRecalledBodies, selectRelevantTopics } from "./recall.ts";

export interface ResolveMemoryPreambleInput {
  workflowRoot: string;
  /** Active game project path (inner agent cwd). */
  projectPath?: string | null;
  /** The task intent, used as the recall side-query's relevance target. */
  taskIntent: string;
  /** "full" = fresh session (profile+index+bodies); "incremental" = continuation (bodies only). */
  mode?: MemoryPreambleMode;
  /** Slugs already surfaced earlier in this conversation; excluded from this turn's recall. */
  alreadySurfaced?: string[];
  /**
   * Run the recall LLM side-query? Defaults true. Preview/dry-run dispatch passes false so a
   * non-executing preview never spends a model call whose result it would only discard (the real
   * execution turn re-runs recall anyway).
   */
  runRecall?: boolean;
  signal?: AbortSignal;
}

export interface ResolvedMemoryPreamble {
  /** Composed preamble text; "" ⇒ inject nothing. */
  preamble: string;
  /** Slugs newly surfaced this turn, to fold into the conversation's running surfaced set. */
  surfacedSlugs: string[];
}

/**
 * Async orchestrator for the injected memory preamble. Lives outside the pure
 * `memory-preamble` composer because it reads DB-backed settings and runs the recall
 * side-query. Returns an empty result when no project scope resolves OR the master switch is off.
 *
 * Recall runs only when a recall model is configured; otherwise the index is injected
 * without pre-loaded topic bodies (recall OFF, no fabricated relevance). On continuation turns
 * (`mode: "incremental"`) only the newly-surfaced bodies are emitted, and `alreadySurfaced`
 * topics are excluded so the same notes are not re-injected every turn.
 */
export async function resolveMemoryPreamble(input: ResolveMemoryPreambleInput): Promise<ResolvedMemoryPreamble> {
  const projectId = resolveActiveProjectId({ projectPath: input.projectPath ?? undefined });
  if (!projectId) return { preamble: "", surfacedSlugs: [] };

  const settings = readMemorySettings();
  if (!settings.enabled) return { preamble: "", surfacedSlugs: [] };

  const mode = input.mode ?? "full";
  const parts = readMemoryPreambleParts(input.workflowRoot, projectId);
  let surfacedSlugs: string[] = [];
  if (settings.recallModel && input.runRecall !== false) {
    const manifest = buildRecallManifest(input.workflowRoot, projectId);
    surfacedSlugs = await selectRelevantTopics({
      workflowRoot: input.workflowRoot,
      manifest,
      taskIntent: input.taskIntent,
      recallModel: settings.recallModel,
      alreadySurfaced: input.alreadySurfaced,
      signal: input.signal,
    });
    parts.recalledBodies = loadRecalledBodies(input.workflowRoot, projectId, surfacedSlugs);
  }
  return { preamble: composeMemoryPreamble(parts, mode), surfacedSlugs };
}
