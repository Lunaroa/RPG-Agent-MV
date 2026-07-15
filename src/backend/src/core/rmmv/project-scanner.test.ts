import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

import { scanProject, resolveDataDir } from "./project-scanner.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMinimalProject(root: string, layout: "www" | "flat" = "www"): void {
  const dataDir = layout === "www" ? path.join(root, "www", "data") : path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, "System.json"), JSON.stringify({
    gameTitle: "Scan Project",
    switches: ["", "Switch A", "Switch B"],
    variables: ["", "Var X"],
    elements: ["", "Physical"],
    skillTypes: ["", "Magic"],
    weaponTypes: ["", "Sword"],
    armorTypes: ["", "General Armor"],
    equipTypes: ["", "Weapon"],
    terms: { basic: ["Level"], params: [], commands: [], messages: {} },
  }), "utf8");

  fs.writeFileSync(path.join(dataDir, "MapInfos.json"), JSON.stringify([
    null,
    { id: 1, name: "Map001", parentId: 0, order: 1 },
  ]), "utf8");

  fs.writeFileSync(path.join(dataDir, "Map001.json"), JSON.stringify({
    width: 20,
    height: 15,
    tilesetId: 1,
    events: [
      null,
      {
        id: 1,
        name: "EV_Test",
        note: "test note",
        x: 5,
        y: 3,
        pages: [{
          list: [
            { code: 101, parameters: ["Actor1", 0, 0, 2] },
            { code: 401, parameters: ["Lost hunter dialogue"] },
            { code: 102, parameters: [["Accept quest", "Leave"]] },
            { code: 108, parameters: ["secret-comment"] },
            { code: 121, parameters: [1, 1, 0] },
            { code: 122, parameters: [1, 1, 0, 0, 3] },
            { code: 356, parameters: ["ShowQuestWindow hunter"] },
            { code: 355, parameters: ["scriptFlag = true"] },
          ],
        }],
      },
    ],
  }), "utf8");

  fs.writeFileSync(path.join(dataDir, "CommonEvents.json"), JSON.stringify([
    null,
    {
      id: 1,
      name: "CE_Auto",
      trigger: 1,
      switchId: 1,
      list: [
        { code: 401, parameters: ["Common branch text"] },
        { code: 356, parameters: ["common-plugin"] },
      ],
    },
  ]), "utf8");

  const dbFiles = ["Actors", "Classes", "Skills", "Items", "Weapons", "Armors", "Enemies", "Troops", "States", "Animations", "Tilesets"];
  for (const stem of dbFiles) {
    fs.writeFileSync(path.join(dataDir, `${stem}.json`), JSON.stringify([
      null,
      { id: 1, name: `${stem}_1` },
    ]), "utf8");
  }
}

