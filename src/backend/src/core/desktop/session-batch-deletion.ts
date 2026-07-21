export interface BatchDeletableSession {
  id: string;
  status: string;
  parentSessionId?: string;
}

export interface BatchSessionDeletionPlan {
  orderedIds: string[];
  protectedIds: string[];
  missingIds: string[];
  parentIdById: Record<string, string | undefined>;
}

export interface BatchSessionDeletionResult {
  deletedIds: string[];
  protectedIds: string[];
  missingIds: string[];
  failedIds: string[];
}

const TERMINAL_SESSION_STATUSES = new Set([
  "pass",
  "blocked",
  "failed",
  "error",
  "stopped",
  "interrupted",
  "timeout",
]);

export function planBatchSessionDeletion(
  sessions: ReadonlyMap<string, BatchDeletableSession>,
  requestedIds: readonly string[],
): BatchSessionDeletionPlan {
  const ids = [...new Set(requestedIds.map((id) => String(id).trim()).filter(Boolean))];
  const missingIds = ids.filter((id) => !sessions.has(id));
  const protectedIds = ids.filter((id) => {
    const session = sessions.get(id);
    return Boolean(session && !TERMINAL_SESSION_STATUSES.has(session.status));
  });
  const parentIdById = Object.fromEntries(ids.map((id) => [id, sessions.get(id)?.parentSessionId]));
  if (missingIds.length || protectedIds.length) {
    return { orderedIds: [], protectedIds, missingIds, parentIdById };
  }

  const depthById = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthById.get(id);
    if (cached != null) return cached;
    const seen = new Set<string>();
    let depth = 0;
    let current = sessions.get(id);
    while (current?.parentSessionId && sessions.has(current.parentSessionId) && !seen.has(current.parentSessionId)) {
      seen.add(current.parentSessionId);
      depth += 1;
      current = sessions.get(current.parentSessionId);
    }
    depthById.set(id, depth);
    return depth;
  };

  return {
    orderedIds: [...ids].sort((left, right) => depthOf(right) - depthOf(left)),
    protectedIds: [],
    missingIds: [],
    parentIdById,
  };
}

export function executeBatchSessionDeletion(
  plan: BatchSessionDeletionPlan,
  deleteOne: (id: string) => boolean,
): BatchSessionDeletionResult {
  if (plan.protectedIds.length || plan.missingIds.length) {
    return {
      deletedIds: [],
      protectedIds: plan.protectedIds,
      missingIds: plan.missingIds,
      failedIds: [],
    };
  }

  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  const blockedAncestors = new Set<string>();
  const blockAncestorsOf = (id: string) => {
    const seen = new Set<string>();
    let parentId = plan.parentIdById[id];
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      blockedAncestors.add(parentId);
      parentId = plan.parentIdById[parentId];
    }
  };
  for (const id of plan.orderedIds) {
    if (blockedAncestors.has(id)) {
      failedIds.push(id);
      continue;
    }
    try {
      if (deleteOne(id)) deletedIds.push(id);
      else {
        failedIds.push(id);
        blockAncestorsOf(id);
      }
    } catch {
      failedIds.push(id);
      blockAncestorsOf(id);
    }
  }
  return { deletedIds, protectedIds: [], missingIds: [], failedIds };
}
