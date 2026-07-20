import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildOpencodeToolPolicyFromAgentAllow,
  loadToolManifest,
} from "./agent-capabilities.ts";

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

test("every manifest tool declares a project scope", () => {
  const manifest = loadToolManifest(workflowRoot);
  assert.ok(manifest.tools.length > 0);
  assert.equal(manifest.tools.every((tool) => ["general", "project", "runtime"].includes(tool.scope)), true);
  assert.deepEqual(manifest.tools.filter((tool) => tool.scope === "runtime").map((tool) => tool.id), ["rmmv_RmmvVerify"]);
});

test("no-project policy keeps only general conversation tools", () => {
  const policy = buildOpencodeToolPolicyFromAgentAllow(workflowRoot, { projectState: "none" });
  for (const id of ["skill", "question", "todoread", "todowrite", "webfetch"]) assert.equal(policy[id], true, id);
  for (const id of ["read", "edit", "write", "bash", "grep", "glob", "task", "rmmv_RmmvReadContext", "rmmv_RmmvMemory"]) {
    assert.equal(policy[id], false, id);
  }
});

test("a bound source project keeps project tools including structured runtime verification", () => {
  const policy = buildOpencodeToolPolicyFromAgentAllow(workflowRoot, { projectState: "bound" });
  assert.equal(policy.read, true);
  assert.equal(policy.rmmv_RmmvMap, true);
  assert.equal(policy.rmmv_RmmvEvent, true);
  assert.equal(policy.rmmv_RmmvVerify, true);
});
