import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  buildOpencodeStaticConfig,
  ensureOpencodeRuntimeAssets,
} from "./runtime-assets.ts";
import {
  resolveOpencodeAgentsMdRuntime,
  resolveOpencodeAgentsMdSource,
  resolveOpencodeConfigDir,
} from "../../../workspace-paths.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function seedProductOpencode(root: string): void {
  const configDir = path.join(root, "config", "opencode");
  fs.mkdirSync(path.join(configDir, "instructions"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "skills", "demo-skill"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "AGENTS.md"), "# Agent rules\n", "utf8");
  fs.writeFileSync(path.join(configDir, "instructions", "personal-preferences.md"), "# Preferences\n", "utf8");
  fs.writeFileSync(path.join(configDir, "skills", "demo-skill", "SKILL.md"), "---\nname: demo\n---\n", "utf8");
}

test("ensureOpencodeRuntimeAssets copies AGENTS.md and writes static opencode.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-runtime-assets-"));
  roots.push(root);
  seedProductOpencode(root);

  ensureOpencodeRuntimeAssets(root, root);

  const runtimeAgents = resolveOpencodeAgentsMdRuntime(root);
  assert.equal(fs.readFileSync(runtimeAgents, "utf8"), "# Agent rules\n");
  assert.equal(
    fs.readFileSync(resolveOpencodeAgentsMdSource(root), "utf8"),
    fs.readFileSync(runtimeAgents, "utf8"),
  );

  const staticConfigPath = path.join(resolveOpencodeConfigDir(root), "opencode.json");
  const staticConfig = JSON.parse(fs.readFileSync(staticConfigPath, "utf8")) as {
    instructions: string[];
    skills: { paths: string[] };
  };
  assert.equal(staticConfig.instructions.length, 1);
  assert.match(staticConfig.instructions[0], /personal-preferences\.md$/);
  assert.equal(staticConfig.skills.paths.length, 1);
  assert.match(staticConfig.skills.paths[0], /config\/opencode\/skills$/);
});

test("buildOpencodeStaticConfig uses absolute paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-static-config-"));
  roots.push(root);
  seedProductOpencode(root);

  const config = buildOpencodeStaticConfig(root, root) as {
    instructions: string[];
    skills: { paths: string[] };
  };

  assert.equal(path.isAbsolute(config.instructions[0].replace(/\//g, path.sep)), true);
  assert.equal(path.isAbsolute(config.skills.paths[0].replace(/\//g, path.sep)), true);
});
