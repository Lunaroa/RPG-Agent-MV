import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

import { prepareOutputPath } from "./output-safety.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkWorkflowCwd(prefix: string): string {
  const dir = tmpDir(prefix);
  fs.mkdirSync(path.join(dir, "config", "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "config", "agents", "registry.yaml"), "agents: []\n");
  fs.mkdirSync(path.join(dir, "src", "backend", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "backend", "src", "cli.ts"), "// cli\n");
  fs.mkdirSync(path.join(dir, "runtime", "out"), { recursive: true });
  return dir;
}

describe("output-safety", () => {
  describe("prepareOutputPath", () => {
    test("returns resolved path for new output", () => {
      const dir = mkWorkflowCwd("safety-");
      const target = path.join(dir, "runtime", "out", "output");
      const result = prepareOutputPath(target, { cwd: dir });
      assert.equal(result, path.resolve(target));
      assert.ok(!fs.existsSync(result));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("throws when output already exists and replaceOutput is false", () => {
      const dir = mkWorkflowCwd("safety-");
      const target = path.join(dir, "runtime", "out", "output");
      fs.mkdirSync(target, { recursive: true });
      assert.throws(
        () => prepareOutputPath(target, { cwd: dir }),
        /Refusing to overwrite existing output path/
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("throws when output exists and no options provided", () => {
      const dir = mkWorkflowCwd("safety-");
      const target = path.join(dir, "runtime", "out", "output");
      fs.mkdirSync(target, { recursive: true });
      assert.throws(
        () => prepareOutputPath(target, { cwd: dir }),
        /Refusing to overwrite existing output path/
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("replaces existing output when replaceOutput is true and path is inside runtime/out/", () => {
      const dir = mkWorkflowCwd("safety-");
      const cwd = dir;
      const target = path.join(cwd, "runtime", "out", "generated");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "file.txt"), "data", "utf8");

      const result = prepareOutputPath(target, { replaceOutput: true, cwd });
      assert.equal(result, path.resolve(target));
      assert.ok(!fs.existsSync(target));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("throws when replaceOutput is true but path is outside runtime/out/", () => {
      const dir = mkWorkflowCwd("safety-");
      const cwd = dir;
      const target = path.join(cwd, "src", "important");
      fs.mkdirSync(target, { recursive: true });

      assert.throws(
        () => prepareOutputPath(target, { replaceOutput: true, cwd }),
        /--replace-output only removes generated paths inside/
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("throws when replaceOutput tries to escape via ../", () => {
      const dir = mkWorkflowCwd("safety-");
      const cwd = dir;
      const target = path.join(cwd, "runtime", "out", "..", "important");
      fs.mkdirSync(path.join(cwd, "runtime", "important"), { recursive: true });

      assert.throws(
        () => prepareOutputPath(target, { replaceOutput: true, cwd }),
        /--replace-output only removes generated paths inside/
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("accepts path directly inside runtime/out/", () => {
      const dir = mkWorkflowCwd("safety-");
      const cwd = dir;
      const target = path.join(cwd, "runtime", "out", "result.json");
      fs.writeFileSync(target, "{}", "utf8");

      const result = prepareOutputPath(target, { replaceOutput: true, cwd });
      assert.equal(result, path.resolve(target));
      assert.ok(!fs.existsSync(target));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("accepts nested path inside runtime/out/", () => {
      const dir = mkWorkflowCwd("safety-");
      const cwd = dir;
      const target = path.join(cwd, "runtime", "out", "deep", "nested", "dir");
      fs.mkdirSync(target, { recursive: true });

      const result = prepareOutputPath(target, { replaceOutput: true, cwd });
      assert.equal(result, path.resolve(target));
      assert.ok(!fs.existsSync(target));
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
