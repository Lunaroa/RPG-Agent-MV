import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { getMapFileForRead, getProjectFileForRead } from "../desktop/staging-service.ts";
import { initializeOriginalStoryProject } from "../desktop/story-page-sync-service.ts";
import { readJson, writeJson } from "./json.ts";
import { dispatchRmmvTool } from "./rmmv-tool-dispatch.ts";
import { runRmmvEventEditor, runRmmvMapEditor } from "./rmmv-handlers.ts";

interface Fixture {
  root: string;
  project: string;
  dataDir: string;
  mapFile: string;
}

describe("RMMV editor handlers", { concurrency: false }, () => {
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

  test("map editor actions share the desktop staging backend", () => {
    const created = runRmmvMapEditor({
      action: "create",
      workflowRoot: fixture.root,
      project: fixture.project,
      name: "Room",
      width: 3,
      height: 4,
      tilesetId: 1,
      parentId: 1,
    }).data as any;

    assert.equal(created.mapId, 2);
    assert.equal((readJson(projectFileForRead(fixture.root, fixture.project, "www/data/MapInfos.json")) as any[])[2].parentId, 1);
    assert.equal((readJson(projectFileForRead(fixture.root, fixture.project, "www/data/Map002.json")) as any).width, 3);
    assert.equal(fs.existsSync(path.join(fixture.dataDir, "Map002.json")), false);

    const painted = runRmmvMapEditor({
      action: "paint",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
      edits: [{ x: 0, y: 0, layer: 0, tileId: 7 }],
    }).data as any;
    assert.equal(painted.changedCells, 1);
    assert.equal((readJson(getMapFileForRead(fixture.root, fixture.project, 1)) as any).data[0], 7);
    assert.equal((readJson(fixture.mapFile) as any).data[0], 0);

    const status = runRmmvMapEditor({
      action: "projectStaging",
      workflowRoot: fixture.root,
      project: fixture.project,
    }).data as any;
    assert.equal(status.staged, true);

    runRmmvMapEditor({
      action: "discardProject",
      workflowRoot: fixture.root,
      project: fixture.project,
    });
    assert.equal((readJson(fixture.mapFile) as any).data[0], 0);
    assert.equal(fs.existsSync(path.join(fixture.dataDir, "Map002.json")), false);
  });

  test("map editor rejects invalid UI-level properties", () => {
    assert.throws(
      () => runRmmvMapEditor({
        action: "create",
        workflowRoot: fixture.root,
        project: fixture.project,
        name: "Bad",
        width: 257,
        height: 10,
        tilesetId: 1,
        parentId: 0,
      }),
      /must be <= 256/,
    );
    assert.throws(
      () => runRmmvMapEditor({
        action: "create",
        workflowRoot: fixture.root,
        project: fixture.project,
        name: "Bad",
        width: 10,
        height: 10,
        tilesetId: 99,
        parentId: 0,
      }),
      /Tileset does not exist/,
    );
    assert.throws(
      () => runRmmvMapEditor({
        action: "duplicate",
        workflowRoot: fixture.root,
        project: fixture.project,
        mapId: 1,
        parentId: 99,
      }),
      /Parent map does not exist/,
    );
  });

  test("event editor create and duplicate are blocked for agent-facing workflow", () => {
    assert.throws(() => runRmmvEventEditor({
      action: "create",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
      event: { name: "Guide", x: 0, y: 0 },
      agent: "test-agent",
      taskId: "session-1",
    }), /cannot create new map events directly/i);
    assert.throws(() => runRmmvEventEditor({
      action: "duplicate",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
      eventId: 1,
      agent: "test-agent",
      taskId: "session-1",
    }), /cannot duplicate map events directly/i);
  });

  test("event editor actions use managed writes for existing events", () => {
    writeJson(fixture.mapFile, {
      width: 2,
      height: 2,
      tilesetId: 1,
      data: Array(24).fill(0),
      events: [null, { id: 1, name: "Guide", x: 0, y: 0, pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }] }],
    });

    const moved = runRmmvEventEditor({
      action: "move",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
      eventId: 1,
      x: 1,
      y: 1,
    }).data as any;
    assert.equal(moved.after.x, 1);
    assert.equal(moved.after.y, 1);

    const removed = runRmmvEventEditor({
      action: "remove",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
      eventId: 1,
    }).data as any;
    assert.equal(removed.op, "delete");
  });

  test("dispatch exposes full map data through the shared editor handler", async () => {
    const result = await dispatchRmmvTool("map-editor", {
      action: "mapData",
      workflowRoot: fixture.root,
      project: fixture.project,
      mapId: 1,
    });
    assert.equal((result.data as any).map.width, 2);
    assert.equal((result.data as any).info.name, "Start");
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-editor-handlers-"));
  const project = path.join(root, "projects", "Project");
  const dataDir = path.join(project, "www", "data");
  const mapFile = path.join(dataDir, "Map001.json");
  writeJson(path.join(dataDir, "MapInfos.json"), [
    null,
    { id: 1, name: "Start", parentId: 0, order: 1, expanded: true },
  ]);
  writeJson(path.join(dataDir, "Tilesets.json"), [
    null,
    { id: 1, name: "Outside", mode: 1, tilesetNames: [], flags: [] },
  ]);
  writeJson(path.join(dataDir, "System.json"), {
    switches: [null],
    variables: [null],
    startMapId: 1,
    startX: 0,
    startY: 0,
  });
  writeJson(mapFile, {
    width: 2,
    height: 2,
    tilesetId: 1,
    data: Array(24).fill(0),
    events: [null],
  });
  return { root, project, dataDir, mapFile };
}

function projectFileForRead(root: string, project: string, relativePath: string): string {
  const file = getProjectFileForRead(root, project, relativePath);
  assert.ok(file, `expected project file for ${relativePath}`);
  return file;
}
