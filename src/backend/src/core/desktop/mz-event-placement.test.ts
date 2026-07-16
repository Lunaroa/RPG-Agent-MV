import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { RMMV_STANDARD_DATABASE_FILES } from "../rmmv/rmmv-layout.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import { createEvent, duplicateEvent, removeEvent, updateEvent } from "./event-service.ts";
import { createPlacementEvent } from "./event-placement-service.ts";
import { postMapTiles } from "./map-service.ts";
import { getMapFileForRead } from "./staging-service.ts";

describe("MZ event placement staging", { concurrency: false }, () => {
  let workflowRoot: string;
  let project: string;

  beforeEach(async () => {
    workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-agent-mz-placement-"));
    project = path.join(workflowRoot, "projects", "sample");
    writeMZProject(project);
    await bootstrapDatabase(workflowRoot, {
      dbPath: path.join(workflowRoot, "data", "test.db"),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  });

  test("compiles MZ parameters into the draft without touching the source map", () => {
    const report = createPlacementEvent(workflowRoot, project, 1, {
      name: "Sample Event",
      x: 1,
      y: 1,
      pages: [{
        trigger: "action-button",
        commands: [{ kind: "text", text: "Sample line", speakerName: "Guide" }],
      }],
    }) as { usedContractPatch?: boolean };

    assert.equal(report.usedContractPatch, true);
    const sourceMap = readJson(path.join(project, "data", "Map001.json")) as { events: unknown[] };
    assert.deepEqual(sourceMap.events, [null]);

    const stagedMapFile = getMapFileForRead(workflowRoot, project, 1)!;
    const stagedMap = readJson(stagedMapFile) as {
      events: Array<{ pages?: Array<{ list?: Array<{ code: number; parameters: unknown[] }> }> } | null>;
    };
    const showText = stagedMap.events
      .filter(Boolean)
      .flatMap((event) => event?.pages ?? [])
      .flatMap((page) => page.list ?? [])
      .find((command) => command.code === 101);
    assert.deepEqual(showText?.parameters, ["", 0, 0, 2, "Guide"]);

    const draftRoot = path.dirname(path.dirname(stagedMapFile));
    assert.equal(fs.existsSync(path.join(draftRoot, "game.rmmzproject")), true);
    assert.equal(fs.existsSync(path.join(draftRoot, "js", "rmmz_core.js")), true);
    assert.equal(fs.existsSync(path.join(draftRoot, "data", "Map002.json")), true);
  });

  test("edits MZ events with MZ command shapes in the staged data directory", () => {
    const created = createEvent(workflowRoot, project, 1, {
      name: "Plugin Event",
      x: 0,
      y: 0,
      pages: [{
        list: [
          { code: 101, indent: 0, parameters: ["", 0, 0, 2, "Guide"] },
          { code: 401, indent: 0, parameters: ["Sample line"] },
          { code: 357, indent: 0, parameters: ["SamplePlugin", "open", "Open", { target: "1" }] },
          { code: 657, indent: 0, parameters: ["target = 1"] },
          { code: 0, indent: 0, parameters: [] },
        ],
      }],
    });
    const updated = updateEvent(workflowRoot, project, 1, created.eventId, {
      ...(created.event as unknown as Record<string, unknown>),
      name: "Updated Plugin Event",
    });
    const duplicated = duplicateEvent(workflowRoot, project, 1, created.eventId);
    const removed = removeEvent(workflowRoot, project, 1, duplicated.eventId);

    assert.equal(updated.event?.name, "Updated Plugin Event");
    assert.equal(duplicated.event?.pages[0].list[2].code, 357);
    assert.equal(removed.event, null);
    assert.deepEqual((readJson(path.join(project, "data", "Map001.json")) as { events: unknown[] }).events, [null]);

    assert.throws(
      () => createEvent(workflowRoot, project, 1, {
        name: "Wrong Engine Command",
        x: 0,
        y: 0,
        pages: [{ list: [
          { code: 356, indent: 0, parameters: ["SamplePlugin open"] },
          { code: 0, indent: 0, parameters: [] },
        ] }],
      }),
      /not valid for RPG Maker MZ/,
    );
  });

  test("uses official MZ automatic and manual map layers without touching source", () => {
    postMapTiles(workflowRoot, project, 1, [{ kind: "tile", x: 0, y: 0, layer: "auto", tileId: 1 }]);
    postMapTiles(workflowRoot, project, 1, [{ kind: "tile", x: 0, y: 0, layer: "auto", tileId: 2 }]);
    const third = postMapTiles(workflowRoot, project, 1, [{ kind: "tile", x: 0, y: 0, layer: "auto", tileId: 3 }]);
    postMapTiles(workflowRoot, project, 1, [{ kind: "autotile", x: 1, y: 0, layer: "auto", autotileKind: 16 }]);
    postMapTiles(workflowRoot, project, 1, [{ kind: "autotile", x: 1, y: 1, layer: "auto", autotileKind: 20 }]);
    postMapTiles(workflowRoot, project, 1, [{ kind: "tile", x: 0, y: 1, layer: 3, tileId: 7 }]);
    const preservedShape = 2048 + 16 * 48 + 17;
    postMapTiles(workflowRoot, project, 1, [{
      kind: "tile",
      x: 1,
      y: 0,
      layer: "auto",
      tileId: preservedShape,
      preserveAutotileShape: true,
    }]);

    const staged = readJson(getMapFileForRead(workflowRoot, project, 1)!) as { data: number[] };
    const layerSize = 4;
    assert.equal(staged.data[2 * layerSize], 2);
    assert.equal(staged.data[3 * layerSize], 3);
    assert.equal(staged.data[1], preservedShape);
    assert.ok(staged.data[layerSize + 3] >= 2048 + 20 * 48);
    assert.equal(staged.data[3 * layerSize + 2], 7);
    assert.deepEqual(new Set(third.changes.map((change) => typeof change.layer)), new Set(["number"]));
    assert.equal((readJson(path.join(project, "data", "Map001.json")) as { data: number[] }).data.every((value) => value === 0), true);
  });

  test("provides complete multi-map context for MV abstract event placement", () => {
    const mvProject = path.join(workflowRoot, "projects", "sample-mv");
    writeMVProject(mvProject);

    const report = createPlacementEvent(workflowRoot, mvProject, 1, {
      name: "Sample Event",
      x: 1,
      y: 1,
      pages: [{
        trigger: "action-button",
        commands: [{ kind: "text", text: "Sample line" }],
      }],
    }) as { usedContractPatch?: boolean };

    assert.equal(report.usedContractPatch, true);
    assert.deepEqual((readJson(path.join(mvProject, "www", "data", "Map001.json")) as { events: unknown[] }).events, [null]);
    const stagedMapFile = getMapFileForRead(workflowRoot, mvProject, 1)!;
    const draftRoot = path.dirname(path.dirname(path.dirname(stagedMapFile)));
    assert.equal(fs.existsSync(path.join(draftRoot, "www", "data", "Map002.json")), true);
  });

  test("preserves unchanged legacy MV commands but rejects new invalid command shapes", () => {
    const mvProject = path.join(workflowRoot, "projects", "legacy-mv");
    const legacyList = [
      { code: 101, indent: 0, parameters: ["", 0, 2] },
      { code: 401, indent: 0, parameters: ["Legacy line"] },
      { code: 0, indent: 0, parameters: [] },
    ];
    writeMVProject(mvProject, legacyList);
    const sourceEvent = (readJson(path.join(mvProject, "www", "data", "Map001.json")) as any).events[1];

    const updated = updateEvent(workflowRoot, mvProject, 1, 1, { ...sourceEvent, name: "Updated Legacy Event" });
    const duplicated = duplicateEvent(workflowRoot, mvProject, 1, 1);

    assert.deepEqual(updated.event?.pages[0].list, legacyList);
    assert.deepEqual(duplicated.event?.pages[0].list, legacyList);

    const changed = JSON.parse(JSON.stringify(updated.event)) as any;
    changed.pages[0].list[0].parameters = ["", 0, 1];
    assert.throws(
      () => updateEvent(workflowRoot, mvProject, 1, 1, changed),
      /parameters.*4/,
    );
    assert.throws(
      () => createEvent(workflowRoot, mvProject, 1, {
        name: "Invalid New Event",
        x: 0,
        y: 0,
        pages: [{ list: [
          { code: 101, indent: 0, parameters: ["", 0, 2] },
          { code: 0, indent: 0, parameters: [] },
        ] }],
      }),
      /parameters.*4/,
    );
    assert.equal((readJson(path.join(mvProject, "www", "data", "Map001.json")) as any).events[1].name, "Legacy Event");
  });
});

function writeMZProject(project: string): void {
  const dataDir = path.join(project, "data");
  fs.mkdirSync(dataDir, { recursive: true });
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
  for (const directory of ["audio", "fonts", "img", "movies", "effects"]) {
    fs.mkdirSync(path.join(project, directory), { recursive: true });
  }
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    let value: unknown = [];
    if (fileName === "System.json") {
      value = {
        switches: [null],
        variables: [null],
        tileSize: 32,
        faceSize: 144,
        iconSize: 32,
        advanced: { screenWidth: 960, screenHeight: 540 },
      };
    } else if (fileName === "MapInfos.json") {
      value = [
        null,
        { id: 1, name: "Sample Map A", parentId: 0, order: 1 },
        { id: 2, name: "Sample Map B", parentId: 0, order: 2 },
      ];
    } else if (fileName === "CommonEvents.json" || fileName === "Tilesets.json") {
      value = [null];
    }
    writeJson(path.join(dataDir, fileName), value);
  }
  writeJson(path.join(dataDir, "Map001.json"), {
    width: 2,
    height: 2,
    tilesetId: 0,
    data: Array(24).fill(0),
    events: [null],
  });
  writeJson(path.join(dataDir, "Map002.json"), {
    width: 2,
    height: 2,
    tilesetId: 0,
    data: Array(24).fill(0),
    events: [null],
  });
}

function writeMVProject(
  project: string,
  legacyList?: Array<{ code: number; indent: number; parameters: unknown[] }>,
): void {
  const dataDir = path.join(project, "www", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    let value: unknown = [];
    if (fileName === "System.json") {
      value = { switches: [null], variables: [null] };
    } else if (fileName === "MapInfos.json") {
      value = [
        null,
        { id: 1, name: "Sample Map A", parentId: 0, order: 1 },
        { id: 2, name: "Sample Map B", parentId: 0, order: 2 },
      ];
    } else if (fileName === "CommonEvents.json" || fileName === "Tilesets.json") {
      value = [null];
    }
    writeJson(path.join(dataDir, fileName), value);
  }
  const events: unknown[] = [null];
  if (legacyList) {
    events[1] = {
      id: 1,
      name: "Legacy Event",
      note: "",
      x: 0,
      y: 0,
      pages: [{ list: legacyList }],
    };
  }
  writeJson(path.join(dataDir, "Map001.json"), {
    width: 2,
    height: 2,
    tilesetId: 0,
    data: Array(24).fill(0),
    events,
  });
  writeJson(path.join(dataDir, "Map002.json"), {
    width: 2,
    height: 2,
    tilesetId: 0,
    data: Array(24).fill(0),
    events: [null],
  });
}
