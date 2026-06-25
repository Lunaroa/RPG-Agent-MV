import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { bootstrapDatabase } from "./bootstrap.ts";
import { closeDatabase } from "./pool.ts";
import { ConsoleSettingsDao } from "./dao/console-settings-dao.ts";
import {
  ensureUserDataLayout,
  USER_DATA_LAYOUT_MARKER,
} from "../desktop/user-data-layout.ts";
import {
  PATHS,
  resolveOpencodeConfigDir,
} from "../workspace-paths.ts";

const roots: string[] = [];

afterEach(() => {
  closeDatabase();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.AGENT_RPG_INSTALL_ROOT;
  delete process.env.AGENT_RPG_ROOT;
});

function seedProductOpencode(root: string): void {
  fs.mkdirSync(path.join(root, "config", "agents"), { recursive: true });
  const configDir = path.join(root, "config", "opencode");
  fs.mkdirSync(path.join(configDir, "instructions"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "skills", "demo-skill"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "agents", "registry.yaml"), "agents: []\n", "utf8");
  fs.writeFileSync(path.join(configDir, "AGENTS.md"), "# Agent rules\n", "utf8");
  fs.writeFileSync(path.join(configDir, "instructions", "personal-preferences.md"), "# Preferences\n", "utf8");
  fs.writeFileSync(path.join(configDir, "skills", "demo-skill", "SKILL.md"), "---\nname: demo\n---\n", "utf8");
}

function makeDualRootFixture(): { install: string; user: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-upgrade-"));
  roots.push(base);
  const install = path.join(base, "install");
  const user = path.join(base, "user");
  fs.mkdirSync(install, { recursive: true });
  fs.mkdirSync(user, { recursive: true });
  seedProductOpencode(install);
  return { install, user };
}

test("upgrade layout moves legacy install user data into userData and bootstrap preserves it", async () => {
  const { install, user } = makeDualRootFixture();

  await bootstrapDatabase(install);
  ConsoleSettingsDao.set("workspace", { lastProjectPath: "/tmp/project-fixture" });
  closeDatabase();

  fs.mkdirSync(path.join(install, ".opencode", "memory", "main"), { recursive: true });
  fs.writeFileSync(path.join(install, ".opencode", "memory", "main", "USER.md"), "# profile\n", "utf8");
  fs.mkdirSync(path.join(install, "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(install, "runtime", "project-registry.json"),
    JSON.stringify({ projects: [{ path: "/tmp/project-fixture", name: "demo" }] }),
    "utf8",
  );

  process.env.AGENT_RPG_INSTALL_ROOT = install;
  process.env.AGENT_RPG_ROOT = user;

  const firstLayout = ensureUserDataLayout(install, user);
  assert.ok(firstLayout.migrated.includes("data/rmmv.db"));
  assert.ok(firstLayout.migrated.includes(".opencode"));
  assert.ok(firstLayout.migrated.includes("runtime"));
  assert.equal(fs.existsSync(path.join(install, PATHS.dataDb)), false);
  assert.equal(fs.existsSync(path.join(user, PATHS.dataDb)), true);
  assert.equal(fs.existsSync(path.join(install, ".opencode")), false);
  assert.equal(
    fs.readFileSync(path.join(user, ".opencode", "memory", "main", "USER.md"), "utf8"),
    "# profile\n",
  );

  const secondLayout = ensureUserDataLayout(install, user);
  assert.equal(secondLayout.skipped, true);
  assert.deepEqual(secondLayout.migrated, []);

  await bootstrapDatabase(user);
  const workspace = ConsoleSettingsDao.get("workspace") as { lastProjectPath?: string };
  assert.equal(workspace.lastProjectPath, "/tmp/project-fixture");
  assert.equal(
    fs.readFileSync(path.join(user, "runtime", "project-registry.json"), "utf8").includes("demo"),
    true,
  );

  await bootstrapDatabase(user);
  const workspaceAgain = ConsoleSettingsDao.get("workspace") as { lastProjectPath?: string };
  assert.equal(workspaceAgain.lastProjectPath, "/tmp/project-fixture");
  assert.equal(fs.existsSync(path.join(user, USER_DATA_LAYOUT_MARKER)), true);
  assert.equal(fs.existsSync(resolveOpencodeConfigDir(user)), true);
});
