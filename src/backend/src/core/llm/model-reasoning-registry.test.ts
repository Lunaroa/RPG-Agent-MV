import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractThinkingVariantsFromModel } from "./client/openai-compatible.ts";
import {
  ANTHROPIC_THINKING_BUDGET,
  DEEPSEEK_V4_EFFORT,
  MINIMAX_M3_THINKING,
  normalizeThinkingLevel,
  normalizeStoredThinkingLevel,
  resolveRegistryThinkingVariants,
  resolveThinkingVariantsForModel,
} from "./model-reasoning-registry.ts";

describe("model-reasoning-registry", () => {
  test("MiniMax M3 exposes adaptive + disabled", () => {
    const variants = resolveRegistryThinkingVariants("minimax", "MiniMax-M3");
    assert.ok(variants);
    assert.deepEqual(variants.map((v) => v.id), ["default", "disabled"]);
    assert.deepEqual(variants, MINIMAX_M3_THINKING);
  });

  test("MiniMax M2.7 exposes default only", () => {
    const variants = resolveRegistryThinkingVariants("minimax", "MiniMax-M2.7");
    assert.ok(variants);
    assert.deepEqual(variants.map((v) => v.id), ["default"]);
  });

  test("DeepSeek V4 Pro exposes official effort tiers", () => {
    const variants = resolveRegistryThinkingVariants("deepseek", "deepseek-v4-pro");
    assert.ok(variants);
    assert.deepEqual(variants.map((v) => v.id), ["default", "high", "max"]);
    assert.deepEqual(variants, DEEPSEEK_V4_EFFORT);
  });

  test("DeepSeek V4 Flash exposes official effort tiers", () => {
    const variants = resolveRegistryThinkingVariants("deepseek", "deepseek-v4-flash");
    assert.ok(variants);
    assert.deepEqual(variants.map((v) => v.id), ["default", "high", "max"]);
  });

  test("registry wins over API metadata with single default variant", () => {
    const variants = extractThinkingVariantsFromModel(
      "deepseek-v4-pro",
      { variants: ["default"] },
      "deepseek",
    );
    assert.equal(variants.length, 3);
    assert.deepEqual(variants.map((v) => v.id), ["default", "high", "max"]);
  });

  test("default-only registry stays default-only even with richer API metadata", () => {
    const variants = extractThinkingVariantsFromModel(
      "mimo-v2-tts",
      { reasoning_variants: ["default", "high", "max"] },
      "xiaomi-mimo-token-plan-china",
    );
    assert.deepEqual(variants.map((v) => v.id), ["default"]);
  });

  test("normalizeThinkingLevel resets unsupported legacy values to default", () => {
    assert.equal(
      normalizeThinkingLevel("minimax", "MiniMax-M3", "max"),
      "default",
    );
    assert.equal(
      normalizeThinkingLevel("deepseek", "deepseek-v4-pro", "max"),
      "max",
    );
    assert.equal(
      normalizeThinkingLevel("deepseek", "deepseek-v4-pro", "minimal"),
      "default",
    );
  });

  test("Kimi K2.6 is default-only (no public multi-tier API)", () => {
    const variants = resolveRegistryThinkingVariants("kimi", "kimi-k2.6");
    assert.ok(variants);
    assert.deepEqual(variants.map((v) => v.id), ["default"]);
  });

  test("MiMo V2.5 Pro exposes Anthropic thinking budget", () => {
    const variants = resolveThinkingVariantsForModel("xiaomi-mimo-token-plan-china", "mimo-v2.5-pro");
    assert.deepEqual(variants, ANTHROPIC_THINKING_BUDGET);
  });

  test("MiMo TTS stays default-only", () => {
    const variants = resolveThinkingVariantsForModel("xiaomi-mimo-token-plan-china", "mimo-v2-tts");
    assert.deepEqual(variants.map((v) => v.id), ["default"]);
  });

  test("normalizeStoredThinkingLevel resets invalid stored thinking values", () => {
    assert.equal(
      normalizeStoredThinkingLevel("minimax", "MiniMax-M3", "high"),
      "default",
    );
  });
});
