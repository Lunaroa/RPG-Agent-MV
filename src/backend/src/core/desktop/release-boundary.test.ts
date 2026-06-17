import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  filterReleaseFiles,
  inspectElectronPackageArtifact,
  inspectSourceReleaseContent,
  inspectWebPackageArtifact,
} from "./release-boundary.ts";

test("release manifest excludes local runtime, projects, credentials and private assets", () => {
  const manifest = filterReleaseFiles([
    "README.md",
    ".env",
    ".env.example",
    "runtime/README.md",
    "runtime/sessions/a/session-meta.json",
    ".opencode/opencode.db",
    "config/opencode/AGENTS.md",
    "config/opencode/rules/runtime-policy.md",
    "config/opencode/skills/jrpg-story-writing/SKILL.md",
    "config/opencode/skills/skill-creator/SKILL.md",
    "config/opencode/skills/skill-creator/scripts/init_skill.py",
    "projects/README.md",
    "projects/private-game/data/System.json",
    "runtime/secrets/token.json",
    "node_modules/pkg/index.js",
    "secrets/token.txt",
    "third_party/claude-code/src/index.ts",
    "third_party/claude-code/dist/cli-node.js",
    "third_party/claude-code/node_modules/pkg/index.js",
    "third_party/opencode/packages/opencode/package.json",
    "config/provider-presets/legacy.json",
    "config/provider-seeds/providers.json",
    "data/assets/skill-library/index.json",
    "data/rmmv.db",
    "data/.gitkeep",
    "www/save/file1.rpgsave",
    "game/Game.rpgproject",
    "game/www/data/System.json",
    "game/www/js/rpg_core.js",
  ]);

  assert.deepEqual(manifest.files, [
    "README.md",
    "config/opencode/AGENTS.md",
    "config/opencode/rules/runtime-policy.md",
    "config/opencode/skills/jrpg-story-writing/SKILL.md",
    "config/opencode/skills/skill-creator/SKILL.md",
    "config/opencode/skills/skill-creator/scripts/init_skill.py",
    "config/provider-seeds/providers.json",
    "data/.gitkeep",
    "projects/README.md",
    "runtime/README.md",
    "third_party/opencode/packages/opencode/package.json",
  ]);
  assert.deepEqual(manifest.excluded.map((entry) => entry.path), [
    ".env",
    ".env.example",
    ".opencode/opencode.db",
    "config/provider-presets/legacy.json",
    "data/assets/skill-library/index.json",
    "data/rmmv.db",
    "game/Game.rpgproject",
    "game/www/data/System.json",
    "game/www/js/rpg_core.js",
    "node_modules/pkg/index.js",
    "projects/private-game/data/System.json",
    "runtime/secrets/token.json",
    "runtime/sessions/a/session-meta.json",
    "secrets/token.txt",
    "third_party/claude-code/dist/cli-node.js",
    "third_party/claude-code/node_modules/pkg/index.js",
    "third_party/claude-code/src/index.ts",
    "www/save/file1.rpgsave",
  ]);
  assert.equal(manifest.scope.kind, "source");
  assert.deepEqual(manifest.issues, []);
});

test("source release content scan blocks internal development context", () => {
  const root = makeTempRoot();
  writeText(root, "docs/leak.md", `不要读 ${"\u006d\u0065\u0074\u0061 \u7814\u53d1\u4ed3"}。\n`);
  writeText(root, "src/rules.ts", `const note = '${"\u5916\u5c42\u5f00\u53d1\u8005"}规则';\n`);
  writeText(root, "data/schema.json", `{"$id":"https://example.local/${["rmmv-agent", "workflow"].join("-")}/x.json"}\n`);
  writeText(root, ".gitignore", "." + "ai/\n");
  writeText(root, "src/path-comment.ts", `// ${["Meta", "repo", "layout"].join(" ")}\n`);
  writeText(root, "src/parent-comment.ts", `// ${["parent", "workspace"].join(" ")}\n`);
  writeText(root, "README.md", `当前以${"\u4ea7\u54c1\u7814\u53d1"}为主，面向${"\u5185\u90e8\u5f00\u53d1\u8005"}。\n`);
  writeText(root, "src/model-roles.ts", `// opencode ${"\u5185\u90e8"}模型角色，${["side", "Query"].join("")} 调用。\n`);
  writeText(root, "src/cwd-comment.ts", `// ${"\u5185\u5c42"} agent 不应读${"\u6784\u5efa\u672c\u5de5\u4f5c\u6d41\u7684\u4ed3\u5e93"}。\n`);

  const issues = inspectSourceReleaseContent(root, [
    "docs/leak.md",
    "src/rules.ts",
    "data/schema.json",
    ".gitignore",
    "src/path-comment.ts",
    "src/parent-comment.ts",
    "README.md",
    "src/model-roles.ts",
    "src/cwd-comment.ts",
  ]);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "blocker");
  assert.equal(issues[0].code, "source-internal-context-exposure");
  assert.equal(issues[0].evidence?.some((entry) => entry.includes("docs/leak.md:1")), true);
  assert.equal(issues[0].evidence?.some((entry) => entry.includes(".gitignore:1")), true);
});

