import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

import { readJson, writeJson, writeJsonAtomic, exists, _internal } from "./json.ts";

const { deepEqual, detectMapJsonStyle } = _internal;

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("json", () => {
  describe("readJson / writeJson", () => {
    test("writeJson and readJson roundtrip", () => {
      const dir = tmpDir("json-test-");
      const filePath = path.join(dir, "test.json");
      const data = { name: "测试", values: [1, 2, 3] };
      writeJson(filePath, data);
      const result = readJson(filePath) as typeof data;
      assert.equal(result.name, "测试");
      assert.deepEqual(result.values, [1, 2, 3]);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("writeJson creates parent directories", () => {
      const dir = tmpDir("json-test-");
      const filePath = path.join(dir, "nested", "deep", "test.json");
      writeJson(filePath, { ok: true });
      assert.ok(fs.existsSync(filePath));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("readJson handles BOM prefix", () => {
      const dir = tmpDir("json-test-");
      const filePath = path.join(dir, "bom.json");
      fs.writeFileSync(filePath, "\uFEFF" + JSON.stringify({ bom: true }), "utf8");
      const result = readJson(filePath) as { bom: boolean };
      assert.equal(result.bom, true);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("readJson throws on invalid JSON", () => {
      const dir = tmpDir("json-test-");
      const filePath = path.join(dir, "bad.json");
      fs.writeFileSync(filePath, "{invalid json}", "utf8");
      assert.throws(() => readJson(filePath), SyntaxError);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("readJson throws on missing file", () => {
      assert.throws(() => readJson("/nonexistent/path.json"));
    });
  });

  describe("writeJsonAtomic", () => {
    test("writeJsonAtomic creates file correctly", () => {
      const dir = tmpDir("json-atomic-");
      const filePath = path.join(dir, "atomic.json");
      const data = { atomic: true, count: 42 };
      writeJsonAtomic(filePath, data);
      const result = readJson(filePath) as typeof data;
      assert.equal(result.atomic, true);
      assert.equal(result.count, 42);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("writeJsonAtomic overwrites existing file", () => {
      const dir = tmpDir("json-atomic-");
      const filePath = path.join(dir, "atomic.json");
      writeJsonAtomic(filePath, { v: 1 });
      writeJsonAtomic(filePath, { v: 2 });
      const result = readJson(filePath) as { v: number };
      assert.equal(result.v, 2);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("writeJsonAtomic creates parent directories", () => {
      const dir = tmpDir("json-atomic-");
      const filePath = path.join(dir, "nested", "deep", "atomic.json");
      writeJsonAtomic(filePath, { x: 1 });
      assert.ok(fs.existsSync(filePath));
      const result = readJson(filePath) as { x: number };
      assert.equal(result.x, 1);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("exists", () => {
    test("returns true for existing file", () => {
      const dir = tmpDir("json-exists-");
      const filePath = path.join(dir, "exists.json");
      fs.writeFileSync(filePath, "{}", "utf8");
      assert.ok(exists(filePath));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("returns false for missing file", () => {
      assert.ok(!exists("/nonexistent/path.json"));
    });
  });

  describe("deepEqual (internal)", () => {
    test("equal primitives", () => {
      assert.ok(deepEqual(1, 1));
      assert.ok(deepEqual("a", "a"));
      assert.ok(deepEqual(null, null));
    });

    test("different primitives", () => {
      assert.ok(!deepEqual(1, 2));
      assert.ok(!deepEqual("a", "b"));
      assert.ok(!deepEqual(null, undefined));
    });

    test("equal objects", () => {
      assert.ok(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }));
    });

    test("different objects", () => {
      assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
      assert.ok(!deepEqual({ a: 1 }, { b: 1 }));
    });

    test("equal arrays", () => {
      assert.ok(deepEqual([1, 2, 3], [1, 2, 3]));
    });

    test("different arrays", () => {
      assert.ok(!deepEqual([1, 2], [1, 3]));
      assert.ok(!deepEqual([1, 2], [1, 2, 3]));
    });

    test("nested structures", () => {
      assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    });

    test("array vs object", () => {
      assert.ok(!deepEqual([1], { 0: 1 }));
    });
  });

  describe("detectMapJsonStyle (internal)", () => {
    test("detects pretty style", () => {
      const text = '{\n  "data": [],\n  "events": []\n}';
      assert.equal(detectMapJsonStyle(text), "pretty");
    });

    test("detects compact style", () => {
      const text = '{"data":[],"events":[]}';
      assert.equal(detectMapJsonStyle(text), "compact");
    });
  });

  describe("writeMapJson", () => {
    test("writes new file in compact style by default", () => {
      const dir = tmpDir("json-map-");
      const filePath = path.join(dir, "Map001.json");
      const data = { data: [[[0]]], events: [null] };
      writeJson(filePath, data);
      const result = readJson(filePath) as typeof data;
      assert.deepEqual(result.data, data.data);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("writeJson overwrites with same content", () => {
      const dir = tmpDir("json-map-");
      const filePath = path.join(dir, "Map001.json");
      const data = { data: [[[0]]], events: [] };
      writeJson(filePath, data);
      writeJson(filePath, data);
      const result = readJson(filePath) as typeof data;
      assert.deepEqual(result, data);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
