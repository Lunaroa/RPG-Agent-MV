import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOpencodeSessionMessages } from "./runtime.ts";
import { aggregateAssistantTokenUsage } from "../../../desktop/slash-command/opencode-token-usage.ts";

test("normalizeOpencodeSessionMessages handles v1 info wrapper", () => {
  const normalized = normalizeOpencodeSessionMessages([
    {
      info: {
        role: "assistant",
        cost: 0.01,
        tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(aggregateAssistantTokenUsage(normalized).totalTokens, 5);
});

test("normalizeOpencodeSessionMessages handles v2 session messages", () => {
  const normalized = normalizeOpencodeSessionMessages({
    data: [
      {
        type: "assistant",
        cost: 0.02,
        tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 0, write: 0 } },
      },
    ],
    cursor: {},
  });
  assert.equal(normalized.length, 1);
  assert.equal(aggregateAssistantTokenUsage(normalized).totalTokens, 15);
});
