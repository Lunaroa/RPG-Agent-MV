import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EVENT_COMMAND_BLOCK_HEAD_CODES,
  EVENT_COMMAND_BLOCK_PAIRINGS,
  EVENT_COMMAND_CONTINUATION_CODES,
  STANDARD_EVENT_COMMAND_CODES,
  STANDARD_EVENT_COMMAND_DEFINITIONS,
  defaultEventCommandParameters,
  eventCommandDefinition,
  validateEventCommandBasic
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
});
