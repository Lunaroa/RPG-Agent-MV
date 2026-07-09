import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpencodeActionBootstrap } from "./opencode-action-bootstrap.ts";

test("resolveOpencodeActionBootstrap prefers live run context", async () => {
  const bootstrap = await resolveOpencodeActionBootstrap("/tmp/workflow", {
    providerId: "provider-1",
    modelId: "model-1",
    productLanguage: "en-US",
    opencodeRunContext: {
      env: { LIVE: "1" },
      config: { model: "provider-1/model-1" },
    },
  }, {
    loadProviderDocument: async () => {
      throw new Error("should not load providers when live context exists");
    },
  });

  assert.deepEqual(bootstrap.env, { LIVE: "1" });
  assert.deepEqual(bootstrap.config, { model: "provider-1/model-1" });
});

test("resolveOpencodeActionBootstrap rebuilds from provider registry when run context is cleared", async () => {
  let loadedProviderId = "";
  const bootstrap = await resolveOpencodeActionBootstrap("/tmp/workflow", {
    providerId: "agentplan",
    modelId: "glm-5.2",
    productLanguage: "zh-CN",
    opencodeRunContext: null,
  }, {
    loadProviderDocument: async () => ({
      version: 1,
      providers: {
        agentplan: {
          id: "agentplan",
          label: "Agent Plan",
          protocol: "openai-compatible",
          baseUrl: "https://example.test/v3",
          credentialValue: "secret-key",
          models: [{ id: "glm-5.2", label: "GLM 5.2", limit: { context: 262144 } }],
          opencodeAuth: { enabled: true, envVar: "OPENAI_API_KEY" },
        },
      },
    }),
    materializeEnv: (provider, options) => {
      loadedProviderId = String(provider?.id || "");
      assert.equal(options?.modelId, "glm-5.2");
      return {
        env: {
          OPENAI_BASE_URL: "https://example.test/v3",
          OPENAI_API_KEY: "secret-key",
          OPENAI_MODEL: "glm-5.2",
        },
        envKeys: ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"],
        blocker: null,
      };
    },
    buildRuntimeConfig: (input) => {
      assert.equal(input.providerId, "agentplan");
      assert.equal(input.modelId, "glm-5.2");
      assert.equal(input.readOnlyTools, true);
      return {
        model: "agentplan/glm-5.2",
        provider: {
          agentplan: {
            models: {
              "glm-5.2": { limit: { context: 262144 } },
            },
          },
        },
      };
    },
    readMemory: () => ({ enabled: false, autoExtractEnabled: false, recallModel: null }),
  });

  assert.equal(loadedProviderId, "agentplan");
  assert.equal(bootstrap.env.OPENAI_API_KEY, "secret-key");
  assert.equal(bootstrap.env.OPENCODE_DISABLE_AUTOUPDATE, "true");
  assert.equal(bootstrap.config.model, "agentplan/glm-5.2");
});

test("resolveOpencodeActionBootstrap fails fast when provider credential is missing", async () => {
  await assert.rejects(
    () => resolveOpencodeActionBootstrap("/tmp/workflow", {
      providerId: "agentplan",
      modelId: "glm-5.2",
      productLanguage: "en-US",
      opencodeRunContext: null,
    }, {
      loadProviderDocument: async () => ({
        version: 1,
        providers: {
          agentplan: {
            id: "agentplan",
            label: "Agent Plan",
            protocol: "openai-compatible",
            baseUrl: "https://example.test/v3",
            credentialValue: "",
            models: [{ id: "glm-5.2" }],
          },
        },
      }),
      materializeEnv: () => ({
        env: {},
        envKeys: [],
        blocker: 'Provider "Agent Plan" is missing an API Key.',
      }),
    }),
    /missing an API Key/,
  );
});
