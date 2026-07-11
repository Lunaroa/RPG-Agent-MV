import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createDefaultRmmvDatabaseEntry } from "./database-schema.ts";
import { applyRmmvDatabasePatch } from "./database-patch.ts";

describe("controlled RMMV database JSON patch", () => {
  test("updates declared primitive and nested fields while preserving plugin data", () => {
    const skill = {
      ...createDefaultRmmvDatabaseEntry("Skills", 1),
      pluginData: { mode: "custom" },
    };
    const result = applyRmmvDatabasePatch("skills", skill, [
      { op: "replace", path: "/name", value: "Updated Skill" },
      { op: "replace", path: "/damage/formula", value: "a.atk * 2" },
      { op: "replace", path: "/effects/0/dataId", value: 1 },
    ]);

    assert.equal(result.value.name, "Updated Skill");
    assert.equal((result.value.damage as Record<string, unknown>).formula, "a.atk * 2");
    assert.equal(((result.value.effects as Array<Record<string, unknown>>)[0]).dataId, 1);
    assert.deepEqual(result.value.pluginData, { mode: "custom" });
    assert.deepEqual(result.diffs.map((diff) => diff.path), ["/name", "/damage/formula", "/effects/0/dataId"]);
  });

  test("allows standard array element changes but rejects replacing an existing complex value", () => {
    const skill = createDefaultRmmvDatabaseEntry("Skills", 1);
    const added = applyRmmvDatabasePatch("skills", skill, [{
      op: "add",
      path: "/effects/-",
      value: { code: 44, dataId: 1, value1: 0, value2: 0 },
    }]);
    assert.equal((added.value.effects as unknown[]).length, 2);

    const removed = applyRmmvDatabasePatch("skills", added.value, [{ op: "remove", path: "/effects/0" }]);
    assert.equal((removed.value.effects as unknown[]).length, 1);

    assert.throws(
      () => applyRmmvDatabasePatch("skills", skill, [{
        op: "replace",
        path: "/damage",
        value: { type: 0, elementId: 0, formula: "0", variance: 0, critical: false },
      }]),
      /cannot replace an existing complex value/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("skills", skill, [{
        op: "replace",
        path: "/effects/0",
        value: { code: 44, dataId: 1, value1: 0, value2: 0 },
      }]),
      /cannot replace an existing complex value/i,
    );
  });

  test("rejects id changes, unknown/plugin paths, document-wide replacement, and ordinary type-list patches", () => {
    const actor = {
      ...createDefaultRmmvDatabaseEntry("Actors", 1),
      pluginData: { enabled: true },
    };
    assert.throws(
      () => applyRmmvDatabasePatch("actors", actor, [{ op: "replace", path: "/id", value: 2 }]),
      /immutable/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("actors", actor, [{ op: "replace", path: "/pluginData/enabled", value: false }]),
      /not declared/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("actors", actor, [{ op: "replace", path: "", value: actor }]),
      /whole database record/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("types", createDefaultRmmvDatabaseEntry("Types"), [{
        op: "replace",
        path: "/skillTypes/1",
        value: "Renamed",
      }]),
      /type-list operations/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("system", createDefaultRmmvDatabaseEntry("System"), [{
        op: "replace",
        path: "/skillTypes/1",
        value: "Renamed",
      }]),
      /type-list operations/i,
    );
  });

  test("keeps switch and variable ids stable by allowing only tail insertion or removal", () => {
    const system = createDefaultRmmvDatabaseEntry("System");
    system.switches = ["", "First", "Second"];

    const appended = applyRmmvDatabasePatch("system", system, [{ op: "add", path: "/switches/-", value: "Third" }]);
    assert.deepEqual(appended.value.switches, ["", "First", "Second", "Third"]);
    const renamed = applyRmmvDatabasePatch("system", appended.value, [{
      op: "replace",
      path: "/switches/1",
      value: "Renamed",
    }]);
    assert.equal((renamed.value.switches as string[])[1], "Renamed");
    const removed = applyRmmvDatabasePatch("system", renamed.value, [{ op: "remove", path: "/switches/3" }]);
    assert.equal((removed.value.switches as string[]).length, 3);

    assert.throws(
      () => applyRmmvDatabasePatch("system", system, [{ op: "add", path: "/switches/1", value: "Shift" }]),
      /tail/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("system", system, [{ op: "remove", path: "/switches/1" }]),
      /tail/i,
    );
  });

  test("supports declared event-command leaves and rejects malformed JSON pointers", () => {
    const commonEvent = createDefaultRmmvDatabaseEntry("CommonEvents", 1);
    commonEvent.list = [
      { code: 117, indent: 0, parameters: [1] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const patched = applyRmmvDatabasePatch("commonEvents", commonEvent, [{
      op: "replace",
      path: "/list/0/parameters/0",
      value: 2,
    }]);
    assert.equal((((patched.value.list as unknown[])[0] as Record<string, unknown>).parameters as unknown[])[0], 2);

    assert.throws(
      () => applyRmmvDatabasePatch("commonEvents", commonEvent, [{ op: "replace", path: "list/0", value: 1 }]),
      /JSON Pointer/i,
    );
    assert.throws(
      () => applyRmmvDatabasePatch("commonEvents", commonEvent, [{ op: "replace", path: "/list/~2", value: 1 }]),
      /escape/i,
    );
  });
});
