import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { resolveAgentProjectBinding, sameAgentProjectIdentity } from "./agent-project-binding.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test("keeps no-project and invalid-project bindings explicit", () => {
  const none = resolveAgentProjectBinding(null, { version: 1 });
  assert.equal(none.status, "none");
  assert.equal(none.canonicalPath, null);

  const missing = path.join(os.tmpdir(), `missing-project-${Date.now()}`);
  const invalid = resolveAgentProjectBinding(missing, { version: 2 });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.errorCode, "project-invalid");
  assert.equal(invalid.runtimeAvailable, false);
});

test("binds a source-only project and resolves an external runtime without requiring Game.exe", () => {
  const project = createSourceProject();
  const runtimeExecutable = path.join(path.dirname(project), "runtime", "Game.exe");
  fs.mkdirSync(path.dirname(runtimeExecutable), { recursive: true });
  fs.writeFileSync(runtimeExecutable, "runner", "utf8");
  const binding = resolveAgentProjectBinding(project, {
    version: 3,
    resolveRuntime: (_project, engine) => ({
      runtime: {
        engine,
        executable: runtimeExecutable,
        runtimeRoot: path.dirname(runtimeExecutable),
        source: "configured",
        launchStyle: "external",
        evidenceExecutable: "validated-configured-runtime",
        privateExecutable: runtimeExecutable,
      },
    }),
  });
  assert.equal(binding.status, "bound");
  assert.equal(binding.editable, true);
  assert.equal(binding.runnableStructure, false);
  assert.equal(binding.runtimeAvailable, true);
  assert.equal(binding.runtimeSource, "configured");
  assert.equal(sameAgentProjectIdentity(binding, { ...binding, canonicalPath: path.normalize(project) }), true);
});

function createSourceProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-project-binding-"));
  roots.push(root);
  const project = path.join(root, "projects", "source-project");
  const data = path.join(project, "www", "data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(project, "Game.rpgproject"), "RPGMV 1.6.2", "utf8");
  fs.writeFileSync(path.join(data, "System.json"), JSON.stringify({
    gameTitle: "Example Game",
    startMapId: 1,
    startX: 0,
    startY: 0,
  }), "utf8");
  fs.writeFileSync(path.join(data, "MapInfos.json"), JSON.stringify([null, { id: 1, name: "Example Map" }]), "utf8");
  fs.writeFileSync(path.join(data, "Map001.json"), JSON.stringify({ width: 10, height: 10, data: [], events: [null] }), "utf8");
  return project;
}
