import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readActivityLog } from "./memory-store.ts";
import { buildScribePrompt, runMemoryScribe, type MemoryScribeDeps } from "./memory-scribe.ts";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpg-memory-scribe-"));
}

function baseInput(root = makeRoot()) {
  return {
    workflowRoot: root,
    cwd: path.join(root, "projects", "Demo"),
    opencodeSessionId: "parent-session",
    sourceSessionId: "runtime-session",
    status: "pass",
    providerId: "p",
    modelId: "m",
    env: { OPENAI_API_KEY: "secret" },
    config: { model: "p/m" },
  };
}

test("buildScribePrompt covers progress + topic + profile scope and forbids fabrication", () => {
  const prompt = buildScribePrompt({ sessionId: "runtime-session", opencodeSessionId: "parent-session", status: "pass" });
  assert.match(prompt, /RmmvMemory/);
  assert.match(prompt, /progress\.write/);
  assert.match(prompt, /runtime-session/);
  assert.match(prompt, /parent-session/);
  assert.match(prompt, /memory\.write/);
  assert.match(prompt, /memory\.read-profile/);
  assert.match(prompt, /memory\.write-profile/);
  assert.match(prompt, /Current progress belongs ONLY in/i);
  // Conservative guardrails.
  assert.match(prompt, /NEVER invent/i);
  assert.match(prompt, /do nothing/i);
  assert.match(prompt, /Do NOT duplicate/i);
});

test("runMemoryScribe forks, runs under the sandboxed agent, swallows events, cleans up", async () => {
  const root = makeRoot();
  let forkedFrom = "";
  let ranAgent = "";
  let ranSessionId = "";
  let ranPrompt = "";
  let deleted = "";
  try {
    const deps: MemoryScribeDeps = {
      fork: async (id) => { forkedFrom = id; return "forked-session"; },
      run: async (input, onEvent) => {
        ranAgent = input.agentName || "";
        ranSessionId = input.opencodeSessionId || "";
        ranPrompt = input.prompt || "";
        // The scribe must never surface events to the user; calling onEvent must be harmless.
        onEvent({ type: "text_delta", text: "should be swallowed" });
        return {
          status: "pass", opencodeSessionId: "forked-session", stdout: "", stderr: "",
          startedAt: "", finishedAt: "", blocker: null, inputTokens: 0, outputTokens: 0, executable: "",
        };
      },
      remove: async (id) => { deleted = id; },
    };

    const result = await runMemoryScribe(baseInput(root), deps);
    assert.equal(result.ran, true);
    assert.equal(result.forkedSessionId, "forked-session");
    assert.equal(forkedFrom, "parent-session");
    // Runs the fork (not the parent) under the sandboxed scribe agent.
    assert.equal(ranSessionId, "forked-session");
    assert.equal(ranAgent, "memory-scribe");
    assert.match(ranPrompt, /runtime-session/);
    // Fork is cleaned up afterwards.
    assert.equal(deleted, "forked-session");
    assert.equal(readActivityLog(root, "Demo", 5)[0].op, "review");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runMemoryScribe fails soft when the fork fails (no run, no throw)", async () => {
  const root = makeRoot();
  let ran = false;
  try {
    const deps: MemoryScribeDeps = {
      fork: async () => null,
      run: async () => { ran = true; throw new Error("should not run"); },
      remove: async () => {},
    };
    const result = await runMemoryScribe(baseInput(root), deps);
    assert.equal(result.ran, false);
    assert.equal(result.reason, "fork-failed");
    assert.equal(ran, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runMemoryScribe fails soft when the extraction run throws, still cleans up the fork", async () => {
  const root = makeRoot();
  let deleted = "";
  try {
    const deps: MemoryScribeDeps = {
      fork: async () => "forked-session",
      run: async () => { throw new Error("model boom"); },
      remove: async (id) => { deleted = id; },
    };
    const result = await runMemoryScribe(baseInput(root), deps);
    assert.equal(result.ran, false);
    assert.equal(result.reason, "run-failed");
    // Even on failure the fork is deleted so sessions don't pile up.
    assert.equal(deleted, "forked-session");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
