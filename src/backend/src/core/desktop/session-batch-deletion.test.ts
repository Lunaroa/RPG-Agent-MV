import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  executeBatchSessionDeletion,
  planBatchSessionDeletion,
  type BatchDeletableSession,
} from "./session-batch-deletion.ts";

function sessions(...items: BatchDeletableSession[]): Map<string, BatchDeletableSession> {
  return new Map(items.map((item) => [item.id, item]));
}

describe("planBatchSessionDeletion", () => {
  test("deduplicates ids and deletes later turns before their roots", () => {
    const plan = planBatchSessionDeletion(sessions(
      { id: "root", status: "pass" },
      { id: "turn-2", status: "failed", parentSessionId: "root" },
      { id: "turn-3", status: "blocked", parentSessionId: "turn-2" },
    ), ["root", "turn-2", "turn-3", "turn-2"]);

    assert.deepEqual(plan, {
      orderedIds: ["turn-3", "turn-2", "root"],
      protectedIds: [],
      missingIds: [],
      parentIdById: { root: undefined, "turn-2": "root", "turn-3": "turn-2" },
    });
  });

  test("rejects the whole batch when a requested session is still active", () => {
    const plan = planBatchSessionDeletion(sessions(
      { id: "finished", status: "pass" },
      { id: "active", status: "running" },
    ), ["finished", "active"]);

    assert.deepEqual(plan.orderedIds, []);
    assert.deepEqual(plan.protectedIds, ["active"]);
    assert.deepEqual(plan.missingIds, []);
    let deletionCalls = 0;
    const result = executeBatchSessionDeletion(plan, () => {
      deletionCalls += 1;
      return true;
    });
    assert.equal(deletionCalls, 0);
    assert.deepEqual(result.protectedIds, ["active"]);
  });

  test("rejects the whole batch when a session is unknown", () => {
    const plan = planBatchSessionDeletion(sessions(
      { id: "finished", status: "timeout" },
    ), ["finished", "missing"]);

    assert.deepEqual(plan.orderedIds, []);
    assert.deepEqual(plan.protectedIds, []);
    assert.deepEqual(plan.missingIds, ["missing"]);
  });

  test("reports each deletion failure without claiming complete success", () => {
    const plan = planBatchSessionDeletion(sessions(
      { id: "first", status: "pass" },
      { id: "second", status: "error" },
      { id: "third", status: "stopped" },
    ), ["first", "second", "third"]);
    const result = executeBatchSessionDeletion(plan, (id) => {
      if (id === "second") throw new Error("delete failed");
      return id !== "third";
    });

    assert.deepEqual(result.deletedIds, ["first"]);
    assert.deepEqual(result.failedIds, ["second", "third"]);
  });

  test("does not orphan a failed later turn by deleting its ancestors", () => {
    const plan = planBatchSessionDeletion(sessions(
      { id: "root", status: "pass" },
      { id: "turn", status: "failed", parentSessionId: "root" },
    ), ["root", "turn"]);
    const calls: string[] = [];
    const result = executeBatchSessionDeletion(plan, (id) => {
      calls.push(id);
      return id !== "turn";
    });

    assert.deepEqual(calls, ["turn"]);
    assert.deepEqual(result.deletedIds, []);
    assert.deepEqual(result.failedIds, ["turn", "root"]);
  });
});
