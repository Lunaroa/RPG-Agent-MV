import {
  deleteOpencodeSession,
  forkOpencodeSession,
  runOpencodeSession,
  type OpencodeRunInput,
  type OpencodeRunResult,
  type RuntimeEvent,
} from "../workflow/agent/opencode/runtime.ts";
import { MEMORY_SCRIBE_AGENT } from "../workflow/agent/opencode/config.ts";
import { resolveActiveProjectId } from "./active-project.ts";
import { appendActivityLog } from "./memory-store.ts";

/**
 * Phase 2c — background memory scribe.
 *
 * After a main turn passes, we FORK the live opencode session (inheriting its full
 * conversation context, reusing the same provider/model so the prompt cache stays warm),
 * then run a tiny extraction instruction under the sandboxed `memory-scribe` agent — whose
 * only tool is durable memory. The scribe decides whether anything is worth keeping and, if
 * so, writes it via `RmmvMemory`. The original conversation is never touched: the fork is a
 * separate session and all of its events are swallowed (never surfaced to the user). Any
 * failure is soft — the main turn already succeeded.
 */

const DEFAULT_SCRIBE_TIMEOUT_MS = 120_000;

/** Injection seam so the orchestration is unit-testable without a live opencode server. */
export interface MemoryScribeDeps {
  fork: (opencodeSessionId: string, directory: string, messageID?: string) => Promise<string | null>;
  run: (input: OpencodeRunInput, onEvent: (event: RuntimeEvent) => void) => Promise<OpencodeRunResult>;
  remove: (sessionId: string, directory: string) => Promise<void>;
}

const defaultDeps: MemoryScribeDeps = {
  fork: forkOpencodeSession,
  run: runOpencodeSession,
  remove: deleteOpencodeSession,
};

export interface MemoryScribeInput {
  workflowRoot: string;
  /** The RMMV project cwd the parent session ran in (opencode `directory`). */
  cwd: string;
  /** The live opencode session id of the just-finished parent turn (the fork source). */
  opencodeSessionId: string;
  /** The desktop runtime session id whose CURRENT.md entry should be updated. */
  sourceSessionId?: string;
  /** Terminal status of the parent turn, recorded in CURRENT.md when progress is useful. */
  status?: string;
  /** Same provider/model as the parent turn — keeps the forked prompt cache warm. */
  providerId: string;
  modelId: string;
  /** Exact env + runtime config the parent turn used, so the server singleton is reused (no restart). */
  env: Record<string, string>;
  config: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface MemoryScribeResult {
  ran: boolean;
  forkedSessionId?: string;
  reason?: "fork-failed" | "run-failed";
}

/**
 * The extraction instruction sent to the sandboxed scribe agent. English skeleton (consistent
 * with the rest of the runtime prompts); the memory content itself follows the conversation's
 * own language. Deliberately conservative: do nothing unless something is genuinely durable.
 */
export function buildScribePrompt(input: { sessionId?: string; opencodeSessionId?: string; status?: string } = {}): string {
  const sessionId = input.sessionId?.trim() || "(unknown)";
  const opencodeSessionId = input.opencodeSessionId?.trim() || "(unknown)";
  const status = input.status?.trim() || "unknown";
  return [
    "You are a background memory reflection agent reviewing the conversation above. Your ONLY tool is",
    "`RmmvMemory`. You cannot read, edit, or run anything else.",
    "",
    `Current progress target: session id \`${sessionId}\`, source opencode session id \`${opencodeSessionId}\`, terminal status \`${status}\`.`,
    "",
    "First, decide whether this conversation has useful continuation state. If it does, call",
    "`RmmvMemory` action `progress.write` with:",
    "- `sessionId`: the session id shown above.",
    "- `status`: the terminal status shown above.",
    "- `current`: 1-3 concise lines describing what this conversation accomplished or where it stands.",
    "- `next`: the next concrete step, if any.",
    "- `blockers`: missing input or blocker, if any.",
    "",
    "Then decide whether this conversation produced anything worth remembering LONG-TERM:",
    "- Stable facts about the game project — character voice/personality, the author's standing",
    "  preferences, decisions made, conventions agreed on → save as a topic with",
    "  `RmmvMemory` action `memory.write` (choose type character|preference|decision|convention).",
    "- Stable facts about the AUTHOR themselves (how they like to work, recurring preferences that",
    "  apply across projects) → update the shared profile: first `memory.read-profile`, merge the",
    "  new fact into the existing text WITHOUT deleting or rewriting unrelated parts, then write the",
    "  whole thing back with `memory.write-profile`.",
    "",
    "Rules:",
    "- The MEMORY.md index of what is already stored is in the context above. Do NOT duplicate an",
    "  existing note; if something is already captured, leave it alone or refine that same slug.",
    "- Only record durable, reusable knowledge in long-term memory. Current progress belongs ONLY in",
    "  `progress.write`; never save transient progress as `memory.write`.",
    "- If a previous long-term note is wrong, stale, or duplicated, refine that same slug with",
    "  `memory.write` or remove it with `memory.remove` when the conversation clearly justifies it.",
    "- NEVER invent facts that were not actually established.",
    "- If nothing is worth keeping, do nothing at all and end your turn. That is the common case.",
    "- Keep progress and notes concise. Write them in the same language the conversation used.",
  ].join("\n");
}

/**
 * Fork the parent session and run one sandboxed extraction pass. Fire-and-forget friendly:
 * always resolves, never throws, never affects the parent turn.
 */
export async function runMemoryScribe(
  input: MemoryScribeInput,
  deps: MemoryScribeDeps = defaultDeps,
): Promise<MemoryScribeResult> {
  const forkedSessionId = await deps.fork(input.opencodeSessionId, input.cwd).catch(() => null);
  if (!forkedSessionId) return { ran: false, reason: "fork-failed" };
  try {
    await deps.run(
      {
        workflowRoot: input.workflowRoot,
        cwd: input.cwd,
        prompt: buildScribePrompt({
          sessionId: input.sourceSessionId,
          opencodeSessionId: input.opencodeSessionId,
          status: input.status,
        }),
        sessionId: "memory-scribe",
        opencodeSessionId: forkedSessionId,
        providerId: input.providerId,
        modelId: input.modelId,
        env: input.env,
        config: input.config,
        timeoutMs: input.timeoutMs ?? DEFAULT_SCRIBE_TIMEOUT_MS,
        productLanguage: null,
        agentName: MEMORY_SCRIBE_AGENT,
        signal: input.signal,
      },
      // Swallow every event: the scribe's reasoning and output must never surface to the user.
      () => {},
    );
    const projectId = resolveActiveProjectId({ projectPath: input.cwd });
    if (projectId) {
      appendActivityLog(input.workflowRoot, projectId, {
        op: "review",
        detail: "Background memory review completed",
      });
    }
    return { ran: true, forkedSessionId };
  } catch (err) {
    console.warn("[memory scribe] extraction failed:", (err as Error).message);
    return { ran: false, forkedSessionId, reason: "run-failed" };
  } finally {
    await deps.remove(forkedSessionId, input.cwd).catch(() => {});
  }
}
