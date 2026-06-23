import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runRmmvMemory } from "./rmmv-memory-handler.ts";
import { readCurrentProgressEntry, readIndex } from "../memory/memory-store.ts";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpg-mem-handler-"));
}

test("RmmvMemory write → list → read round-trips via the handler", () => {
  const root = makeRoot();
  try {
    const project = path.join(root, "projects", "DemoGame");
    const base = { project, workflowRoot: root };

    const written = runRmmvMemory({ ...base, action: "write", name: "Tone", description: "warm", type: "preference", body: "Keep it warm." });
    assert.match(written.summary, /Saved memory "tone"/);

    const listed = runRmmvMemory({ ...base, action: "list" });
    assert.match(listed.summary, /topics\/tone\.md/);

    const read = runRmmvMemory({ ...base, action: "read", relPath: "topics/tone.md" });
    assert.match(read.summary, /Keep it warm/);

    // Memory landed under the project's partition, matching event_contracts.project_id (basename).
    assert.match(readIndex(root, "DemoGame"), /\[Tone\]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RmmvMemory read rejects path traversal outside the memory dir", () => {
  const root = makeRoot();
  try {
    const project = path.join(root, "projects", "DemoGame");
    assert.throws(
      () => runRmmvMemory({ project, workflowRoot: root, action: "read", relPath: "../../../../secrets.txt" }),
      /escapes the project memory/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RmmvMemory read-profile and write-profile round-trip the shared author profile", () => {
  const root = makeRoot();
  try {
    const project = path.join(root, "projects", "DemoGame");
    const base = { project, workflowRoot: root };

    const empty = runRmmvMemory({ ...base, action: "read-profile" });
    assert.match(empty.summary, /empty/);
    assert.deepEqual(empty.data, { content: "" });

    const written = runRmmvMemory({ ...base, action: "write-profile", body: "Prefers terse dialogue." });
    assert.match(written.summary, /Updated the shared author profile/);
    assert.deepEqual(written.data, { bytes: Buffer.byteLength("Prefers terse dialogue.", "utf8") });

    const read = runRmmvMemory({ ...base, action: "read-profile" });
    assert.equal(read.data.content, "Prefers terse dialogue.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RmmvMemory progress.write updates current progress for the same session", () => {
  const root = makeRoot();
  try {
    const project = path.join(root, "projects", "DemoGame");
    const base = { project, workflowRoot: root };

    const first = runRmmvMemory({
      ...base,
      action: "progress.write",
      sessionId: "runtime-session-1",
      status: "pass",
      current: "Finished Phase 4 storage.",
      next: "Wire compressed continuation injection.",
    });
    assert.match(first.summary, /Updated current progress/);

    runRmmvMemory({
      ...base,
      action: "progress.write",
      sessionId: "runtime-session-1",
      status: "blocked",
      current: "Need compressed continuation injection tests.",
      next: "Add runtime test.",
      blockers: "None",
    });

    const progress = readCurrentProgressEntry(root, "DemoGame", "runtime-session-1");
    assert.equal(progress?.status, "blocked");
    assert.equal(progress?.current, "Need compressed continuation injection tests.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
