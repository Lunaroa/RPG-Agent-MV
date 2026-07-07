import { test } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, getSlashCommand } from "./registry.ts";

test("registry contains compact tokens help", () => {
  const names = SLASH_COMMANDS.map((command) => command.name).sort();
  assert.deepEqual(names, ["compact", "help", "tokens"]);
});

test("getSlashCommand returns null for unknown", () => {
  assert.equal(getSlashCommand("foo"), null);
});

test("getSlashCommand is case insensitive", () => {
  assert.equal(getSlashCommand("TOKENS")?.name, "tokens");
});
