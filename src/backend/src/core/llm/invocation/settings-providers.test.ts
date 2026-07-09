import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrapDatabase } from "../../db/bootstrap.ts";
import { closeDatabase } from "../../db/pool.ts";
import * as providerRegistry from "../provider-registry.ts";
import { writeProviderSeedFile } from "../provider-seeds.ts";
import { listProvidersForSettings } from "./settings-providers.ts";

test("listProvidersForSettings uses registry after sync and overlays product seeds", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-settings-providers-"));
  try {
    await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
    writeProviderSeedFile(tmpRoot, [
      {
        id: "agentplan",
        label: "火山方舟 Agent Plan",
        protocol: "openai-compatible",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        models: [{ id: "glm-5.2", label: "GLM 5.2" }],
        opencodeAuth: { enabled: true, envVar: "ARK_API_KEY" },
        disableModelFetch: true,
        supportedEngines: ["opencode"],
      },
    ]);
    await providerRegistry.upsertProvider(tmpRoot, "openai", {
      label: "OpenAI",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      credentialValue: "",
      models: [{ id: "gpt-4.1", label: "GPT-4.1", limit: { context: 1000 } }],
      presetKind: "opencode",
      opencodeAuth: { enabled: true, envVar: "OPENAI_API_KEY" },
      supportedEngines: ["opencode"],
    });
    await providerRegistry.upsertProvider(tmpRoot, "my-custom", {
      label: "My Custom",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      credentialValue: "sk-keep",
      models: [{ id: "custom-model", label: "Custom" }],
    });
    await providerRegistry.upsertProvider(tmpRoot, "legacy-empty", {
      label: "Legacy Empty",
      protocol: "openai-compatible",
      baseUrl: "https://legacy.test/v1",
      credentialValue: "",
      models: [],
    });

    const providers = await listProvidersForSettings("opencode", tmpRoot);

    const ids = providers.map((provider) => provider.id).sort();
    // Registry rows (including unkeyed synced catalog) + seed overlay; legacy-empty stays until prune.
    assert.deepEqual(ids, ["agentplan", "legacy-empty", "my-custom", "openai"]);
    assert.equal(providers.find((provider) => provider.id === "agentplan")?.disableModelFetch, true);
    assert.equal(providers.find((provider) => provider.id === "openai")?.source, "opencode");
    assert.equal(providers.find((provider) => provider.id === "my-custom")?.credentialPresent, true);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
