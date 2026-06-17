import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyPatchToProject } from "./patcher.ts";

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-raw-command-patcher-"));
  const data = path.join(root, "www", "data");
  writeJson(path.join(data, "System.json"), {
    switches: [null, "Story"],
    variables: [null, "Input"],
  });
  writeJson(path.join(data, "MapInfos.json"), [null, { id: 1, name: "Town", parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(data, "CommonEvents.json"), [null, { id: 1, name: "Intro", trigger: 0, switchId: 1, list: [{ code: 0, indent: 0, parameters: [] }] }]);
  writeJson(path.join(data, "Tilesets.json"), [null, { id: 1, name: "Outside" }]);
  writeJson(path.join(data, "Map001.json"), { width: 20, height: 15, events: [null] });
  return root;
}

test("patcher accepts validated raw MV commands in add-map-event pages", () => {
  const project = tmpProject();
  applyPatchToProject(project, {
    engine: "rpg-maker-mv",
    operations: [{
      op: "add-map-event",
      mapId: 1,
      name: "RawCommandEvent",
      x: 2,
      y: 3,
      pages: [{
        commands: [
          { kind: "raw-command", code: 103, indent: 0, parameters: [1, 3] },
          { kind: "mv-command", code: 117, indent: 0, parameters: [1] },
          { kind: "raw-command", code: 302, indent: 0, parameters: [0, 1, 0, 0, false] },
        ],
      }],
    }],
  });

  const map = JSON.parse(fs.readFileSync(path.join(project, "www", "data", "Map001.json"), "utf8"));
  const list = map.events[1].pages[0].list;
  assert.deepEqual(list.map((command: { code: number }) => command.code), [103, 117, 302, 0]);
});

test("patcher rejects unknown raw MV command codes before writing the map", () => {
  const project = tmpProject();
  assert.throws(
    () => applyPatchToProject(project, {
      engine: "rpg-maker-mv",
      operations: [{
        op: "add-map-event",
        mapId: 1,
        name: "BadRawCommandEvent",
        x: 2,
        y: 3,
        pages: [{
          commands: [{ kind: "raw-command", code: 999, indent: 0, parameters: [] }],
        }],
      }],
    }),
    /not a standard RPG Maker MV event command code/
  );

  const map = JSON.parse(fs.readFileSync(path.join(project, "www", "data", "Map001.json"), "utf8"));
  assert.equal(map.events.length, 1);
});
