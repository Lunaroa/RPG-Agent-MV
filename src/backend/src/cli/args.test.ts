import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "./args.ts";

test("parseArgs reads workflow summary as text", () => {
  let parsed: ReturnType<typeof parseArgs> | undefined;
  let parseError: unknown;
  try {
    parsed = parseArgs(["--script", "workflow.js", "--summary", "检查事件一致性"]);
  } catch (error) {
    parseError = error;
  }

  assert.equal(parseError, undefined);
  assert.equal(parsed?.summary, "检查事件一致性");
});
