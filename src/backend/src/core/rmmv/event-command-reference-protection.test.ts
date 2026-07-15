import assert from "node:assert/strict";
import { test } from "node:test";

import { createDefaultRmmvDatabaseEntry } from "./database-schema.ts";
import {
  validateRmmvDatabaseTransition,
  type RmmvDatabaseMapDocument,
  type RmmvDatabaseSnapshot,
} from "./database-validation.ts";

function mapWithCommand(command: Record<string, unknown>): RmmvDatabaseMapDocument {
  return {
    mapId: 1,
    value: {
      tilesetId: 1,
      encounterList: [],
      events: [null, {
        id: 1,
        pages: [{
          list: [
            { indent: 0, ...command },
            { code: 0, indent: 0, parameters: [] },
          ],
        }],
      }],
    },
  };
}

test("database deletion protection keeps Force Action actor subjects live", () => {
  const actor = createDefaultRmmvDatabaseEntry("Actors", 1);
  const skill = createDefaultRmmvDatabaseEntry("Skills", 1);
  const before: RmmvDatabaseSnapshot = {
    actors: [null, actor],
    skills: [null, skill],
  };
  const after: RmmvDatabaseSnapshot = {
    ...before,
    actors: [null],
  };
  const result = validateRmmvDatabaseTransition(before, after, {
    maps: [mapWithCommand({ code: 339, parameters: [1, 1, 1, -1] })],
  });

  assert.ok(result.issues.some((issue) =>
    issue.code === "DB_REFERENCE_MISSING"
    && issue.source.path === "maps[1].events[1].pages[0].list[0].parameters[1]"
  ));
});

test("database deletion protection keeps variable-selected actor slots live", () => {
  const actor = createDefaultRmmvDatabaseEntry("Actors", 1);
  const beforeSystem = createDefaultRmmvDatabaseEntry("System");
  beforeSystem.variables = ["", "Actor Slot"];
  const afterSystem = structuredClone(beforeSystem);
  afterSystem.variables = [""];
  const snapshot: RmmvDatabaseSnapshot = {
    actors: [null, actor],
    system: beforeSystem,
  };
  const result = validateRmmvDatabaseTransition(snapshot, {
    ...snapshot,
    system: afterSystem,
  }, {
    maps: [mapWithCommand({ code: 311, parameters: [1, 1, 0, 0, 10, false] })],
  });

  assert.ok(result.issues.some((issue) =>
    issue.code === "DB_REFERENCE_MISSING"
    && issue.source.path === "maps[1].events[1].pages[0].list[0].parameters[1]"
  ));
});
