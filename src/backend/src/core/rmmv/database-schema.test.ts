import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  STANDARD_RMMV_DATABASE_GROUPS,
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchema,
  getRmmvDatabaseSchemaByKey,
  listRmmvDatabaseSchemas,
  validateRmmvDatabaseEntry,
  type RmmvDatabaseGroup,
} from "./database-schema.ts";

describe("RMMV database schema registry", () => {
  test("covers every standard MV database group with schema, defaults, references, and validation", () => {
    const schemas = listRmmvDatabaseSchemas();
    assert.equal(schemas.length, 15);
    assert.deepEqual(schemas.map((schema) => schema.group), [...STANDARD_RMMV_DATABASE_GROUPS]);

    for (const schema of schemas) {
      assert.match(schema.fileName, /\.json$/);
      assert.equal(typeof schema.isArrayTable, "boolean");
      assert.ok(schema.coreFields.length > 0, `${schema.group} must declare core fields`);
      assert.ok(Array.isArray(schema.references), `${schema.group} must declare reference fields`);
      const entry = schema.createDefaultEntry(1);
      assert.equal(typeof entry, "object", `${schema.group} default entry must be an object`);
      assert.equal(schema.validate(entry).ok, true, `${schema.group} default entry must validate`);
    }
  });

  test("default factories keep real MV field names and document shapes", () => {
    const actor = createDefaultRmmvDatabaseEntry("Actors", 7);
    assert.equal(actor.id, 7);
    assert.deepEqual(Object.keys(actor).sort(), [
      "battlerName",
      "characterIndex",
      "characterName",
      "classId",
      "equips",
      "faceIndex",
      "faceName",
      "id",
      "initialLevel",
      "maxLevel",
      "name",
      "nickname",
      "note",
      "profile",
      "traits",
    ].sort());

    const skill = createDefaultRmmvDatabaseEntry("Skills", 3);
    assert.deepEqual(skill.damage, { type: 0, elementId: 0, formula: "0", variance: 20, critical: false });
    assert.ok(Array.isArray(skill.effects));

    const troop = createDefaultRmmvDatabaseEntry("Troops", 2);
    assert.ok(Array.isArray(troop.pages));
    assert.ok(Array.isArray(((troop.pages as unknown[])[0] as Record<string, unknown>).list));

    const tileset = createDefaultRmmvDatabaseEntry("Tilesets", 1);
    assert.equal((tileset.tilesetNames as unknown[]).length, 9);

    const system = createDefaultRmmvDatabaseEntry("System");
    assert.ok(system.terms && typeof system.terms === "object");
    assert.ok(Array.isArray(system.skillTypes));
    assert.ok(Array.isArray(system.weaponTypes));

    const terms = createDefaultRmmvDatabaseEntry("Terms");
    assert.ok(terms.messages && typeof terms.messages === "object");
    assert.ok(Array.isArray(terms.commands));
  });

  test("System, Types, and Terms are first-class registry groups backed by the real MV System.json shape", () => {
    assert.equal(getRmmvDatabaseSchema("System").fileName, "System.json");
    assert.equal(getRmmvDatabaseSchema("Types").fileName, "System.json");
    assert.equal(getRmmvDatabaseSchema("Terms").fileName, "System.json");
    assert.equal(getRmmvDatabaseSchemaByKey("system").group, "System");
    assert.equal(getRmmvDatabaseSchemaByKey("types").group, "Types");
    assert.equal(getRmmvDatabaseSchemaByKey("terms").group, "Terms");
  });

  test("validation fails fast for unknown groups and invalid entry ids", () => {
    assert.throws(() => getRmmvDatabaseSchema("MapInfos"), /Unknown RMMV database group/);
    assert.throws(() => getRmmvDatabaseSchemaByKey("bogus" as never), /Unknown RMMV database table/);

    const invalid = { ...createDefaultRmmvDatabaseEntry("Actors", 1), id: 0 };
    const result = validateRmmvDatabaseEntry("Actors", invalid);
    assert.equal(result.ok, false);
    assert.match(result.issues.map((issue) => issue.path).join(","), /id/);
  });

  test("Troops battle event pages validate MV command lists through the event command registry", () => {
    const troop = createDefaultRmmvDatabaseEntry("Troops", 2);
    const pages = troop.pages as Record<string, unknown>[];
    pages[0].list = [
      { code: 117, indent: 0, parameters: [1] },
      { code: 0, indent: 0, parameters: [] },
    ];
    assert.equal(validateRmmvDatabaseEntry("Troops", troop).ok, true);

    pages[0].list = [
      { code: 999, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const badCode = validateRmmvDatabaseEntry("Troops", troop);
    assert.equal(badCode.ok, false);
    assert.match(badCode.issues.map((issue) => `${issue.path} ${issue.message}`).join("\n"), /pages\[0\]\.list\[0\].*code 999 is not a standard RPG Maker MV event command code/);

    pages[0].list = [
      { code: 117, indent: 0, parameters: ["1"] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const badParams = validateRmmvDatabaseEntry("Troops", troop);
    assert.equal(badParams.ok, false);
    assert.match(badParams.issues.map((issue) => `${issue.path} ${issue.message}`).join("\n"), /pages\[0\]\.list\[0\].*parameters\[0\]/);

    pages[0].list = [
      { code: 117, indent: 0, parameters: [1] },
    ];
    const unterminated = validateRmmvDatabaseEntry("Troops", troop);
    assert.equal(unterminated.ok, false);
    assert.match(unterminated.issues.map((issue) => `${issue.path} ${issue.message}`).join("\n"), /pages\[0\]\.list.*end with code 0/);
  });

  test("every declared group can be looked up by group name", () => {
    for (const group of STANDARD_RMMV_DATABASE_GROUPS) {
      const schema = getRmmvDatabaseSchema(group);
      assert.equal(schema.group, group as RmmvDatabaseGroup);
    }
  });
});
