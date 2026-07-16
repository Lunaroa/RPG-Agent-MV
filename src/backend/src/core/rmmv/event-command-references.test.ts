import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  collectEventCommandReferences,
  type RmmvEventCommandReference,
} from "./event-command-references.ts";

function referencesFor(command: Record<string, unknown>): RmmvEventCommandReference[] {
  const terminators: Partial<Record<number, number>> = { 102: 404, 111: 412, 112: 413, 301: 604 };
  const terminator = terminators[Number(command.code)];
  return collectEventCommandReferences([
    { indent: 0, ...command },
    ...(terminator === undefined ? [] : [{ code: terminator, indent: 0, parameters: [] }]),
    { code: 0, indent: 0, parameters: [] },
  ], "list");
}

function signatures(references: RmmvEventCommandReference[]): string[] {
  return references.map((reference) =>
    `${reference.target}:${String(reference.value)}:${reference.path}`
  );
}

describe("RMMV event-command references", () => {
  test("collects progression, conditional, party, actor, and database references", () => {
    assert.deepEqual(signatures(referencesFor({ code: 121, parameters: [2, 4, 0] })), [
      "switches:2:list[0].parameters[0]",
    ]);
    assert.deepEqual(referencesFor({ code: 121, parameters: [2, 4, 0] })[0].endValue, 4);

    assert.deepEqual(signatures(referencesFor({ code: 122, parameters: [1, 1, 0, 1, 3] })), [
      "variables:1:list[0].parameters[0]",
      "variables:3:list[0].parameters[4]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 111, parameters: [4, 2, 3, 7] })), [
      "actors:2:list[0].parameters[1]",
      "skills:7:list[0].parameters[3]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 126, parameters: [5, 0, 1, 6] })), [
      "items:5:list[0].parameters[0]",
      "variables:6:list[0].parameters[3]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 318, parameters: [0, 2, 0, 7] })), [
      "actors:2:list[0].parameters[1]",
      "skills:7:list[0].parameters[3]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 321, parameters: [2, 4, false] })), [
      "actors:2:list[0].parameters[0]",
      "classes:4:list[0].parameters[1]",
    ]);
  });

  test("collects direct and variable movement operands plus move-route switches", () => {
    assert.deepEqual(signatures(referencesFor({ code: 201, parameters: [0, 3, 4, 5, 2, 0] })), [
      "maps:3:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 201, parameters: [1, 3, 4, 5, 2, 0] })), [
      "variables:3:list[0].parameters[1]",
      "variables:4:list[0].parameters[2]",
      "variables:5:list[0].parameters[3]",
    ]);

    const route = referencesFor({
      code: 205,
      parameters: [0, {
        list: [
          { code: 27, parameters: [8] },
          { code: 28, parameters: [9] },
          { code: 0, parameters: [] },
        ],
        repeat: false,
        skippable: false,
        wait: true,
      }],
    });
    assert.deepEqual(signatures(route), [
      "switches:8:list[0].parameters[1].list[0].parameters[0]",
      "switches:9:list[0].parameters[1].list[1].parameters[0]",
    ]);
  });

  test("collects scene, map, battle, and common-event references with original special values", () => {
    assert.deepEqual(signatures(referencesFor({ code: 117, parameters: [6] })), [
      "commonEvents:6:list[0].parameters[0]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 301, parameters: [0, 3, true, false] })), [
      "troops:3:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 302, parameters: [2, 5, 0, 0, false] })), [
      "armors:5:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 282, parameters: [4] })), [
      "tilesets:4:list[0].parameters[0]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 333, parameters: [-1, 0, 2] })), [
      "states:2:list[0].parameters[2]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 336, parameters: [0, 4] })), [
      "enemies:4:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 337, parameters: [-1, 3, false] })), [
      "animations:3:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 339, parameters: [0, 0, 7, -1] })), [
      "skills:7:list[0].parameters[2]",
    ]);
  });

  test("collects variable-selected actor targets and Force Action actor subjects", () => {
    assert.deepEqual(signatures(referencesFor({ code: 311, parameters: [1, 6, 0, 0, 10, false] })), [
      "variables:6:list[0].parameters[1]",
    ]);
    assert.deepEqual(signatures(referencesFor({ code: 339, parameters: [1, 4, 7, -1] })), [
      "actors:4:list[0].parameters[1]",
      "skills:7:list[0].parameters[2]",
    ]);

    const entireParty = referencesFor({ code: 311, parameters: [0, 0, 0, 0, 10, false] });
    assert.deepEqual(signatures(entireParty), ["actors:0:list[0].parameters[1]"]);
    assert.deepEqual(entireParty[0].specialValues, [0]);
  });

  test("does not misclassify a Force Action troop-member index as an enemy database id", () => {
    assert.deepEqual(signatures(referencesFor({ code: 339, parameters: [0, 4, 7, -1] })), [
      "skills:7:list[0].parameters[2]",
    ]);
  });

  test("does not infer references from Script or Plugin Command text", () => {
    assert.deepEqual(referencesFor({ code: 355, parameters: ["$gameTemp.reserveCommonEvent(99)"] }), []);
    assert.deepEqual(referencesFor({ code: 356, parameters: ["CallCommonEvent 99"] }), []);
  });
});
