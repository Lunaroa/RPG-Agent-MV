import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAssistantTokenUsage,
  calculateContextPercent,
  latestAssistantContextTokens,
} from "./opencode-token-usage.ts";

test("aggregateAssistantTokenUsage sums all assistant messages", () => {
  const messages = [
    { role: "user", id: "u1" },
    {
      role: "assistant",
      id: "a1",
      cost: 0.01,
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
    },
    {
      role: "assistant",
      id: "a2",
      cost: 0.02,
      tokens: { input: 200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  ];

  const result = aggregateAssistantTokenUsage(messages);
  assert.equal(result.inputTokens, 300);
  assert.equal(result.outputTokens, 130);
  assert.equal(result.reasoningTokens, 10);
  assert.equal(result.cacheRead, 5);
  assert.equal(result.cacheWrite, 2);
  assert.equal(result.totalTokens, 447);
  assert.equal(result.totalCost, 0.03);
  assert.equal(result.turnCount, 2);
});

test("aggregateAssistantTokenUsage skips assistant messages without tokens", () => {
  const result = aggregateAssistantTokenUsage([
    { role: "assistant", tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    { role: "assistant", tokens: { input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
  ]);
  assert.equal(result.turnCount, 1);
  assert.equal(result.totalTokens, 4);
});

test("latestAssistantContextTokens mirrors opencode context window token source", () => {
  const result = latestAssistantContextTokens([
    {
      role: "assistant",
      providerID: "provider-a",
      modelID: "model-a",
      tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    {
      role: "assistant",
      providerID: "provider-b",
      modelID: "model-b",
      tokens: { input: 200, output: 80, reasoning: 10, cache: { read: 5, write: 2 } },
    },
  ]);

  assert.equal(result.usedTokens, 297);
  assert.equal(result.providerId, "provider-b");
  assert.equal(result.modelId, "model-b");
});

test("calculateContextPercent requires a model context window", () => {
  assert.equal(calculateContextPercent(297, 1000), 30);
  assert.throws(() => calculateContextPercent(1, 0), /context limit/);
});
