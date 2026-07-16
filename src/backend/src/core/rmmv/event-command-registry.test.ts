import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EVENT_COMMAND_BLOCK_HEAD_CODES,
  EVENT_COMMAND_BLOCK_PAIRINGS,
  EVENT_COMMAND_CONTINUATION_CODES,
  MZ_EVENT_COMMAND_BLOCK_PAIRINGS,
  MZ_STANDARD_EVENT_COMMAND_CODES,
  MZ_STANDARD_EVENT_COMMAND_DEFINITIONS,
  STANDARD_EVENT_COMMAND_CODES,
  STANDARD_EVENT_COMMAND_DEFINITIONS,
  defaultEventCommandParameters,
  eventCommandDefinition,
  validateEventCommandBasic,
  validateEventCommandList,
} from "./event-command-registry.ts";

const EXPECTED_STANDARD_CODES = [
  101, 102, 103, 104, 105, 121, 122, 123, 124, 111, 112, 113, 115, 117, 118, 119, 108,
  125, 126, 127, 128, 129, 311, 312, 326, 313, 314, 315, 316, 317, 318, 319, 320, 321, 324, 325,
  201, 202, 203, 204, 205, 206, 211, 216, 217, 212, 213, 214, 231, 232, 233, 234, 235, 230,
  221, 222, 223, 224, 225, 236, 241, 242, 243, 244, 245, 246, 249, 250, 251, 261,
  301, 302, 303, 351, 352, 353, 354, 132, 133, 139, 140, 134, 135, 136, 137, 138, 322, 323,
  281, 282, 283, 284, 285, 331, 332, 342, 333, 334, 335, 336, 337, 339, 340, 355, 356
];