test("source release content scan allows normal meta identifiers", () => {
  const root = makeTempRoot();
  writeText(root, "src/component.ts", "const metadata = import.meta.url; if (event.metaKey) return;\n");
  writeText(root, "docs/readme.md", "Package metadata is checked before release.\n");

  const issues = inspectSourceReleaseContent(root, [
    "src/component.ts",
    "docs/readme.md",
  ]);

  assert.deepEqual(issues, []);
});

test("web package proof accepts a static dist entry with local assets only", () => {
  const root = makeTempRoot();
  const dist = path.join(root, "src", "ui", "desktop", "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">', "utf8");
  fs.writeFileSync(path.join(dist, "assets", "index.js"), "console.log('ok');\n", "utf8");
  fs.writeFileSync(path.join(dist, "assets", "index.css"), "body{}\n", "utf8");

  const result = inspectWebPackageArtifact(root);

  assert.equal(result.status, "proven");
  assert.deepEqual(result.forbidden, []);
  assert.deepEqual(result.files, [
    "assets/index.css",
    "assets/index.js",
    "index.html",
  ]);
  assert.equal(result.issues.length, 0);
});

test("web package proof blocks forbidden local-only directories in dist", () => {
  const root = makeTempRoot();
  const dist = path.join(root, "src", "ui", "desktop", "dist");
  fs.mkdirSync(path.join(dist, "runtime", "secrets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<main></main>", "utf8");
  fs.writeFileSync(path.join(dist, "runtime", "secrets", "token.json"), "{}", "utf8");

  const result = inspectWebPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "web-artifact-forbidden-files"), true);
  assert.deepEqual(result.forbidden.map((entry) => entry.path), ["runtime/secrets/token.json"]);
});

test("web package proof blocks an index that references missing static files", () => {
  const root = makeTempRoot();
  const dist = path.join(root, "src", "ui", "desktop", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), '<script type="module" src="/assets/missing.js"></script>', "utf8");

  const result = inspectWebPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "web-static-reference-missing"), true);
});

test("electron package proof blocks when no real packaging chain is configured", () => {
  const root = makeTempRoot();
  const desktop = path.join(root, "src", "ui", "desktop");
  fs.mkdirSync(desktop, { recursive: true });
  fs.writeFileSync(path.join(desktop, "package.json"), JSON.stringify({
    scripts: { dev: "vite", build: "vue-tsc -b && vite build", preview: "vite preview" },
    devDependencies: { electron: "^42.3.0", vite: "^8.0.12" },
  }), "utf8");

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-package-chain-missing"), true);
});

test("electron package proof accepts a real unpacked Electron directory package", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "proven");
  assert.equal(result.root, packageRoot);
  assert.deepEqual(result.forbidden, []);
  assert.equal(result.files.includes("Agent RPG MV.exe"), true);
  assert.equal(result.files.includes("resources/app/package.json"), true);
  assert.equal(result.files.includes("resources/app/src/ui/desktop/dist/index.html"), true);
  assert.equal(result.files.includes("resources/app/src/backend/src/cli.ts"), true);
  assert.equal(result.files.includes("resources/app/config/provider-seeds/providers.json"), true);
  assert.equal(result.files.includes("resources/app/config/opencode/AGENTS.md"), true);
  assert.equal(result.files.includes("resources/app/config/opencode/rules/runtime-policy.md"), true);
  assert.equal(result.files.includes("resources/app/config/opencode/skills/skill-creator/SKILL.md"), true);
  assert.equal(result.files.includes("resources/opencode/opencode.exe"), true);
  assert.equal(result.files.some((rel) => rel.startsWith("resources/app/node_modules/claude-code-best/")), false);
  assert.equal(result.files.includes("resources/app/node_modules/@opencode-ai/sdk/package.json"), true);
  assert.equal(result.files.includes("resources/app/node_modules/cross-spawn/package.json"), true);
  assert.equal(result.files.includes("resources/app/src/backend/node_modules/@modelcontextprotocol/sdk/package.json"), true);
  assert.equal(result.files.includes("resources/app/src/backend/node_modules/zod/package.json"), true);
  assert.equal(result.issues.some((issue) => issue.severity === "blocker"), false);
  assert.equal(result.issues.some((issue) => issue.code === "electron-dir-package-only"), true);
});

