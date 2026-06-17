export const CONVERSATION_PLAN_DIR = ".opencode/plans/conversations";

export interface ConversationPlanSessionRef {
  id: string;
  parentSessionId: string | null;
  planFilePath?: string | null;
}

export function buildConversationPlanRelativePath(conversationRootId: string): string {
  const normalized = String(conversationRootId || "").trim();
  if (!normalized) {
    throw new Error("conversation root session id is required to build plan path");
  }
  return `${CONVERSATION_PLAN_DIR}/${normalized}.md`;
}

export function resolveConversationRootSessionId(
  sessionId: string,
  getSession: (id: string) => ConversationPlanSessionRef | undefined,
): string {
  const seen = new Set<string>();
  let current = getSession(sessionId);
  if (!current) return sessionId;

  while (current.parentSessionId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = getSession(current.parentSessionId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export function resolveSessionPlanFilePath(
  session: ConversationPlanSessionRef,
  getSession: (id: string) => ConversationPlanSessionRef | undefined,
): string {
  const seen = new Set<string>();
  let current: ConversationPlanSessionRef | undefined = session;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.planFilePath?.trim()) return current.planFilePath.trim();
    current = current.parentSessionId ? getSession(current.parentSessionId) : undefined;
  }

  const rootId = resolveConversationRootSessionId(session.id, getSession);
  return buildConversationPlanRelativePath(rootId);
}

export function allocateSessionPlanFilePath(
  sessionId: string,
  parent: ConversationPlanSessionRef | undefined,
  getSession: (id: string) => ConversationPlanSessionRef | undefined,
): string {
  if (parent) {
    return resolveSessionPlanFilePath(parent, getSession);
  }
  return buildConversationPlanRelativePath(sessionId);
}

export function isConversationPlanPath(filePath: string): boolean {
  const normalized = String(filePath || "").replace(/\\/g, "/").trim();
  if (!normalized) return false;
  return /(?:^|[/\\])\.opencode[/\\]plans[/\\]conversations[/\\][^/\\]+\.md$/i.test(normalized);
}

/** User-prompt lines that anchor plan writes to the current conversation plan file. */
export function buildSessionPlanPathPromptLines(planFilePath: string): string[] {
  const normalized = String(planFilePath || "").trim();
  if (!normalized) return [];
  return [
    `Session plan file: ${normalized}`,
    "Write or edit plans only at Session plan file / AGENT_RPG_SESSION_PLAN_PATH. Do not use AGENT_RPG_TMP_DIR, logs/tmp, or project-root PLAN.md for plans.",
  ];
}
