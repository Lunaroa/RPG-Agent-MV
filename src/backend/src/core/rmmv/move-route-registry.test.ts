import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MOVE_ROUTE_COMMAND_DEFINITIONS,
  STANDARD_MOVE_ROUTE_CODES,
  defaultMoveRouteParameters,
  moveRouteCommandDefinition,
  validateMoveRouteCommandBasic
} from "./move-route-registry.ts";

describe("RPG Maker MV move route registry", () => {
  test("covers move route codes 0 through 45 exactly once", () => {
    const expected = Array.from({ length: 46 }, (_value, index) => index);
    assert.deepEqual(STANDARD_MOVE_ROUTE_CODES, expected);
    assert.equal(MOVE_ROUTE_COMMAND_DEFINITIONS.length, 46);
    assert.equal(new Set(STANDARD_MOVE_ROUTE_CODES).size, 46);

    for (const definition of MOVE_ROUTE_COMMAND_DEFINITIONS) {
      assert.equal(moveRouteCommandDefinition(definition.code), definition);
      assert.ok(definition.name.length > 0, `route code ${definition.code} has a name`);
      assert.ok(Array.isArray(definition.parameters), `route code ${definition.code} has parameter schema`);
      assert.ok(Array.isArray(definition.defaultParameters), `route code ${definition.code} has default parameters`);
      assert.doesNotThrow(() => validateMoveRouteCommandBasic({
        code: definition.code,
        parameters: defaultMoveRouteParameters(definition.code)
      }), `default parameters validate for route code ${definition.code}`);
    }
  });

  test("keeps real parameter shapes for route commands with arguments", () => {
    assert.deepEqual(moveRouteCommandDefinition(14)?.parameters.map((parameter) => parameter.name), ["x", "y"]);
    assert.deepEqual(moveRouteCommandDefinition(41)?.parameters.map((parameter) => parameter.name), ["characterName", "characterIndex"]);
    assert.deepEqual(moveRouteCommandDefinition(44)?.parameters.map((parameter) => parameter.name), ["se"]);
    assert.deepEqual(moveRouteCommandDefinition(45)?.parameters.map((parameter) => parameter.name), ["script"]);
  });

  test("accepts omitted parameters only for parameterless route commands", () => {
    assert.doesNotThrow(() => validateMoveRouteCommandBasic({ code: 0 }));
    assert.doesNotThrow(() => validateMoveRouteCommandBasic({ code: 37 }));
    assert.throws(
      () => validateMoveRouteCommandBasic({ code: 15 }),
      /must have 1 value/,
    );
  });

  test("rejects unknown route codes and bad route parameters", () => {
    assert.throws(
      () => validateMoveRouteCommandBasic({ code: 46, parameters: [] }),
      /not a standard RPG Maker MV move route command code/
    );
    assert.throws(
      () => validateMoveRouteCommandBasic({ code: 15, parameters: ["60"] }),
      /frames.*integer/
    );
    assert.throws(
      () => validateMoveRouteCommandBasic({ code: 44, parameters: [{ name: "Move1", volume: 90, pitch: "100", pan: 0 }] }),
      /pitch.*number/
    );
  });
});