describe("RPG Maker MV event command registry", () => {
  test("covers the 105 standard event commands exactly once", () => {
    assert.equal(STANDARD_EVENT_COMMAND_DEFINITIONS.length, 105);
    assert.deepEqual(STANDARD_EVENT_COMMAND_CODES, EXPECTED_STANDARD_CODES);
    assert.equal(new Set(STANDARD_EVENT_COMMAND_CODES).size, 105);

    for (const definition of STANDARD_EVENT_COMMAND_DEFINITIONS) {
      assert.equal(eventCommandDefinition(definition.code), definition);
      assert.ok(definition.name.length > 0, `code ${definition.code} has a name`);
      assert.ok(definition.category.length > 0, `code ${definition.code} has a category`);
      assert.ok(Array.isArray(definition.parameters), `code ${definition.code} has parameter schema`);
      assert.ok(Array.isArray(definition.defaultParameters), `code ${definition.code} has default parameters`);
      assert.doesNotThrow(() => validateEventCommandBasic({
        code: definition.code,
        indent: 0,
        parameters: defaultEventCommandParameters(definition.code)
      }), `default parameters validate for code ${definition.code}`);
    }
  });

  test("records block, continuation, branch, and terminator metadata for key MV structures", () => {
    assert.deepEqual(EVENT_COMMAND_BLOCK_PAIRINGS[102], { continuations: [402, 403], terminator: 404 });
    assert.deepEqual(EVENT_COMMAND_BLOCK_PAIRINGS[111], { continuations: [411], terminator: 412 });
    assert.deepEqual(EVENT_COMMAND_BLOCK_PAIRINGS[112], { continuations: [], terminator: 413 });
    assert.deepEqual(EVENT_COMMAND_BLOCK_PAIRINGS[301], { continuations: [601, 602, 603], terminator: 604 });
    assert.deepEqual(EVENT_COMMAND_BLOCK_PAIRINGS[302], { continuations: [605] });

    for (const code of [102, 111, 112, 301, 302]) {
      assert.equal(EVENT_COMMAND_BLOCK_HEAD_CODES.has(code), true, `code ${code} is a block head`);
      assert.notEqual(eventCommandDefinition(code)?.block.kind, "none");
    }
    for (const code of [402, 403, 404, 411, 412, 413, 601, 602, 603, 604, 605]) {
      assert.equal(EVENT_COMMAND_CONTINUATION_CODES.has(code), true, `code ${code} is structural`);
      assert.ok(eventCommandDefinition(code), `structural code ${code} is registered`);
    }
  });

  test("rejects unknown event command codes and bad parameter shapes", () => {
    assert.throws(
      () => validateEventCommandBasic({ code: 999, indent: 0, parameters: [] }),
      /not a standard RPG Maker MV event command code/
    );
    assert.throws(
      () => validateEventCommandBasic({ code: 230, indent: 0, parameters: ["60"] }),
      /frames.*integer/
    );
    assert.throws(
      () => validateEventCommandBasic({ code: 205, indent: 0, parameters: [0, { list: [{ code: 46, parameters: [] }], repeat: true, skippable: false, wait: false }] }),
      /move route command code/
    );
  });

  test("accepts registered continuation commands with their MV parameter shape", () => {
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 401, indent: 1, parameters: ["line"] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 605, indent: 0, parameters: [0, 1, 0, 0] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 655, indent: 0, parameters: ["console.log('ok')"] }));
  });

  test("validates real conditional, timer, and actor-target parameter variants", () => {
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 111, indent: 0, parameters: [8, 1] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 111, indent: 0, parameters: [12, "true"] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 111, indent: 0, parameters: [4, 1, 0] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 111, indent: 0, parameters: [4, 1, 1, 2] }));
    assert.throws(
      () => validateEventCommandBasic({ code: 111, indent: 0, parameters: [8, 1, 0] }),
      /conditional branch type 8 must have 2 value/,
    );

    assert.doesNotThrow(() => validateEventCommandBasic({ code: 124, indent: 0, parameters: [0, 60] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 124, indent: 0, parameters: [1] }));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 124, indent: 0, parameters: [1, 0] }));
    assert.throws(
      () => validateEventCommandBasic({ code: 124, indent: 0, parameters: [0] }),
      /timer operation 0 must have 2 value/,
    );

    assert.doesNotThrow(() => validateEventCommandBasic({ code: 311, indent: 0, parameters: [0, 0, 0, 0, 1, false] }));
    assert.throws(
      () => validateEventCommandBasic({ code: 311, indent: 0, parameters: [1, 0, 0, 0, 1, false] }),
      /actorVariableId.*>= 1/,
    );
  });

  test("validates nested structured blocks, branches, continuations, and the final terminator", () => {
    assert.doesNotThrow(() => validateEventCommandList([
      { code: 102, indent: 0, parameters: [["Yes", "No"], -2, 0, 2, 0] },
      { code: 402, indent: 0, parameters: [0, "Yes"] },
      { code: 111, indent: 1, parameters: [0, 1, 0] },
      { code: 101, indent: 2, parameters: ["", 0, 0, 2] },
      { code: 401, indent: 2, parameters: ["Nested"] },
      { code: 411, indent: 1, parameters: [] },
      { code: 117, indent: 2, parameters: [1] },
      { code: 412, indent: 1, parameters: [] },
      { code: 403, indent: 0, parameters: [] },
      { code: 404, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ], "event.list"));
  });

  test("accepts optional battle branches and the preserved cancel-branch extension", () => {
    assert.doesNotThrow(() => validateEventCommandList([
      { code: 301, indent: 0, parameters: [0, 1, false, false] },
      { code: 250, indent: 0, parameters: [{ name: "", volume: 90, pitch: 100, pan: 0 }] },
      { code: 0, indent: 0, parameters: [] },
    ]));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 403, indent: 0, parameters: [0, null] }));
    assert.throws(
      () => validateEventCommandBasic({ code: 403, indent: 0, parameters: [0, "cancel"] }),
      /must be empty or \[integer, null\]/,
    );
  });

  test("rejects orphan structural commands, missing block terminators, and invalid indentation", () => {
    assert.throws(
      () => validateEventCommandList([
        { code: 401, indent: 0, parameters: ["orphan"] },
        { code: 0, indent: 0, parameters: [] },
      ]),
      /continuation code 401.*head code 101/,
    );
    assert.throws(
      () => validateEventCommandList([
        { code: 111, indent: 0, parameters: [0, 1, 0] },
        { code: 117, indent: 1, parameters: [1] },
        { code: 0, indent: 0, parameters: [] },
      ]),
      /code 111.*terminator code 412/,
    );
    assert.throws(
      () => validateEventCommandList([
        { code: 117, indent: 1, parameters: [1] },
        { code: 0, indent: 0, parameters: [] },
      ]),
      /indent 0/,
    );
    assert.doesNotThrow(
      () => validateEventCommandList([
        { code: 111, indent: 0, parameters: [8, 1] },
        { code: 0, indent: 1, parameters: [] },
        { code: 412, indent: 0, parameters: [] },
        { code: 0, indent: 0, parameters: [] },
      ]),
    );
    assert.throws(
      () => validateEventCommandList([
        { code: 111, indent: 0, parameters: [8, 1] },
        { code: 0, indent: 0, parameters: [] },
        { code: 412, indent: 0, parameters: [] },
        { code: 0, indent: 0, parameters: [] },
      ]),
      /internal code 0 must use indent 1/,
    );
  });
});

