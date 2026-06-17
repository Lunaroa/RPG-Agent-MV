import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveEnabledAgentRuntimeBuiltinTools } from "./agent-capabilities.ts";

const workflowRoot = path.resolve(import.meta.dirname, "../../../../../..");

test("opencode todo and task tools are enabled from the agent allow list", () => {
  const enabled = resolveEnabledAgentRuntimeBuiltinTools(workflowRoot);
  for (const tool of ["task", "todoread", "todowrite", "question"]) {
    assert.ok(enabled.includes(tool), `${tool} should be enabled`);
  }
});
