import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentPatchSpec } from "./patcher.ts";

test("validateAgentPatchSpec rejects add-map-event", () => {
  assert.throws(
    () => validateAgentPatchSpec({
      engine: "rpg-maker-mv",
      operations: [{ op: "add-map-event", mapId: 1, name: "Stub", x: 0, y: 0, pages: [{ commands: [] }] }],
    }),
    /refused structural operations.*add-map-event/,
  );
});

test("validateAgentPatchSpec allows command-level ops", () => {
  assert.doesNotThrow(() => validateAgentPatchSpec({
    engine: "rpg-maker-mv",
    operations: [{
      op: "replace-event-command",
      mapId: 1,
      eventId: 1,
      pageIndex: 0,
      commandIndex: 0,
      command: { code: 401, indent: 1, parameters: ["hello"] },
    }],
  }));
});

test("validateAgentPatchSpec rejects mixed structural and command ops", () => {
  assert.throws(
    () => validateAgentPatchSpec({
      engine: "rpg-maker-mv",
      operations: [
        { op: "patch-event-page", mapId: 1, eventId: 1, pageIndex: 0, commands: [] },
        { op: "set-map-tiles", mapId: 1, layer: 0, x: 0, y: 0, tiles: [1] },
      ],
    }),
    /set-map-tiles/,
  );
});
