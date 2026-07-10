import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { getProjectFileForRead, writeStagedProjectJson } from "../desktop/staging-service.ts";
import { buildRmmvDbCatalog } from "./db-catalog.ts";
import { dispatchRmmvTool } from "./rmmv-tool-dispatch.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject(root = tmpDir("db-catalog-")): string {
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

describe("RmmvReadContext database reads", { concurrency: false }, () => {
  test("paginates staged name matches with per-table page info", async () => {
    const { workflowRoot, project } = await makeStagedProject();
    try {
      writeStagedProjectJson(workflowRoot, project, "www/data/Items.json", [
        null,
        { id: 1, name: "Staged Potion", iconIndex: 1, price: 10 },
        { id: 2, name: "STAGED POTION Plus", iconIndex: 2, price: 20 },
        { id: 3, name: "Antidote", iconIndex: 3, price: 30 },
        { id: 4, name: "", iconIndex: 4, price: 40 },
        { id: 12, name: "Elixir", iconIndex: 5, price: 50 },
      ]);

      const first = await dispatchRmmvTool("db-catalog", {
        workflowRoot,
        project,
        tables: ["items"],
        query: "staged potion",
        offset: 0,
        limit: 1,
        includeUnnamed: false,
      });
      const firstData = first.data as any;
      assert.deepEqual(firstData.tables.items.map((row: { id: number }) => row.id), [1]);
      assert.deepEqual(firstData.pageInfo.items, {
        total: 5,
        matched: 2,
        offset: 0,
        limit: 1,
        nextOffset: 1,
      });

      const second = await dispatchRmmvTool("db-catalog", {
        workflowRoot,
        project,
        tables: ["items"],
        query: "STAGED POTION",
        offset: 1,
        limit: 1,
        includeUnnamed: false,
      });
      const secondData = second.data as any;
      assert.deepEqual(secondData.tables.items.map((row: { id: number }) => row.id), [2]);
      assert.equal(secondData.pageInfo.items.nextOffset, null);
    } finally {
      closeDatabase();
      fs.rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  test("filters by decimal id and keeps total independent of includeUnnamed", async () => {
    const { workflowRoot, project } = await makeStagedProject();
    try {
      writeStagedProjectJson(workflowRoot, project, "www/data/Items.json", [
        null,
        { id: 1, name: "Potion" },
        { id: 2, name: "Hi-Potion" },
        { id: 3, name: "Antidote" },
        { id: 4, name: "" },
        { id: 12, name: "Elixir" },
      ]);

      const byId = await dispatchRmmvTool("db-catalog", {
        workflowRoot,
        project,
        tables: ["items"],
        query: "12",
      });
      const byIdData = byId.data as any;
      assert.deepEqual(byIdData.tables.items.map((row: { id: number }) => row.id), [12]);
      assert.deepEqual(byIdData.pageInfo.items, {
        total: 5,
        matched: 1,
        offset: 0,
        limit: 50,
        nextOffset: null,
      });

      const defaultUnnamed = await dispatchRmmvTool("db-catalog", {
        workflowRoot,
        project,
        tables: ["items"],
        limit: 200,
      });
      assert.equal((defaultUnnamed.data as any).pageInfo.items.matched, 5);
      assert.equal((defaultUnnamed.data as any).tables.items.find((row: { id: number }) => row.id === 4).name, "#4");

      const withoutUnnamed = await dispatchRmmvTool("db-catalog", {
        workflowRoot,
        project,
        tables: ["items"],
        includeUnnamed: false,
        limit: 200,
      });
      assert.equal((withoutUnnamed.data as any).pageInfo.items.total, 5);
      assert.equal((withoutUnnamed.data as any).pageInfo.items.matched, 4);
    } finally {
      closeDatabase();
      fs.rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  test("dbEntry returns the complete staged record and hashes the effective file", async () => {
    const { workflowRoot, project } = await makeStagedProject();
    try {
      const skill = {
        id: 1,
        name: "Formula Skill",
        damage: { type: 1, elementId: 2, formula: "a.mat * 4 - b.mdf * 2", variance: 20, critical: true },
        effects: [{ code: 21, dataId: 4, value1: 0.5, value2: 0 }],
        traits: [{ code: 13, dataId: 2, value: 0.75 }],
        pluginPayload: { nested: ["keep", { enabled: true }] },
      };
      writeStagedProjectJson(workflowRoot, project, "www/data/Skills.json", [null, skill]);

      const result = await dispatchRmmvTool("db-entry", {
        workflowRoot,
        project,
        table: "skills",
        id: 1,
      });
      const entry = result.data as any;
      const effectiveFile = getProjectFileForRead(workflowRoot, project, "www/data/Skills.json");
      assert.ok(effectiveFile);
      const expectedHash = crypto.createHash("sha256").update(fs.readFileSync(effectiveFile)).digest("hex");

      assert.deepEqual(entry.value, skill);
      assert.equal(entry.table, "skills");
      assert.equal(entry.group, "Skills");
      assert.equal(entry.id, 1);
      assert.equal(entry.relativePath, "www/data/Skills.json");
      assert.equal(entry.staged, true);
      assert.equal(entry.contentHash, expectedHash);
      assert.equal(entry.schema.key, "skills");
    } finally {
      closeDatabase();
      fs.rmSync(workflowRoot, { recursive: true, force: true });
    }
  });

  for (const table of ["system", "types", "terms"] as const) {
    test(`dbEntry ${table} preserves the complete staged System document`, async () => {
      const { workflowRoot, project } = await makeStagedProject();
      try {
        const system = {
          gameTitle: "Staged Schema",
          switches: ["", "Door"],
          variables: ["", "Progress"],
          elements: ["", "Physical", "Fire"],
          skillTypes: ["", "Magic"],
          weaponTypes: ["", "Sword"],
          armorTypes: ["", "General Armor"],
          equipTypes: ["", "Weapon"],
          terms: {
            basic: ["Level"],
            params: ["Max HP"],
            commands: ["Fight", "Escape"],
            messages: { victory: "%1 wins!" },
          },
          note: "<plugin-note:keep>",
          pluginExtension: {
            enabled: true,
            customNested: { values: [1, { label: "keep" }] },
          },
        };
        writeStagedProjectJson(workflowRoot, project, "www/data/System.json", system);

        const result = await dispatchRmmvTool("db-entry", {
          workflowRoot,
          project,
          table,
          id: 0,
        });

        assert.equal((result.data as any).staged, true);
        assert.deepEqual((result.data as any).value, system);
      } finally {
        closeDatabase();
        fs.rmSync(workflowRoot, { recursive: true, force: true });
      }
    });
  }

  test("dbEntry enforces document ids and returns valid empty array slots", async () => {
    const { workflowRoot, project } = await makeStagedProject();
    try {
      writeStagedProjectJson(workflowRoot, project, "www/data/Items.json", [
        null,
        { id: 1, name: "Potion" },
        null,
      ]);

      const empty = await dispatchRmmvTool("db-entry", {
        workflowRoot,
        project,
        table: "items",
        id: 2,
      });
      assert.equal((empty.data as any).value, null);

      for (const table of ["system", "types", "terms"]) {
        const document = await dispatchRmmvTool("db-entry", {
          workflowRoot,
          project,
          table,
          id: 0,
        });
        assert.equal((document.data as any).id, 0);
        assert.equal((document.data as any).table, table);
      }

      await assert.rejects(
        dispatchRmmvTool("db-entry", { workflowRoot, project, table: "system", id: 1 }),
        /id.*0|id 0/i,
      );
      await assert.rejects(
        dispatchRmmvTool("db-entry", { workflowRoot, project, table: "items", id: 0 }),
        /positive integer/i,
      );
      await assert.rejects(
        dispatchRmmvTool("db-entry", { workflowRoot, project, table: "items", id: 3 }),
        /invalid.*id|outside/i,
      );
      await assert.rejects(
        dispatchRmmvTool("db-entry", { workflowRoot, project, table: "unknown", id: 1 }),
        /unknown.*table|allowed tables/i,
      );
    } finally {
      closeDatabase();
      fs.rmSync(workflowRoot, { recursive: true, force: true });
    }
  });
});

async function makeStagedProject(): Promise<{ workflowRoot: string; project: string }> {
  const workflowRoot = tmpDir("db-read-context-");
  const project = makeProject(path.join(workflowRoot, "projects", "sample"));
  fs.mkdirSync(path.join(workflowRoot, "data"), { recursive: true });
  await bootstrapDatabase(workflowRoot, {
    dbPath: path.join(workflowRoot, "data", "test.db"),
    importLegacyJson: false,
    skipWorkspaceLegacyCleanup: true,
    skipRuntimeLegacyCleanup: true,
  });
  return { workflowRoot, project };
}
