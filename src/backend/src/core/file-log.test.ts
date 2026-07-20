import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { appendToolDiagnostic } from "./file-log.ts";

const roots: string[] = [];
const originalLogDir = process.env.AIWF_SESSION_LOG_DIR;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (originalLogDir === undefined) delete process.env.AIWF_SESSION_LOG_DIR;
  else process.env.AIWF_SESSION_LOG_DIR = originalLogDir;
});

test("structured tool diagnostics always redact credential-shaped text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-diagnostic-"));
  roots.push(root);
  process.env.AIWF_SESSION_LOG_DIR = root;
  appendToolDiagnostic({
    diagnosticId: "diag-example",
    tool: "example-tool",
    action: "read",
    phase: "failed",
    at: "2026-01-01T00:00:00.000Z",
    error: "Authorization: Bearer example-value; password=example-password",
  });
  const text = fs.readFileSync(path.join(root, "tool-internal.jsonl"), "utf8");
  assert.doesNotMatch(text, /example-value|example-password/);
  assert.match(text, /\[REDACTED\]/);
});
