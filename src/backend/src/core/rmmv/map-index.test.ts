import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildRmmvMapIndex } from "./map-index.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeMap(dataDir: string, id: number, body: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dataDir, `Map${String(id).padStart(3, "0")}.json`),
    JSON.stringify(body),
    "utf8",
  );
}

function makeProject(): { root: string; dataDir: string } {
  const root = tmpDir("map-index-");
  const dataDir = path.join(root, "www", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "Tilesets.json"),
    JSON.stringify([null, { id: 1, name: "Town" }, { id: 2, name: "Cave" }]),
    "utf8",
  );
  return { root, dataDir };
}

describe("buildRmmvMapIndex", () => {
  test("counts maps and resolves tileset names", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(
      path.join(dataDir, "MapInfos.json"),
      JSON.stringify([
        null,
        { id: 1, name: "World", parentId: 0, order: 1 },
        { id: 2, name: "Town", parentId: 1, order: 1 },
      ]),
      "utf8",
    );
    writeMap(dataDir, 1, { width: 30, height: 20, tilesetId: 1, events: [null, { id: 1 }, { id: 2 }] });
    writeMap(dataDir, 2, { width: 12, height: 10, tilesetId: 2, events: [null, { id: 1 }] });

    const result = buildRmmvMapIndex(root);

    assert.equal(result.maps.length, 2);
    const world = result.maps.find((map) => map.id === 1)!;
    assert.equal(world.name, "World");
    assert.equal(world.tilesetName, "Town");
    assert.equal(world.eventCount, 2);
    const town = result.maps.find((map) => map.id === 2)!;
    assert.equal(town.parentId, 1);
    assert.equal(town.tilesetName, "Cave");
    assert.equal(town.eventCount, 1);

    const root0 = result.tree.find((node) => node.id === 0);
    assert.deepEqual(root0?.children, [1]);
    const node1 = result.tree.find((node) => node.id === 1)!;
    assert.deepEqual(node1.children, [2]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns null tilesetName when not in catalog", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(
      path.join(dataDir, "MapInfos.json"),
      JSON.stringify([null, { id: 1, name: "Lab", parentId: 0, order: 1 }]),
      "utf8",
    );
    writeMap(dataDir, 1, { width: 10, height: 10, tilesetId: 99, events: [] });

    const result = buildRmmvMapIndex(root);
    assert.equal(result.maps[0].tilesetName, null);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("ignores empty MapInfos slots and missing map files", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(
      path.join(dataDir, "MapInfos.json"),
      JSON.stringify([
        null,
        { id: 1, name: "Alpha", parentId: 0, order: 2 },
        null,
        { id: 3, name: "Gamma", parentId: 0, order: 1 },
      ]),
      "utf8",
    );
    writeMap(dataDir, 1, { width: 5, height: 5, tilesetId: 1, events: [] });

    const result = buildRmmvMapIndex(root);
    assert.equal(result.maps.length, 2);
    assert.equal(result.maps[0].id, 3);
    assert.equal(result.maps[0].width, 0);
    assert.equal(result.maps[1].id, 1);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
