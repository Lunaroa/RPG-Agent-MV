import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolveInstallRoot,
  resolveOpencodeAgentsMdRuntime,
  resolveOpencodeAgentsMdSource,
  resolveOpencodeConfigDir,
  resolveOpencodeCli,
  resolveOpencodeRipgrep,
  resolveOpencodeSkillsDir,
  resolveOpencodeSkillsSourceDir,
  resolveUserDataRoot,
} from "./workspace-paths.ts";

const WORKFLOW_ROOT = path.resolve("/tmp/app-root");

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("opencode executable defaults to the runtime built from vendored source", () => {
  withEnv({ AGENT_RPG_OPENCODE_BIN: undefined, AGENT_RPG_RESOURCES_PATH: undefined }, () => {
    const expected = path.join(WORKFLOW_ROOT, "runtime", "out", "opencode", "windows-x64", "opencode.exe");
    assert.equal(resolveOpencodeCli(WORKFLOW_ROOT), expected);
  });
});

test("packaged resources can provide the opencode executable", () => {
  const resourcesPath = path.resolve("/tmp/app-resources");
  withEnv({ AGENT_RPG_OPENCODE_BIN: undefined, AGENT_RPG_RESOURCES_PATH: resourcesPath }, () => {
    const expected = process.platform === "win32"
      ? path.join(resourcesPath, "opencode", "opencode.exe")
      : path.join(resourcesPath, "opencode", "opencode");
    assert.equal(resolveOpencodeCli(WORKFLOW_ROOT), expected);
  });
});

test("explicit opencode binary env wins over source and packaged paths", () => {
  const explicit = path.resolve("/tmp/custom/opencode.exe");
  withEnv({ AGENT_RPG_OPENCODE_BIN: explicit }, () => {
    assert.equal(resolveOpencodeCli(WORKFLOW_ROOT), explicit);
  });
});

test("bundled ripgrep defaults next to the runtime opencode binary", () => {
  withEnv({ AGENT_RPG_RIPGREP_BIN: undefined, AGENT_RPG_RESOURCES_PATH: undefined }, () => {
    const expected = process.platform === "win32"
      ? path.join(WORKFLOW_ROOT, "runtime", "out", "opencode", "windows-x64", "rg.exe")
      : path.join(WORKFLOW_ROOT, "runtime", "out", "opencode", "windows-x64", "rg");
    assert.equal(resolveOpencodeRipgrep(WORKFLOW_ROOT), expected);
  });
});

test("packaged resources provide the bundled ripgrep next to opencode", () => {
  const resourcesPath = path.resolve("/tmp/app-resources");
  withEnv({ AGENT_RPG_RIPGREP_BIN: undefined, AGENT_RPG_RESOURCES_PATH: resourcesPath }, () => {
    const expected = process.platform === "win32"
      ? path.join(resourcesPath, "opencode", "rg.exe")
      : path.join(resourcesPath, "opencode", "rg");
    assert.equal(resolveOpencodeRipgrep(WORKFLOW_ROOT), expected);
  });
});

test("explicit ripgrep binary env wins over source and packaged paths", () => {
  const explicit = path.resolve("/tmp/custom/rg.exe");
  withEnv({ AGENT_RPG_RIPGREP_BIN: explicit, AGENT_RPG_RESOURCES_PATH: path.resolve("/tmp/app-resources") }, () => {
    assert.equal(resolveOpencodeRipgrep(WORKFLOW_ROOT), explicit);
  });
});

test("opencode config and skills stay product anchored", () => {
  assert.equal(resolveOpencodeConfigDir(WORKFLOW_ROOT), path.join(WORKFLOW_ROOT, ".opencode"));
  assert.equal(resolveOpencodeAgentsMdSource(WORKFLOW_ROOT), path.join(WORKFLOW_ROOT, "config", "opencode", "AGENTS.md"));
  assert.equal(resolveOpencodeAgentsMdRuntime(WORKFLOW_ROOT), path.join(WORKFLOW_ROOT, ".opencode", "AGENTS.md"));
  assert.equal(resolveOpencodeSkillsSourceDir(WORKFLOW_ROOT), path.join(WORKFLOW_ROOT, "config", "opencode", "skills"));
  assert.equal(resolveOpencodeSkillsDir(WORKFLOW_ROOT), path.join(WORKFLOW_ROOT, ".opencode", "skills"));
});

test("packaged install and user data roots split via env", () => {
  const install = path.resolve("/tmp/app-install");
  const userData = path.resolve("/tmp/app-userdata");
  withEnv({
    AGENT_RPG_INSTALL_ROOT: install,
    AGENT_RPG_ROOT: userData,
    AGENT_RPG_OPENCODE_BIN: undefined,
    AGENT_RPG_RESOURCES_PATH: undefined,
  }, () => {
    assert.equal(resolveInstallRoot(), install);
    assert.equal(resolveUserDataRoot(), userData);
    assert.equal(
      resolveOpencodeAgentsMdSource(userData),
      path.join(install, "config", "opencode", "AGENTS.md"),
    );
    assert.equal(resolveOpencodeConfigDir(userData), path.join(userData, ".opencode"));
  });
});