describe("RPG Maker MZ event command registry", () => {
  test("uses the MZ 1.10 command set and rejects MV-only plugin commands", () => {
    assert.equal(MZ_STANDARD_EVENT_COMMAND_DEFINITIONS.length, 106);
    assert.equal(MZ_STANDARD_EVENT_COMMAND_CODES.includes(109), true);
    assert.equal(MZ_STANDARD_EVENT_COMMAND_CODES.includes(356), false);
    assert.equal(MZ_STANDARD_EVENT_COMMAND_CODES.includes(357), true);
    assert.deepEqual(MZ_EVENT_COMMAND_BLOCK_PAIRINGS[357], { continuations: [657] });

    assert.doesNotThrow(() => validateEventCommandBasic({
      code: 357,
      indent: 0,
      parameters: ["SamplePlugin", "showNotice", "Show Notice", { message: "Hello" }]
    }, "eventCommand", "rpg-maker-mz"));
    assert.throws(
      () => validateEventCommandBasic({ code: 356, indent: 0, parameters: ["SamplePlugin showNotice"] }, "eventCommand", "rpg-maker-mz"),
      /not valid for RPG Maker MZ/
    );
  });

  test("validates MZ-specific parameter structures", () => {
    assert.deepEqual(defaultEventCommandParameters(101, "rpg-maker-mz"), ["", 0, 0, 2, ""]);
    assert.deepEqual(defaultEventCommandParameters(104, "rpg-maker-mz"), [1, 2]);
    assert.deepEqual(defaultEventCommandParameters(232, "rpg-maker-mz"), [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true, 0]);
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 104, indent: 0, parameters: [1, 4] }, "eventCommand", "rpg-maker-mz"));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 101, indent: 0, parameters: ["", 12, 0, 2, ""] }, "eventCommand", "rpg-maker-mz"));
    assert.throws(
      () => validateEventCommandBasic({ code: 104, indent: 0, parameters: [1, 0] }, "eventCommand", "rpg-maker-mz"),
      /itemType.*one of 1, 2, 3, 4/,
    );
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 285, indent: 0, parameters: [1, 6, 0, 0, 0] }, "eventCommand", "rpg-maker-mz"));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 337, indent: 0, parameters: [-1, 1] }, "eventCommand", "rpg-maker-mz"));
    assert.doesNotThrow(() => validateEventCommandBasic({ code: 337, indent: 0, parameters: [-1, 1, true] }, "eventCommand", "rpg-maker-mz"));
    assert.throws(
      () => validateEventCommandBasic({ code: 101, indent: 0, parameters: ["", 0, 0, 2] }, "eventCommand", "rpg-maker-mz"),
      /must have 5 value/
    );
  });

  test("validates structured MZ plugin command annotations", () => {
    assert.doesNotThrow(() => validateEventCommandList([
      { code: 357, indent: 0, parameters: ["SamplePlugin", "showNotice", "Show Notice", { message: "Hello" }] },
      { code: 657, indent: 0, parameters: ["message = Hello"] },
      { code: 0, indent: 0, parameters: [] }
    ], "event.list", "rpg-maker-mz"));
    assert.throws(() => validateEventCommandList([
      { code: 657, indent: 0, parameters: ["message = Hello"] },
      { code: 0, indent: 0, parameters: [] }
    ], "event.list", "rpg-maker-mz"), /requires head code 357/);
  });

  test("round-trips the MZ 1.10 skip block and rejects it for MV", () => {
    const skipBlock = [
      { code: 109, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["", 0, 0, 2, "Guide"] },
      { code: 401, indent: 1, parameters: ["Optional line"] },
      { code: 0, indent: 0, parameters: [] },
      { code: 117, indent: 0, parameters: [1] },
      { code: 0, indent: 0, parameters: [] },
    ];
    assert.doesNotThrow(() => validateEventCommandList(skipBlock, "event.list", "rpg-maker-mz"));
    assert.deepEqual(JSON.parse(JSON.stringify(skipBlock)), skipBlock);
    assert.throws(
      () => validateEventCommandList(skipBlock, "event.list", "rpg-maker-mv"),
      /not a standard RPG Maker MV event command code/,
    );
    assert.throws(() => validateEventCommandList([
      { code: 109, indent: 0, parameters: [] },
      { code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] },
      { code: 0, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ], "event.list", "rpg-maker-mz"), /must use indent 1/);
    assert.throws(() => validateEventCommandList([
      { code: 109, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["", 0, 0, 2, ""] },
      { code: 0, indent: 0, parameters: [] },
    ], "event.list", "rpg-maker-mz"), /requires terminator code 0 before end/);
  });
});