test("electron package proof blocks missing packaged opencode binary", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  fs.rmSync(path.join(packageRoot, "resources", "opencode", "opencode.exe"), { force: true });

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-required-file-missing"), true);
  assert.equal(result.issues.some((issue) => issue.evidence?.includes("resources/opencode/opencode.exe")), true);
});

test("electron package proof blocks missing bundled ripgrep", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  fs.rmSync(path.join(packageRoot, "resources", "opencode", "rg.exe"), { force: true });

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-required-file-missing"), true);
  assert.equal(result.issues.some((issue) => issue.evidence?.includes("resources/opencode/rg.exe")), true);
});

test("electron package proof blocks missing provider seed database", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  fs.rmSync(path.join(packageRoot, "resources", "app", "config", "provider-seeds", "providers.json"), { force: true });

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-required-file-missing"), true);
  assert.equal(result.issues.some((issue) => issue.evidence?.includes("resources/app/config/provider-seeds/providers.json")), true);
});

test("electron package proof blocks stale packaged build output", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  writeText(root, "src/ui/desktop/dist-electron/main.js", "ensureProviderSeedsInitialized();\n");
  const oldTime = new Date("2026-06-16T12:00:00.000Z");
  const newTime = new Date("2026-06-16T12:01:00.000Z");
  fs.utimesSync(path.join(packageRoot, "resources", "app", "src", "ui", "desktop", "dist-electron", "main.js"), oldTime, oldTime);
  fs.utimesSync(path.join(root, "src", "ui", "desktop", "dist-electron", "main.js"), newTime, newTime);

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-artifact-stale"), true);
});

test("electron package proof blocks bundled legacy CCB runtime dependency", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  const agentRuntimeFile = path.join(
    packageRoot,
    "resources",
    "app",
    "third_party",
    "claude-code",
    "dist",
    "cli-node.js",
  );
  fs.mkdirSync(path.dirname(agentRuntimeFile), { recursive: true });
  fs.writeFileSync(agentRuntimeFile, "console.log('ok');\n", "utf8");

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-artifact-forbidden-files"), true);
  assert.equal(result.forbidden.some((entry) => entry.path === "resources/app/third_party/claude-code/dist/cli-node.js"), true);
});

test("electron package proof accepts a configured installer artifact while keeping inspectable dir output", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root, {
    builder: {
      appId: "dev.agent-rpg-mv.desktop",
      icon: "src/ui/desktop/build/icon.ico",
      win: {
        target: [
          { target: "dir", arch: ["x64"] },
          { target: "nsis", arch: ["x64"] },
        ],
      },
    },
  });
  createElectronPackageArtifact(root);
  createElectronInstallerArtifact(root);

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "proven");
  assert.equal(result.issues.some((issue) => issue.code === "electron-dir-package-only"), false);
  assert.equal(result.issues.some((issue) => issue.code === "electron-installer-artifact-missing"), false);
  assert.equal(result.evidence.some((entry) => entry.includes("Electron dir target is configured")), true);
  assert.equal(result.evidence.some((entry) => entry.includes("Electron installer target configured: nsis")), true);
  assert.equal(result.evidence.some((entry) => entry.includes("Agent RPG MV Setup 0.1.0.exe")), true);
});

test("electron package proof blocks a configured installer target with no installer artifact", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root, {
    builder: {
      appId: "dev.agent-rpg-mv.desktop",
      icon: "src/ui/desktop/build/icon.ico",
      win: {
        target: [
          { target: "dir", arch: ["x64"] },
          { target: "nsis", arch: ["x64"] },
        ],
      },
    },
  });
  createElectronPackageArtifact(root);

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-installer-artifact-missing"), true);
});

