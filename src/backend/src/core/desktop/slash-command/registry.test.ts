import { test } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, getSlashCommand } from "./registry.ts";

test("registry lists compact and help only", () => {
  const names = SLASH_COMMANDS.map((command) => command.name).sort();
  assert.deepEqual(names, ["compact", "help"]);
});

test("getSlashCommand returns null for unknown", () => {
  assert.equal(getSlashCommand("foo"), null);
});

test("getSlashCommand resolves hidden tokens command", () => {
  assert.equal(getSlashCommand("TOKENS")?.name, "tokens");
});
