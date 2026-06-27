import assert from "node:assert/strict";
import { test } from "node:test";

import { extractJsonObject, applySchema } from "./agent-runner.ts";

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

test("applySchema: 校验器返回 ok:true 时透传 data", () => {
  const result = applySchema({ n: 1 }, () => ({ ok: true, data: { n: 1 } }));
  assert.ok(result.ok);
  assert.deepEqual(result.data, { n: 1 });
});

test("applySchema: 校验器返回 ok:false 时透传 error", () => {
  const result = applySchema({}, () => ({ ok: false, error: "missing n" }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing n");
});

test("applySchema: 校验器自身抛错时归一为 ok:false，不向上冒泡", () => {
  const throwingSchema = () => { throw new Error("validator exploded"); };
  const result = applySchema({}, throwingSchema as unknown as Parameters<typeof applySchema>[1]);
  assert.equal(result.ok, false);
  assert.match(result.error, /validator exploded/);
});