describe("project-scanner", () => {
  describe("resolveDataDir", () => {
    test("finds www/data layout", () => {
      const root = tmpDir("scanner-www-");
      const dataDir = path.join(root, "www", "data");
      fs.mkdirSync(dataDir, { recursive: true });
      assert.equal(resolveDataDir(root), dataDir);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("finds flat data layout", () => {
      const root = tmpDir("scanner-flat-");
      const dataDir = path.join(root, "data");
      fs.mkdirSync(dataDir, { recursive: true });
      assert.equal(resolveDataDir(root), dataDir);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("prefers www/data over data", () => {
      const root = tmpDir("scanner-both-");
      fs.mkdirSync(path.join(root, "www", "data"), { recursive: true });
      fs.mkdirSync(path.join(root, "data"), { recursive: true });
      assert.equal(resolveDataDir(root), path.join(root, "www", "data"));
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("throws when no data dir found", () => {
      const root = tmpDir("scanner-empty-");
      assert.throws(() => resolveDataDir(root), /Cannot find RPG Maker MV data folder/);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe("scanProject", () => {
    test("returns complete scan result", () => {
      const root = tmpDir("scanner-scan-");
      createMinimalProject(root);
      const result = scanProject(root);

      assert.equal(result.engine, "rpg-maker-mv");
      assert.ok(result.generatedAt);
      assert.equal(result.switches.length, 2);
      assert.equal(result.switches[0].name, "Switch A");
      assert.equal(result.variables.length, 1);
      assert.equal(result.variables[0].name, "Var X");
      assert.equal(result.maps.length, 1);
      assert.equal(result.maps[0].name, "Map001");
      assert.equal(result.maps[0].width, 20);
      assert.equal(result.maps[0].height, 15);
      assert.equal(result.maps[0].eventCount, 1);
      assert.equal(result.maps[0].events[0].name, "EV_Test");
      assert.match(result.maps[0].events[0].searchText, /Lost hunter dialogue/);
      assert.match(result.maps[0].events[0].searchText, /Accept quest/);
      assert.match(result.maps[0].events[0].searchText, /secret-comment/);
      assert.match(result.maps[0].events[0].searchText, /Switch A/);
      assert.match(result.maps[0].events[0].searchText, /Var X/);
      assert.match(result.maps[0].events[0].searchText, /ShowQuestWindow hunter/);
      assert.match(result.maps[0].events[0].searchText, /scriptFlag = true/);
      assert.equal(result.commonEvents.length, 1);
      assert.equal(result.commonEvents[0].name, "CE_Auto");
      assert.equal(result.commonEvents[0].trigger, "autorun");
      assert.match(result.commonEvents[0].searchText, /Common branch text/);
      assert.match(result.commonEvents[0].searchText, /common-plugin/);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("handles missing optional files gracefully", () => {
      const root = tmpDir("scanner-minimal-");
      const dataDir = path.join(root, "www", "data");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, "System.json"), "{}", "utf8");
      fs.writeFileSync(path.join(dataDir, "MapInfos.json"), "[]", "utf8");

      const result = scanProject(root);
      assert.equal(result.maps.length, 0);
      assert.equal(result.commonEvents.length, 0);
      assert.deepEqual(result.switches, []);
      assert.deepEqual(result.variables, []);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("audit detects missing map file", () => {
      const root = tmpDir("scanner-audit-");
      const dataDir = path.join(root, "www", "data");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, "System.json"), "{}", "utf8");
      fs.writeFileSync(path.join(dataDir, "MapInfos.json"), JSON.stringify([
        { id: 99, name: "Missing", parentId: 0, order: 0 },
      ]), "utf8");

      const result = scanProject(root);
      const missingFindings = result.audit.findings.filter((f) => f.code === "missing-map-file");
      assert.equal(missingFindings.length, 1);
      assert.equal(result.audit.summary.error, 1);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("database summary counts entries", () => {
      const root = tmpDir("scanner-db-");
      createMinimalProject(root);
      const result = scanProject(root);

      assert.equal(result.database.Actors.exists, true);
      assert.equal(result.database.Actors.count, 1);
      assert.equal(result.database.Actors.named.length, 1);
      assert.equal(result.database.Actors.named[0].name, "Actors_1");
      assert.equal(Object.keys(result.database).length, 15);
      assert.equal(result.database.System.exists, true);
      assert.equal(result.database.System.named[0].name, "Scan Project");
      assert.equal(result.database.Types.exists, true);
      assert.equal(result.database.Terms.exists, true);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("uses side-view enemy assets for enemy and troop previews", () => {
      const root = tmpDir("scanner-side-view-");
      createMinimalProject(root);
      const dataDir = path.join(root, "www", "data");
      const system = JSON.parse(fs.readFileSync(path.join(dataDir, "System.json"), "utf8"));
      fs.writeFileSync(path.join(dataDir, "System.json"), JSON.stringify({ ...system, optSideView: true }), "utf8");
      fs.writeFileSync(path.join(dataDir, "Enemies.json"), JSON.stringify([
        null,
        { id: 1, name: "Sample Enemy", battlerName: "SampleBattler" },
      ]), "utf8");
      fs.writeFileSync(path.join(dataDir, "Troops.json"), JSON.stringify([
        null,
        { id: 1, name: "Sample Troop", members: [{ enemyId: 1, x: 400, y: 400 }] },
      ]), "utf8");

      const result = scanProject(root);

      assert.equal(result.database.Enemies.named[0].preview?.asset, "svEnemies");
      assert.equal(result.database.Troops.named[0].preview?.asset, "svEnemies");
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("database summary exposes records after the first 80 entries", () => {
      const root = tmpDir("scanner-db-complete-");
      createMinimalProject(root);
      const dataDir = path.join(root, "www", "data");
      fs.writeFileSync(
        path.join(dataDir, "Actors.json"),
        JSON.stringify([
          null,
          ...Array.from({ length: 81 }, (_, index) => ({ id: index + 1, name: `Actor ${index + 1}` })),
        ]),
        "utf8",
      );

      const result = scanProject(root);

      assert.equal(result.database.Actors.named.length, 81);
      assert.equal(result.database.Actors.named[80].id, 81);
      assert.equal(result.database.Actors.named[80].name, "Actor 81");
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("handles flat data layout", () => {
      const root = tmpDir("scanner-flat-");
      createMinimalProject(root, "flat");
      const result = scanProject(root);
      assert.equal(result.engine, "rpg-maker-mv");
      assert.equal(result.maps.length, 1);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });
});
