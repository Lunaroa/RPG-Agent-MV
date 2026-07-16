import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { withTestLanguage } from "../i18n/with-test-language.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { RMMV_STANDARD_DATABASE_FILES } from "../rmmv/rmmv-layout.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import {
  createProjectManagedEntry,
  getProjectManagedEntry,
  updateProjectManagedEntry,
} from "./project-management-service.ts";
import { getProjectFileForRead } from "./staging-service.ts";

describe("MZ database management", { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-agent-mz-database-"));
    project = path.join(root, "projects", "sample");
    writeMZProject(project);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, "data", "test.db"),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("preserves unknown MZ fields and nested system settings on partial edits", () => {
    const animation = getProjectManagedEntry(root, project, {
      kind: "database",
      group: "Animations",
      id: 1,
    });
    assert.equal(animation.schema?.coreFields.some((field) => field.path === "effectName"), true);
    assert.equal(animation.schema?.coreFields.some((field) => field.path === "frames"), true);

    updateProjectManagedEntry(root, project, {
      kind: "database",
      group: "Animations",
      id: 1,
      value: { id: 1, name: "Renamed Particle", rotation: { z: 45 } },
    });
    const stagedAnimations = readJson(getProjectFileForRead(root, project, "data/Animations.json")!) as Array<Record<string, unknown> | null>;
    assert.equal(stagedAnimations[1]?.name, "Renamed Particle");
    assert.equal(stagedAnimations[1]?.effectName, "battle/Spark");
    assert.deepEqual(stagedAnimations[1]?.rotation, { x: 10, y: 20, z: 45 });
    assert.deepEqual(stagedAnimations[1]?.pluginData, { keep: true });

    withTestLanguage(() => updateProjectManagedEntry(root, project, {
      kind: "database",
      group: "System",
      id: 0,
      value: { advanced: { screenWidth: 1280 } },
    }));
    const stagedSystem = readJson(getProjectFileForRead(root, project, "data/System.json")!) as Record<string, unknown>;
    assert.deepEqual(stagedSystem.advanced, {
      screenWidth: 1280,
      screenHeight: 540,
      uiAreaWidth: 960,
      uiAreaHeight: 540,
      mainFontFilename: "Main.woff",
      numberFontFilename: "Number.woff",
      fallbackFonts: "sans-serif",
      fontSize: 26,
      picturesUpperLimit: 300,
      screenScale: 1,
      windowOpacity: 192,
      pluginOption: "keep",
    });
    assert.deepEqual(stagedSystem.pluginData, { keep: true });

    const sourceAnimations = readJson(path.join(project, "data", "Animations.json")) as Array<Record<string, unknown> | null>;
    const sourceSystem = readJson(path.join(project, "data", "System.json")) as Record<string, unknown>;
    assert.equal(sourceAnimations[1]?.name, "Sample Particle");
    assert.equal((sourceSystem.advanced as Record<string, unknown>).screenWidth, 960);
  });

  test("creates native MZ animations and exposes engine-specific limits", () => {
    const created = createProjectManagedEntry(root, project, {
      kind: "database",
      group: "Animations",
    });
    const value = created.value as Record<string, unknown>;
    assert.equal(created.id, 2);
    assert.equal(value.effectName, "");
    assert.deepEqual(value.flashTimings, []);
    assert.deepEqual(value.soundTimings, []);
    assert.equal(Object.hasOwn(value, "frames"), false);

    const armor = getProjectManagedEntry(root, project, {
      kind: "database",
      group: "Armors",
      id: 1,
    });
    assert.equal(armor.schema?.maxEntries, 9999);

    const system = getProjectManagedEntry(root, project, {
      kind: "database",
      group: "System",
      id: 0,
    });
    for (const path of [
      "advanced.picturesUpperLimit",
      "advanced.screenScale",
      "advanced.windowOpacity",
    ]) {
      assert.equal(system.schema?.coreFields.some((field) => field.path === path), true);
    }
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
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    writeJson(path.join(project, "data", fileName), []);
  }
  writeJson(path.join(project, "data", "System.json"), {
    gameTitle: "Sample Game",
    tileSize: 24,
    faceSize: 144,
    iconSize: 32,
    advanced: {
      screenWidth: 960,
      screenHeight: 540,
      uiAreaWidth: 960,
      uiAreaHeight: 540,
      mainFontFilename: "Main.woff",
      numberFontFilename: "Number.woff",
      fallbackFonts: "sans-serif",
      fontSize: 26,
      picturesUpperLimit: 300,
      screenScale: 1,
      windowOpacity: 192,
      pluginOption: "keep",
    },
    switches: [null],
    variables: [null],
    skillTypes: [""],
    weaponTypes: [""],
    armorTypes: [""],
    equipTypes: [""],
    elements: [""],
    terms: {},
    pluginData: { keep: true },
  });
  writeJson(path.join(project, "data", "Animations.json"), [null, {
    id: 1,
    name: "Sample Particle",
    displayType: 0,
    effectName: "battle/Spark",
    flashTimings: [],
    soundTimings: [],
    offsetX: 0,
    offsetY: 0,
    rotation: { x: 10, y: 20, z: 30 },
    scale: 100,
    speed: 100,
    pluginData: { keep: true },
  }, null]);
  writeJson(path.join(project, "data", "Armors.json"), [null, { id: 1, name: "Sample Armor" }]);
  writeJson(path.join(project, "data", "MapInfos.json"), [null, { id: 1, name: "Sample Map" }]);
  writeJson(path.join(project, "data", "Map001.json"), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null],
  });
}
