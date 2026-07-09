import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpencodeProviderList } from "./catalog.ts";

test("mapOpencodeProviderList maps real provider.list shape with model.api.url", () => {
  const mapped = mapOpencodeProviderList({
    all: [
      {
        id: "openai",
        name: "OpenAI",
        source: "models.dev",
        env: ["OPENAI_API_KEY"],
        options: {},
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            api: {
              id: "gpt-4.1",
              url: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
            },
            limit: { context: 1047576, output: 32768 },
          },
        },
      },
      {
        id: "anthropic",
        name: "Anthropic",
        source: "models.dev",
        env: ["ANTHROPIC_API_KEY"],
        options: {},
        models: {
          "claude-sonnet-4-5": {
            name: "Claude Sonnet 4.5",
            api: {
              id: "claude-sonnet-4-5",
              url: "https://api.anthropic.com",
              npm: "@ai-sdk/anthropic",
            },
          },
        },
      },
    ],
  });

  assert.equal(mapped.length, 2);
  const openai = mapped.find((provider) => provider.id === "openai");
  assert.ok(openai);
  assert.equal(openai?.protocol, "openai-compatible");
  assert.equal(openai?.envVar, "OPENAI_API_KEY");
  assert.equal(openai?.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai?.models[0]?.limit?.context, 1047576);
  const anthropic = mapped.find((provider) => provider.id === "anthropic");
  assert.equal(anthropic?.protocol, "anthropic");
  assert.equal(anthropic?.baseUrl, "https://api.anthropic.com");
});

test("mapOpencodeProviderList prefers options.baseURL over model.api.url", () => {
  const mapped = mapOpencodeProviderList({
    all: [
      {
        id: "openai",
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        options: { baseURL: "https://proxy.example/v1" },
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            api: { id: "gpt-4.1", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
          },
        },
      },
    ],
  });
  assert.equal(mapped[0]?.baseUrl, "https://proxy.example/v1");
});

test("mapOpencodeProviderList still accepts legacy top-level api field", () => {
  const mapped = mapOpencodeProviderList({
    all: [
      {
        id: "openai",
        name: "OpenAI",
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        env: ["OPENAI_API_KEY"],
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1047576, output: 32768 },
          },
        },
      },
    ],
  });
  assert.equal(mapped[0]?.baseUrl, "https://api.openai.com/v1");
});
