import assert from "node:assert/strict";
import { test } from "node:test";

import { extractJsonObject } from "./agent-runner.ts";

test("从 ```json 围栏块抽取对象", () => {
  const text = "前言\n```json\n{\"a\": 1, \"b\": [2,3]}\n```\n后语";
  const result = extractJsonObject(text);
  assert.ok(result.ok);
  assert.deepEqual(result.value, { a: 1, b: [2, 3] });
});

test("无围栏时抽取首个平衡的 {...}", () => {
  const text = '随便说点 {"k": "v with } brace in string", "n": 1} 收尾';
  const result = extractJsonObject(text);
  assert.ok(result.ok);
  assert.deepEqual(result.value, { k: "v with } brace in string", n: 1 });
});

test("取最后一个有效 json 围栏块", () => {
  const text = "```json\n{\"first\": true}\n```\n再来\n```json\n{\"second\": true}\n```";
  const result = extractJsonObject(text);
  assert.ok(result.ok);
  assert.deepEqual(result.value, { second: true });
});

test("没有 JSON 时返回 ok:false", () => {
  const result = extractJsonObject("纯文本，没有对象");
  assert.equal(result.ok, false);
});

test("围栏块内非法 JSON 返回 ok:false", () => {
  const result = extractJsonObject("```json\n{not valid}\n```");
  assert.equal(result.ok, false);
});