test("electron package proof blocks unexpected CCB package contents", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const packageRoot = createElectronPackageArtifact(root);
  const unexpectedPackage = path.join(
    packageRoot,
    "resources",
    "app",
    "node_modules",
    "claude-code-best",
    "src",
    "index.js",
  );
  fs.mkdirSync(path.dirname(unexpectedPackage), { recursive: true });
  fs.writeFileSync(unexpectedPackage, "export {};\n", "utf8");

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-artifact-forbidden-files"), true);
  assert.equal(result.forbidden.some((entry) => entry.path === "resources/app/node_modules/claude-code-best/src/index.js"), true);
});

test("electron package proof blocks public release metadata holes", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root, {
    appPackage: { name: "agent-rpg-mv" },
    builder: {
      appId: "local.agent-rpg-mv",
      asar: false,
      win: { target: [{ target: "dir", arch: ["x64"] }] },
    },
  });
  createElectronPackageArtifact(root);

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-package-author-missing"), true);
  assert.equal(result.issues.some((issue) => issue.code === "electron-app-id-public-release-blocker"), true);
  assert.equal(result.issues.some((issue) => issue.code === "electron-icon-missing"), true);
  assert.equal(result.issues.some((issue) => issue.code === "electron-asar-disabled"), true);
});

test("electron package proof blocks forbidden local-only files in the packaged app", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  createElectronPackageArtifact(root);
  const forbiddenDir = path.join(root, "runtime", "out", "release", "electron", "win-unpacked", "resources", "app", "projects", "PrivateGame", "www", "data");
  fs.mkdirSync(forbiddenDir, { recursive: true });
  fs.writeFileSync(path.join(forbiddenDir, "System.json"), "{}", "utf8");

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-artifact-forbidden-files"), true);
  assert.equal(result.forbidden.some((entry) => entry.path === "resources/app/projects/PrivateGame/www/data/System.json"), true);
});

test("electron package proof blocks package output that is not an inspectable app directory", () => {
  const root = makeTempRoot();
  writeElectronBuilderMetadata(root);
  const output = path.join(root, "runtime", "out", "release", "electron");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "builder-debug.yml"), "debug: true\n", "utf8");

  const result = inspectElectronPackageArtifact(root);

  assert.equal(result.status, "blocked");
  assert.equal(result.issues.some((issue) => issue.code === "electron-app-package-missing"), true);
});

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpg-release-"));
}

