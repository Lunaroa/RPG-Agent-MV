import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import { buildMapIndex, moveMapDraft, searchProjectEvents } from "./map-service.ts";
import { getProjectFileForRead, writeStagedProjectJson } from "./staging-service.ts";

describe("MZ map ordering and event search", { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-agent-mz-map-tools-"));
    project = path.join(root, "projects", "sample");
    writeMZProject(project);
    await bootstrapDatabase(root, { dbPath: path.join(root, "data", "test.db"), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("moves a complete map subtree atomically and rejects parent cycles", () => {
    moveMapDraft(root, project, 4, 2, "before");
    let maps = buildMapIndex(root, project).maps;
    assert.deepEqual(maps.map((entry) => [entry.id, entry.parentId, entry.order]), [
      [1, 0, 1],
      [3, 1, 2],
      [4, 0, 3],
      [2, 0, 4],
    ]);

    moveMapDraft(root, project, 1, 2, "inside");
    maps = buildMapIndex(root, project).maps;
    assert.deepEqual(maps.map((entry) => [entry.id, entry.parentId, entry.order]), [
      [4, 0, 1],
      [2, 0, 2],
      [1, 2, 3],
      [3, 1, 4],
    ]);
    assert.throws(() => moveMapDraft(root, project, 2, 3, "inside"), /cycle/);

    const source = readJson(path.join(project, "data", "MapInfos.json")) as Array<{ parentId: number } | null>;
    assert.equal(source[1]?.parentId, 0);
    const staged = readJson(getProjectFileForRead(root, project, "data/MapInfos.json")!) as Array<{ parentId: number } | null>;
    assert.equal(staged[1]?.parentId, 2);
  });

  test("finds names, notes, command text and ids in staged maps", () => {
    const stagedMap = readJson(path.join(project, "data", "Map002.json")) as Record<string, unknown>;
    const events = stagedMap.events as Array<Record<string, unknown> | null>;
    const pages = events[2]!.pages as Array<Record<string, unknown>>;
    pages[0].list = [
      { code: 357, indent: 0, parameters: ["SamplePlugin", "openPanel", "Open Panel", { label: "Staged marker" }] },
      { code: 0, indent: 0, parameters: [] },
    ];
    writeStagedProjectJson(root, project, "data/Map002.json", stagedMap);

    const command = searchProjectEvents(root, project, "staged marker");
    assert.deepEqual(command.hits.map((hit) => [hit.mapId, hit.eventId, hit.pageIndex, hit.commandIndex, hit.matchKind]), [
      [2, 2, 0, 0, "command"],
    ]);
    assert.equal(searchProjectEvents(root, project, "Greeter").hits.some((hit) => hit.matchKind === "name"), true);
    assert.equal(searchProjectEvents(root, project, "sample note").hits.some((hit) => hit.matchKind === "note"), true);
    assert.equal(searchProjectEvents(root, project, "#2").hits.some((hit) => hit.mapId === 2 && hit.eventId === 2 && hit.matchKind === "id"), true);
    assert.doesNotMatch(JSON.stringify(readJson(path.join(project, "data", "Map002.json"))), /Staged marker/);
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
      : relative === "package.json" ? '{"main":"index.html"}' : "";
    fs.writeFileSync(file, content, "utf8");
  }
  for (const directory of ["audio", "fonts", "img", "movies", "effects", "js/plugins", "data"]) {
    fs.mkdirSync(path.join(project, ...directory.split("/")), { recursive: true });
  }
  writeJson(path.join(project, "data", "System.json"), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
  });
  writeJson(path.join(project, "data", "Tilesets.json"), [null]);
  writeJson(path.join(project, "data", "MapInfos.json"), [
    null,
    { id: 1, name: "Root A", parentId: 0, order: 1, expanded: true },
    { id: 2, name: "Root B", parentId: 0, order: 2, expanded: true },
    { id: 3, name: "Child A", parentId: 1, order: 3, expanded: true },
    { id: 4, name: "Root C", parentId: 0, order: 4, expanded: true },
  ]);
  writeJson(path.join(project, "data", "Map001.json"), sampleMap(1, "Greeter", "sample note", "Welcome traveler"));
  writeJson(path.join(project, "data", "Map002.json"), sampleMap(2, "Second Event", "", "Original text"));
  writeJson(path.join(project, "data", "Map003.json"), sampleMap(3, "Child Event", "", "Child text"));
  writeJson(path.join(project, "data", "Map004.json"), sampleMap(4, "Third Event", "", "Third text"));
}

function sampleMap(eventId: number, name: string, note: string, text: string): Record<string, unknown> {
  return {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null, ...(eventId === 2 ? [null] : []), {
      id: eventId,
      name,
      note,
      x: 0,
      y: 0,
      pages: [{ list: [{ code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] }, { code: 401, indent: 0, parameters: [text] }, { code: 0, indent: 0, parameters: [] }] }],
    }],
  };
}
