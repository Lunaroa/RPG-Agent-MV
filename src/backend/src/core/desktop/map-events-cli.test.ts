import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { removeMapEvent, removeMapEventsBatch } from "./map-events-cli.ts";
import { getMapFileForRead } from "./staging-service.ts";
import { initializeOriginalStoryProject } from "./story-page-sync-service.ts";

interface Fixture {
  root: string;
  project: string;
  mapFile: string;
}

describe("map-events cli helpers", { concurrency: false }, () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, "data", "test-rmmv.db"),
      importLegacyJson: false,
    });
    initializeOriginalStoryProject(fixture.project);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test("removeMapEvent deletes an event slot from the staged map file", () => {
    writeJson(fixture.mapFile, {
      width: 2,
      height: 2,
      tilesetId: 1,
      data: Array(24).fill(0),
      events: [
        null,
        { id: 1, name: "EV001", note: "", x: 0, y: 0, pages: [{ conditions: {}, directionFix: false, image: { tileId: 0, characterName: "", direction: 2, pattern: 1, characterIndex: 0 }, list: [{ code: 0, indent: 0, parameters: [] }], moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }, moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true }] },
      ],
    });

    const report = removeMapEvent(fixture.root, fixture.project, 1, 1) as { op: string; eventId: number };
    assert.equal(report.op, "delete");
    assert.equal(report.eventId, 1);
    const map = readJson(getMapFileForRead(fixture.root, fixture.project, 1)) as { events: Array<unknown | null> };
    assert.equal(map.events[1], null);
    const source = readJson(fixture.mapFile) as { events: Array<unknown | null> };
    assert.ok(source.events[1]);
  });

  test("removeMapEventsBatch reports partial failures without stopping early", () => {
    writeJson(fixture.mapFile, {
      width: 2,
      height: 2,
      tilesetId: 1,
      data: Array(24).fill(0),
      events: [
        null,
        { id: 1, name: "EV001", note: "", x: 0, y: 0, pages: [{ conditions: {}, directionFix: false, image: { tileId: 0, characterName: "", direction: 2, pattern: 1, characterIndex: 0 }, list: [{ code: 0, indent: 0, parameters: [] }], moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }, moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true }] },
      ],
    });

    const result = removeMapEventsBatch(fixture.root, fixture.project, [
      { mapId: 1, eventId: 1 },
      { mapId: 1, eventId: 99 },
    ]);
    assert.equal(result.status, "partial");
    assert.equal(result.removed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors[0]?.eventId, 99);
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-map-events-cli-"));
  const project = path.join(root, "projects", "Project");
  const dataDir = path.join(project, "www", "data");
  const mapFile = path.join(dataDir, "Map001.json");
  writeJson(path.join(dataDir, "MapInfos.json"), [null, { id: 1, name: "Start", parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, "Tilesets.json"), [null, { id: 1, name: "Outside", mode: 1, tilesetNames: ["Outside_A1"], flags: [] }]);
  writeJson(mapFile, { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  return { root, project, mapFile };
}