function writeText(root: string, rel: string, content: string): void {
  const filePath = path.join(root, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeElectronBuilderMetadata(root: string, options: {
  appPackage?: Record<string, unknown>;
  builder?: Record<string, unknown>;
} = {}): void {
  const desktop = path.join(root, "src", "ui", "desktop");
  fs.mkdirSync(desktop, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(options.appPackage || {
    name: "agent-rpg-mv",
    author: "Agent RPG MV contributors",
  }), "utf8");
  fs.writeFileSync(path.join(desktop, "package.json"), JSON.stringify({
    scripts: {
      dev: "vite",
      build: "vue-tsc -b && vite build",
      package: "electron-builder --config electron-builder.json --win --x64",
      "package:build": "npm run build && npm run package",
    },
    devDependencies: {
      electron: "^42.3.0",
      "electron-builder": "^26.15.3",
      vite: "^8.0.12",
    },
  }), "utf8");
  const iconDir = path.join(root, "src", "ui", "desktop", "build");
  fs.mkdirSync(iconDir, { recursive: true });
  fs.writeFileSync(path.join(iconDir, "icon.ico"), "ico", "utf8");
  fs.writeFileSync(path.join(desktop, "electron-builder.json"), JSON.stringify(options.builder || {
    appId: "dev.agent-rpg-mv.desktop",
    icon: "src/ui/desktop/build/icon.ico",
    win: { target: [{ target: "dir", arch: ["x64"] }] },
  }), "utf8");
}

function createElectronPackageArtifact(root: string): string {
  const packageRoot = path.join(root, "runtime", "out", "release", "electron", "win-unpacked");
  const appRoot = path.join(packageRoot, "resources", "app");
  const opencodeRoot = path.join(packageRoot, "resources", "opencode");
  const appNodeModulesRoot = path.join(appRoot, "node_modules");
  fs.mkdirSync(path.join(appRoot, "src", "ui", "desktop", "dist"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "ui", "desktop", "dist", "assets"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "ui", "desktop", "dist-electron"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "backend", "src"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "backend", "node_modules", "ajv", "dist", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "backend", "node_modules", "@modelcontextprotocol", "sdk"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "backend", "node_modules", "zod"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "src", "contract"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "config", "agents"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "config", "opencode", "rules"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "config", "opencode", "instructions"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "config", "opencode", "skills", "skill-creator"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "config", "provider-seeds"), { recursive: true });
  fs.mkdirSync(opencodeRoot, { recursive: true });
  for (const dependency of [
    path.join("@opencode-ai", "sdk"),
    "cross-spawn",
    "path-key",
    "shebang-command",
    "shebang-regex",
    "which",
    "isexe",
  ]) {
    fs.mkdirSync(path.join(appNodeModulesRoot, dependency), { recursive: true });
  }
  fs.writeFileSync(path.join(packageRoot, "Agent RPG MV.exe"), "exe", "utf8");
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({
    name: "agent-rpg-mv",
    type: "module",
    main: "src/ui/desktop/dist-electron/main.js",
  }), "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "ui", "desktop", "dist", "index.html"), "<main></main>", "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "ui", "desktop", "dist", "assets", "index.js"), "window.addEventListener('pointerdown',()=>{});\n", "utf8");
  fs.writeFileSync(
    path.join(appRoot, "src", "ui", "desktop", "dist-electron", "main.js"),
    "import 'electron';\nensureProviderSeedsInitialized();\nipc.handle('storyPages:initializeOriginalWithGitBaseline', () => {});\n",
    "utf8",
  );
  fs.writeFileSync(path.join(appRoot, "src", "backend", "src", "cli.ts"), "export {};\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "backend", "node_modules", "ajv", "dist", "runtime", "equal.js"), "export {};\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "backend", "node_modules", "@modelcontextprotocol", "sdk", "package.json"), JSON.stringify({
    name: "@modelcontextprotocol/sdk",
    version: "1.29.0",
  }), "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "backend", "node_modules", "zod", "package.json"), JSON.stringify({
    name: "zod",
    version: "4.4.3",
  }), "utf8");
  fs.writeFileSync(path.join(appRoot, "src", "contract", "types.ts"), "export {};\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "AGENTS.md"), "# Agent rules\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "agents", "registry.yaml"), "agents: []\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "opencode", "AGENTS.md"), "# Agent rules\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "opencode", "instructions", "personal-preferences.md"), "# Preferences\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "opencode", "rules", "runtime-policy.md"), "# Rules\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "opencode", "skills", "skill-creator", "SKILL.md"), "---\nname: skill-creator\n---\n", "utf8");
  fs.writeFileSync(path.join(appRoot, "config", "provider-seeds", "providers.json"), JSON.stringify({
    version: 1,
    providers: [{ id: "seed", label: "Seed", protocol: "anthropic", baseUrl: "https://example.invalid" }],
  }), "utf8");
  fs.writeFileSync(path.join(opencodeRoot, "opencode.exe"), "binary", "utf8");
  fs.writeFileSync(path.join(opencodeRoot, "rg.exe"), "binary", "utf8");
  fs.writeFileSync(path.join(opencodeRoot, "LICENSE"), "MIT\n", "utf8");
  fs.writeFileSync(path.join(opencodeRoot, "RPG_AGENT_VENDOR.json"), JSON.stringify({ sourceTag: "v1.17.7" }), "utf8");
  writePackageJson(appNodeModulesRoot, path.join("@opencode-ai", "sdk"), "1.17.7");
  writePackageJson(appNodeModulesRoot, "cross-spawn", "7.0.6");
  writePackageJson(appNodeModulesRoot, "path-key", "3.1.1");
  writePackageJson(appNodeModulesRoot, "shebang-command", "2.0.0");
  writePackageJson(appNodeModulesRoot, "shebang-regex", "3.0.0");
  writePackageJson(appNodeModulesRoot, "which", "2.0.2");
  writePackageJson(appNodeModulesRoot, "isexe", "2.0.0");
  return packageRoot;
}

function createElectronInstallerArtifact(root: string): void {
  const output = path.join(root, "runtime", "out", "release", "electron");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "Agent RPG MV Setup 0.1.0.exe"), "installer", "utf8");
}

function writePackageJson(nodeModulesRoot: string, dependency: string, version: string): void {
  fs.writeFileSync(path.join(nodeModulesRoot, dependency, "package.json"), JSON.stringify({
    name: dependency.replace(/\\/g, "/"),
    version,
  }), "utf8");
}
