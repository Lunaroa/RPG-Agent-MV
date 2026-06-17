import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findCommonEventReferences } from "./common-event-references.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProject(): { root: string; dataDir: string } {
  const root = tmpDir("ce-refs-");
  const dataDir = path.join(root, "www", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "System.json"), JSON.stringify({ startCommonEvent: 0 }), "utf8");
  return { root, dataDir };
}

function writeMap(dataDir: string, id: number, events: unknown[]): void {
  fs.writeFileSync(
    path.join(dataDir, `Map${String(id).padStart(3, "0")}.json`),
    JSON.stringify({ width: 5, height: 5, tilesetId: 1, events }),
    "utf8",
  );
}

describe("findCommonEventReferences", () => {
  test("finds map-event references with full coordinates", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(
      path.join(dataDir, "MapInfos.json"),
      JSON.stringify([null, { id: 1, name: "Map001", parentId: 0, order: 1 }]),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dataDir, "CommonEvents.json"),
      JSON.stringify([null, { id: 1, name: "CE_Greeting", list: [{ code: 0 }] }]),
      "utf8",
    );
    writeMap(dataDir, 1, [
      null,
      {
        id: 1,
        pages: [
          { list: [{ code: 117, parameters: [1] }, { code: 0 }] },
          { list: [{ code: 117, parameters: [1] }, { code: 0 }] },
        ],
      },
    ]);

    const result = findCommonEventReferences(root, 1);
    assert.equal(result.exists, true);
    assert.equal(result.name, "CE_Greeting");
    assert.equal(result.referencedBy.length, 2);
    assert.deepEqual(result.referencedBy[0], {
      kind: "mapEvent",
      mapId: 1,
      eventId: 1,
      pageIndex: 0,
      commandIndex: 0,
    });

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("finds references from another common event", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(path.join(dataDir, "MapInfos.json"), JSON.stringify([null]), "utf8");
    fs.writeFileSync(
      path.join(dataDir, "CommonEvents.json"),
      JSON.stringify([
        null,
        { id: 1, name: "CE_Target", list: [{ code: 0 }] },
        { id: 2, name: "CE_Caller", list: [{ code: 117, parameters: [1] }, { code: 0 }] },
      ]),
      "utf8",
    );

    const result = findCommonEventReferences(root, 1);
    assert.equal(result.referencedBy.length, 1);
    assert.deepEqual(result.referencedBy[0], { kind: "commonEvent", commonEventId: 2, commandIndex: 0 });

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns empty array when nobody references the common event", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(path.join(dataDir, "MapInfos.json"), JSON.stringify([null]), "utf8");
    fs.writeFileSync(
      path.join(dataDir, "CommonEvents.json"),
      JSON.stringify([null, { id: 1, name: "CE_Lonely", list: [{ code: 0 }] }]),
      "utf8",
    );

    const result = findCommonEventReferences(root, 1);
    assert.deepEqual(result.referencedBy, []);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("detects System startCommonEvent hook", () => {
    const { root, dataDir } = makeProject();
    fs.writeFileSync(path.join(dataDir, "System.json"), JSON.stringify({ startCommonEvent: 5 }), "utf8");
    fs.writeFileSync(path.join(dataDir, "MapInfos.json"), JSON.stringify([null]), "utf8");
    fs.writeFileSync(
      path.join(dataDir, "CommonEvents.json"),
      JSON.stringify([null, null, null, null, null, { id: 5, name: "CE_Boot", list: [{ code: 0 }] }]),
      "utf8",
    );

    const result = findCommonEventReferences(root, 5);
    assert.equal(result.referencedBy.length, 1);
    assert.deepEqual(result.referencedBy[0], { kind: "system", systemKey: "startCommonEvent" });

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("rejects non-positive ids", () => {
    const { root } = makeProject();
    assert.throws(() => findCommonEventReferences(root, 0), /commonEventId must be a positive integer/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
