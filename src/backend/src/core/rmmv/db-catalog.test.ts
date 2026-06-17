import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildRmmvDbCatalog } from "./db-catalog.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject(): string {
  const root = tmpDir("db-catalog-");
  const dataDir = path.join(root, "www", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "Actors.json"),
    JSON.stringify([null, { id: 1, name: "Hero", classId: 1, initialLevel: 1 }, { id: 2, name: "Mage", classId: 2, initialLevel: 1 }]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dataDir, "Items.json"),
    JSON.stringify([
      null,
      { id: 1, name: "Potion", iconIndex: 176, price: 50, consumable: true, scope: 7, occasion: 0, description: "Heals 50 HP" },
      { id: 2, name: "Hi-Potion", iconIndex: 176, price: 200, consumable: true, scope: 7, occasion: 0 },
      { id: 3, name: "Antidote", iconIndex: 176, price: 80, consumable: true, scope: 7, occasion: 0 },
    ]),
    "utf8",
  );
  fs.writeFileSync(path.join(dataDir, "States.json"), JSON.stringify([null, { id: 1, name: "Death" }, { id: 4, name: "Poison", iconIndex: 7 }]), "utf8");
  fs.writeFileSync(
    path.join(dataDir, "System.json"),
    JSON.stringify({
      gameTitle: "Schema Test",
      switches: ["", "Door"],
      variables: ["", "Progress"],
      startMapId: 1,
      startX: 2,
      startY: 3,
      partyMembers: [1, 2],
      elements: ["", "Physical", "Fire"],
      skillTypes: ["", "Magic"],
      weaponTypes: ["", "Sword"],
      armorTypes: ["", "General Armor"],
      equipTypes: ["", "Weapon", "Shield"],
      terms: {
        basic: ["Level"],
        params: ["Max HP"],
        commands: ["Fight", "Escape"],
        messages: { victory: "%1 wins!" },
      },
    }),
    "utf8",
  );
  return root;
}

describe("buildRmmvDbCatalog", () => {
  test("returns rows for requested tables", () => {
    const root = makeProject();
    const result = buildRmmvDbCatalog(root, { tables: ["actors", "items"] });
    assert.equal((result.tables.actors ?? []).length, 2);
    assert.equal((result.tables.items ?? []).length, 3);
    assert.equal((result.tables.actors ?? [])[0].name, "Hero");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("filters by query", () => {
    const root = makeProject();
    const result = buildRmmvDbCatalog(root, { tables: ["items"], query: "potion" });
    assert.equal((result.tables.items ?? []).length, 2);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("respects limit", () => {
    const root = makeProject();
    const result = buildRmmvDbCatalog(root, { tables: ["items"], limit: 1 });
    assert.equal((result.tables.items ?? []).length, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("handles missing files as empty rows", () => {
    const root = tmpDir("db-catalog-empty-");
    fs.mkdirSync(path.join(root, "www", "data"), { recursive: true });
    const result = buildRmmvDbCatalog(root, { tables: ["actors", "items"] });
    assert.deepEqual(result.tables.actors, []);
    assert.deepEqual(result.tables.items, []);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("catalogs System, Types, and Terms as first-class MV database groups", () => {
    const root = makeProject();
    const result = buildRmmvDbCatalog(root, { tables: ["system", "types", "terms"] });
    assert.equal((result.tables.system ?? [])[0].name, "Schema Test");
    assert.equal((result.tables.system ?? [])[0].id, 0);
    assert.deepEqual((result.tables.types ?? [])[0], {
      id: 0,
      name: "Types",
      elements: ["", "Physical", "Fire"],
      skillTypes: ["", "Magic"],
      weaponTypes: ["", "Sword"],
      armorTypes: ["", "General Armor"],
      equipTypes: ["", "Weapon", "Shield"],
    });
    assert.deepEqual((result.tables.terms ?? [])[0], {
      id: 0,
      name: "Terms",
      basicCount: 1,
      paramsCount: 1,
      commandsCount: 2,
      messageCount: 1,
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
