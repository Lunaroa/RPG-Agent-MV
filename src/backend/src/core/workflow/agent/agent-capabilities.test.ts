import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolveEnabledAgentRuntimeBuiltinTools,
  resolveToolPolicy,
  isToolDenied,
} from "./agent-capabilities.ts";

const workflowRoot = path.resolve(import.meta.dirname, "../../../../../..");

test("opencode todo and task tools are enabled from the agent allow list", () => {
  const enabled = resolveEnabledAgentRuntimeBuiltinTools(workflowRoot);
  for (const tool of ["task", "todoread", "todowrite", "question"]) {
    assert.ok(enabled.includes(tool), `${tool} should be enabled`);
  }
});

test("isToolDenied is case-insensitive", () => {
  assert.equal(isToolDenied(["rmmv_RmmvStage"], "RMMV_RMMVSTAGE"), true);
  assert.equal(isToolDenied([], "rmmv_RmmvStage"), false);
  assert.equal(isToolDenied(["other"], "rmmv_RmmvStage"), false);
});

test("resolveToolPolicy: read-only subagent keeps stagingSafe on by availability, but deny still wins", () => {
  const tools = [
    { id: "edit", kind: "builtin", readOnly: false },
    { id: "read", kind: "builtin", readOnly: true },
    { id: "rmmv_RmmvStage", kind: "mcp", stagingSafe: true },
    { id: "rmmv_RmmvMap", kind: "mcp", readOnly: false, stagingSafe: false },
  ];
  const always = () => true;

  const noAllow = resolveToolPolicy(tools, [], [], { readOnly: true, isAvailable: always });
  assert.equal(noAllow["edit"], false, "edit must be off for read-only");
  assert.equal(noAllow["read"], false, "read tool needs allow-list even if readOnly");
  assert.equal(noAllow["rmmv_RmmvStage"], true, "stagingSafe stays on by availability");
  assert.equal(noAllow["rmmv_RmmvMap"], false, "mutating mcp tool off for read-only");

  const denied = resolveToolPolicy(tools, [], ["rmmv_RmmvStage"], { readOnly: true, isAvailable: always });
  assert.equal(denied["rmmv_RmmvStage"], false, "deny must override stagingSafe carve-out");

  const allowed = resolveToolPolicy(tools, ["read", "rmmv_RmmvStage"], ["rmmv_RmmvStage"], {
    readOnly: true,
    isAvailable: always,
  });
  assert.equal(allowed["read"], true);
  assert.equal(allowed["rmmv_RmmvStage"], false, "deny beats allow for stagingSafe");
});

test("resolveToolPolicy: non-read-only session follows plain allow/deny", () => {
  const tools = [
    { id: "edit", kind: "builtin" },
    { id: "rmmv_RmmvStage", kind: "mcp", stagingSafe: true },
  ];
  const always = () => true;
  const p = resolveToolPolicy(tools, ["edit"], ["rmmv_RmmvStage"], { readOnly: false, isAvailable: always });
  assert.equal(p["edit"], true);
  assert.equal(p["rmmv_RmmvStage"], false, "denied even though stagingSafe (non-read-only branch)");
});
