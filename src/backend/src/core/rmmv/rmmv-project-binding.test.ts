import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RmmvProjectBindingError, resolveProjectRoot } from "./rmmv-handler-utils.ts";
import { runRmmvVerify } from "./rmmv-verify-handler.ts";

const roots: string[] = [];
const original = {
  status: process.env.AIWF_PROJECT_BINDING_STATUS,
  directory: process.env.AIWF_PROJECT_DIR,
  runtimeExecutable: process.env.AIWF_PROJECT_RUNTIME_EXECUTABLE,
  runtimeReason: process.env.AIWF_PROJECT_RUNTIME_REASON,
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  restoreEnv("AIWF_PROJECT_BINDING_STATUS", original.status);
  restoreEnv("AIWF_PROJECT_DIR", original.directory);
  restoreEnv("AIWF_PROJECT_RUNTIME_EXECUTABLE", original.runtimeExecutable);
  restoreEnv("AIWF_PROJECT_RUNTIME_REASON", original.runtimeReason);
});

test("returns a normal blocked verification result for a source project without a runtime", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-runtime-selection-"));
  roots.push(root);
  const project = path.join(root, "source-project");
  fs.mkdirSync(project, { recursive: true });
  process.env.AIWF_PROJECT_BINDING_STATUS = "bound";
  process.env.AIWF_PROJECT_DIR = project;
  delete process.env.AIWF_PROJECT_RUNTIME_EXECUTABLE;
  process.env.AIWF_PROJECT_RUNTIME_REASON = "missing";
  const result = await runRmmvVerify({ workflowRoot: root });
  assert.equal((result.data as Record<string, unknown>).status, "blocked");
  assert.equal((result.data as Record<string, unknown>).code, "runtime-selection-required");
  assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:[\\/]/);
});

test("rejects project tools when no project is bound", () => {
  process.env.AIWF_PROJECT_BINDING_STATUS = "none";
  delete process.env.AIWF_PROJECT_DIR;
  assert.throws(
    () => resolveProjectRoot({}),
    (error) => error instanceof RmmvProjectBindingError && error.code === "project-not-bound",
  );
});

test("rejects an explicit project that differs from the frozen binding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-binding-"));
  roots.push(root);
  const bound = path.join(root, "bound-project");
  const other = path.join(root, "other-project");
  fs.mkdirSync(bound, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  process.env.AIWF_PROJECT_BINDING_STATUS = "bound";
  process.env.AIWF_PROJECT_DIR = bound;
  const expected = fs.realpathSync.native(bound);
  assert.equal(resolveProjectRoot({ project: bound }), expected);
  assert.throws(
    () => resolveProjectRoot({ project: other }),
    (error) => error instanceof RmmvProjectBindingError && error.code === "project-binding-mismatch",
  );
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
