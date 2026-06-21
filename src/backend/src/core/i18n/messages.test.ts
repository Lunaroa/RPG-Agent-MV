import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { backendText, listBackendMessageKeys } from "./messages.ts";

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

describe("backendText", () => {
  test("keeps backend zh-CN and en-US message keys in sync", () => {
    const zhKeys = [...listBackendMessageKeys("zh-CN")].sort();
    const enKeys = [...listBackendMessageKeys("en-US")].sort();

    assert.deepEqual(enKeys, zhKeys);
  });

  test("keeps English backend runtime messages free of Chinese", () => {
    for (const key of listBackendMessageKeys("en-US")) {
      const en = backendText(key, "en-US");
      assert.notEqual(en, key, `missing en-US backend message for ${key}`);
      assert.doesNotMatch(en, CHINESE_RE, `en-US backend message for ${key} still contains Chinese`);
    }
  });

  test("interpolates backend runtime message parameters", () => {
    assert.equal(
      backendText("runtime.timeout", "en-US", { seconds: 12 }),
      "opencode exceeded 12 seconds for this run and was stopped automatically.",
    );
  });
});
