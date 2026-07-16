import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { writeJson } from "../rmmv/json.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import {
  RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
  RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
} from "./rpg-maker-mz-runtime.ts";
import { prepareRmmvPlaytestPlan } from "./runtime-deploy-service.ts";

describe("MZ runtime deploy plan", () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-agent-mz-runtime-plan-"));
    project = path.join(root, "projects", "sample");
    writeMZProject(project);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("uses only the validated project-local MZ runtime", () => {
    const runnable = prepareRmmvPlaytestPlan(root, project, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(runnable.engine, "rpg-maker-mz");
    assert.equal(runnable.status, "runnable");
    assert.equal(runnable.command?.executable, path.join(project, "Game.exe"));
    assert.deepEqual(runnable.command?.args, [project]);
    assert.equal(runnable.nwjsRunner, undefined);

    const explicitRunner = prepareRmmvPlaytestPlan(root, project, {
      nwjsRunner: process.execPath,
      generatedAt: "2026-01-01T00:00:01.000Z",
    });
    assert.equal(explicitRunner.engine, "rpg-maker-mz");
    assert.equal(explicitRunner.status, "runnable");
    assert.equal(explicitRunner.command?.executable, path.join(project, "Game.exe"));
    assert.equal(explicitRunner.nwjsRunner, undefined);
    assert.equal(explicitRunner.checks.some((check) => check.id === "engine-rmmz_core.js" && check.pass), true);

    fs.rmSync(path.join(project, "nw.dll"));
    const blocked = prepareRmmvPlaytestPlan(root, project, {
      generatedAt: "2026-01-01T00:00:02.000Z",
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.command, undefined);
    assert.equal(blocked.issues.some((issue) => issue.code === "runtime-runner-missing"), true);
    assert.match(blocked.checks.find((check) => check.id === "runtime-runner")?.detail || "", /nw\.dll/);
  });
});

function writeMZProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "game.rmmzproject"), "RPGMZ", "utf8");
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(project, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === "js/rmmz_core.js"
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === "package.json"
        ? '{"main":"index.html"}'
        : relative === "js/plugins.js"
          ? "var $plugins = [];"
          : "";
    fs.writeFileSync(file, content, "utf8");
  }
  for (const directory of ["audio", "fonts", "img", "movies", "effects", "js/plugins"]) {
    fs.mkdirSync(path.join(project, directory), { recursive: true });
  }
  fs.mkdirSync(path.join(project, "locales"), { recursive: true });
  for (const relative of [
    ...RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
    ...RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
  ]) {
    const file = path.join(project, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relative === "Game.exe" ? Buffer.from([0x4d, 0x5a, 0, 0]) : "runtime fixture");
  }
  fs.writeFileSync(path.join(project, "locales", "en-US.pak"), "locale fixture", "utf8");
  writeJson(path.join(project, "data", "System.json"), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
    startMapId: 1,
  });
  writeJson(path.join(project, "data", "MapInfos.json"), [null, { id: 1, name: "Sample Map" }]);
  writeJson(path.join(project, "data", "Map001.json"), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null],
  });
}
