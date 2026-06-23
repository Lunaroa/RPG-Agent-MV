import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readMemorySettings, writeMemorySettings } from "./memory-settings.ts";

describe("memory settings", { concurrency: false }, () => {
  let root = "";

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-memory-settings-"));
    await bootstrapDatabase(root, { dbPath: path.join(root, "data", "test.db"), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("defaults to memory on, recall off, and auto extraction off", () => {
    assert.deepEqual(readMemorySettings(), {
      enabled: true,
      recallModel: null,
      autoExtractEnabled: false,
    });
  });

  test("writes autoExtractEnabled and preserves omitted fields on later patches", () => {
    const first = writeMemorySettings({
      enabled: true,
      recallModel: { providerId: "provider-a", modelId: "model-a" },
      autoExtractEnabled: true,
    });
    assert.deepEqual(first, {
      enabled: true,
      recallModel: { providerId: "provider-a", modelId: "model-a" },
      autoExtractEnabled: true,
    });

    const second = writeMemorySettings({ enabled: false });
    assert.deepEqual(second, {
      enabled: false,
      recallModel: { providerId: "provider-a", modelId: "model-a" },
      autoExtractEnabled: true,
    });
    assert.deepEqual(readMemorySettings(), second);
  });
});
