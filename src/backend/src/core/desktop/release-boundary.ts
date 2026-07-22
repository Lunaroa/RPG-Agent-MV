import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { allStaleTerminalMenuTextMarkers } from "./releaseBoundaryLocalization.ts";

export interface ReleaseManifest {
  files: string[];
  excluded: { path: string; reason: string }[];
  issues: ReleaseBoundaryIssue[];
  scope: ReleaseBoundaryScope;
}

export interface ReleaseSourceResult extends ReleaseManifest {
  targetDir: string;
  manifestPath: string;
}

export interface ReleaseBoundaryIssue {
  severity: "blocker" | "warning" | "info";
  code: string;
  message: string;
  evidence?: string[];
}

export interface ReleaseBoundaryScope {
  kind: "source";
  proves: string[];
  notProven: string[];
}

export interface ReleasePackageCheckResult {
  source: ReleaseManifest;
  web: ReleaseArtifactCheck;
  electron: ReleaseArtifactCheck;
  issues: ReleaseBoundaryIssue[];
}

export interface ReleaseArtifactCheck {
  kind: "web" | "electron";
  status: "proven" | "blocked";
  root: string | null;
  files: string[];
  forbidden: { path: string; reason: string }[];
  issues: ReleaseBoundaryIssue[];
  evidence: string[];
}

interface DesktopPackageMetadata {
  path: string;
  exists: boolean;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
}

interface PackageJsonMetadata {
  author?: unknown;
}

interface ElectronBuilderMetadata {
  appId?: unknown;
  asar?: unknown;
  icon?: unknown;
  directories?: {
    app?: unknown;
    buildResources?: unknown;
    output?: unknown;
  };
  win?: {
    icon?: unknown;
    target?: unknown;
  };
}

const RELEASE_ROOT = path.join("runtime", "out", "release", "source");
const RELEASE_DIR_NAME = "RPG-Agent-MV";
const EMPTY_RELEASE_DIRS = ["runtime", "projects"] as const;
const SOURCE_RELEASE_SCOPE: ReleaseBoundaryScope = {
  kind: "source",
  proves: [
    "source release file list",
    "local runtime state exclusion",
    "local RMMV project exclusion",
    "dependency and build-output exclusion",
  ],
  notProven: [
    "Electron installer packaging",
    "Web deployment packaging",
    "user-configured Agent runner packaging",
  ],
};

const SOURCE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".yaml",
  ".yml",
]);
const SOURCE_TEXT_BASENAMES = new Set([
  ".gitignore",
  "package-lock.json",
  "package.json",
]);
const INTERNAL_CONTEXT_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: "forbidden legacy identifier", pattern: new RegExp(["rmmv-agent", "workflow"].join("-"), "i") },
  {
    label: "forbidden private context",
    pattern: new RegExp([
      "\\u7814\\u53d1\\u5c42",
      "\\u7814\\u53d1\\u4ed3",
      "\\u4ea7\\u54c1\\u7814\\u53d1",
      "\\u5185\\u90e8\\u7814\\u53d1",
      "\\u5185\\u90e8\\u5f00\\u53d1\\u8005",
      "opencode\\s*\\u5185\\u90e8",
      "meta\\s*\\u7814\\u53d1\\u4ed3",
      "meta\\s*\\u5c42",
      "meta\\s*\\u4ed3",
      "\\bmeta\\s+(?:repo|layer)\\b",
    ].join("|"), "i"),
  },
  {
    label: "forbidden external rule wording",
    pattern: new RegExp([
      "\\u5916\\u5c42\\u5f00\\u53d1\\u8005",
      "\\u5916\\u5c42\\u89c4\\u5219",
      "\\u5de5\\u4f5c\\u6d41\\u6e90\\u7801",
      "\\u7236\\u7ea7\\u5de5\\u4f5c\\u533a",
      "\\u672c\\u673a\\u5386\\u53f2\\u6863\\u6848",
      "\\u65e7\\u4ed3\\u5e93\\u540d",
      "\\u6784\\u5efa\\u672c\\u5de5\\u4f5c\\u6d41\\u7684\\u4ed3\\u5e93",
      "\\u5185\\u5c42\\s*agent",
      "parent\\s+(?:workspace|repo)",
      "workspace\\s+source",
      ["side", "Query"].join(""),
    ].join("|"), "i"),
  },
  { label: "local AI workspace path", pattern: new RegExp("(^|[^A-Za-z0-9_-])\\.ai[\\\\/]") },
];

const EXCLUDE_RULES: readonly { test: (rel: string) => boolean; reason: string }[] = [
  { test: (rel) => rel === ".env" || rel.startsWith(".env."), reason: "local environment file" },
  {
    test: (rel) => rel.startsWith("runtime/") && rel !== "runtime/README.md",
    reason: "runtime state is local-only",
  },
  { test: (rel) => rel === ".opencode" || rel.startsWith(".opencode/"), reason: "opencode runtime state is local-only" },
  { test: (rel) => rel.startsWith("projects/") && rel !== "projects/README.md", reason: "RMMV projects are local-only" },
  { test: (rel) => hasPathSegment(rel, "secrets"), reason: "local secrets are not releasable" },
  { test: (rel) => hasPathSegment(rel, "save"), reason: "RMMV save data is local-only" },
  { test: isRmmvProjectMarker, reason: "RMMV game project files are local-only" },
  { test: (rel) => rel === "node_modules" || rel.startsWith("node_modules/") || rel.includes("/node_modules/"), reason: "dependencies must be installed during build" },
  { test: (rel) => rel.startsWith("data/assets/"), reason: "data/assets are private assets" },
  { test: (rel) => rel.startsWith("data/rmmv.db") || /^data\/.*\.(db|sqlite)(\.|$)/.test(rel), reason: "local database state" },
  { test: (rel) => rel.startsWith("config/provider-presets/"), reason: "legacy provider presets are not used by this product" },
  // Anti-regression: opencode is the only Agent runtime; legacy CCB trees must never ship in source releases.
  { test: (rel) => rel.startsWith("third_party/claude-code/"), reason: "legacy CCB (Claude Code Best) source must not ship — runtime is opencode-only" },
  { test: (rel) => rel.endsWith(".tsbuildinfo"), reason: "build cache" },
  { test: (rel) => rel === "dist" || rel.startsWith("dist/") || rel.includes("/dist/"), reason: "build output" },
  { test: (rel) => rel === "dist-electron" || rel.startsWith("dist-electron/") || rel.includes("/dist-electron/"), reason: "build output" },
  { test: (rel) => rel === ".git" || rel.includes("/.git/"), reason: "embedded git metadata" },
];

function isForbiddenPackagedNodeModule(rel: string): boolean {
  if (rel.startsWith("resources/app/node_modules/@opencode-ai/")) return false;
  if (rel.startsWith("resources/app/node_modules/cross-spawn/")) return false;
  if (rel.startsWith("resources/app/node_modules/path-key/")) return false;
  if (rel.startsWith("resources/app/node_modules/shebang-command/")) return false;
  if (rel.startsWith("resources/app/node_modules/shebang-regex/")) return false;
  if (rel.startsWith("resources/app/node_modules/which/")) return false;
  if (rel.startsWith("resources/app/node_modules/isexe/")) return false;
  if (rel.startsWith("resources/app/src/backend/node_modules/")) return false;
  return rel === "node_modules" || rel.startsWith("node_modules/") || rel.includes("/node_modules/");
}

const PACKAGE_FORBIDDEN_RULES: readonly { test: (rel: string) => boolean; reason: string }[] = [
  {
    test: (rel) => hasPathSegment(rel, "runtime") && !rel.startsWith("resources/app/src/backend/node_modules/"),
    reason: "runtime state is local-only",
  },
  {
    test: (rel) => rel === "resources/app/projects" || rel.startsWith("resources/app/projects/"),
    reason: "RMMV projects are local-only",
  },
  { test: (rel) => hasPathSegment(rel, "secrets"), reason: "local secrets are not releasable" },
  { test: (rel) => hasPathSegment(rel, "save"), reason: "RMMV save data is local-only" },
  { test: isRmmvProjectMarker, reason: "RMMV game project files are local-only" },
  // Anti-regression: packaged Electron apps must not resurrect CCB vendored trees or npm packages.
  { test: (rel) => rel.startsWith("resources/app/third_party/claude-code/"), reason: "legacy CCB (Claude Code Best) source must not ship — runtime is opencode-only" },
  { test: (rel) => rel === "resources/app/.opencode" || rel.startsWith("resources/app/.opencode/"), reason: "opencode runtime state is local-only" },
  { test: (rel) => rel.startsWith("resources/app/node_modules/claude-code-best/") || rel === "resources/app/node_modules/claude-code-best", reason: "legacy CCB (claude-code-best) package must not ship — runtime is opencode-only" },
  { test: isForbiddenPackagedNodeModule, reason: "dependencies must be installed by the package builder" },
  { test: (rel) => rel === ".git" || rel.includes("/.git/"), reason: "embedded git metadata" },
];

export function filterReleaseFiles(files: string[]): ReleaseManifest {
  const manifest: ReleaseManifest = { files: [], excluded: [], issues: [], scope: SOURCE_RELEASE_SCOPE };
  for (const raw of files) {
    const rel = normalizeReleasePath(raw);
    if (!rel) continue;
    const excluded = EXCLUDE_RULES.find((rule) => rule.test(rel));
    if (excluded) {
      manifest.excluded.push({ path: rel, reason: excluded.reason });
    } else {
      manifest.files.push(rel);
    }
  }
  manifest.files.sort();
  manifest.excluded.sort((a, b) => a.path.localeCompare(b.path));
  return manifest;
}

export function buildReleaseManifest(workflowRoot: string): ReleaseManifest {
  const root = path.resolve(workflowRoot);
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."], {
    cwd: root,
    encoding: "utf8",
  });
  const productPrefix = `${path.basename(root).replace(/\\/g, "/")}/`;
  const files = output
    .split(/\r?\n/)
      .map((raw) => normalizeGitReleasePath(raw, productPrefix))
    .filter((rel) => rel && isExistingReleaseFile(root, rel));
  const manifest = filterReleaseFiles(files);
  manifest.issues.push(...inspectSourceReleaseScope(root));
  manifest.issues.push(...inspectSourceReleaseContent(root, manifest.files));
  return manifest;
}

export function inspectSourceReleaseContent(root: string, files: string[]): ReleaseBoundaryIssue[] {
  const evidence: string[] = [];
  for (const rel of files) {
    if (rel.startsWith("third_party/opencode/")) continue;
    if (!isScannableSourceText(rel)) continue;
    const filePath = path.join(root, rel);
    if (!isPathInside(root, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const content = readTextForReleaseScan(filePath);
    if (content === null) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const item of INTERNAL_CONTEXT_PATTERNS) {
        item.pattern.lastIndex = 0;
        if (!item.pattern.test(line)) continue;
        evidence.push(`${rel}:${index + 1}: ${item.label}`);
        break;
      }
      if (evidence.length >= 20) break;
    }
    if (evidence.length >= 20) break;
  }

  if (evidence.length === 0) return [];
  return [{
    severity: "blocker",
    code: "source-internal-context-exposure",
    message: "Source release contains internal development context or old workspace identifiers.",
    evidence,
  }];
}

export function createReleaseSourceTree(workflowRoot: string): ReleaseSourceResult {
  const root = path.resolve(workflowRoot);
  const manifest = buildReleaseManifest(root);
  const releaseRoot = path.join(root, RELEASE_ROOT);
  const targetDir = path.join(releaseRoot, RELEASE_DIR_NAME);
  const manifestPath = path.join(releaseRoot, "source-manifest.json");

  assertSafeReleaseTarget(root, releaseRoot, targetDir);
  fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const relDir of EMPTY_RELEASE_DIRS) {
    fs.mkdirSync(path.join(targetDir, relDir), { recursive: true });
  }

  for (const rel of manifest.files) {
    const source = path.join(root, rel);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const destination = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceRoot: root,
    targetDir,
    files: manifest.files,
    excluded: manifest.excluded,
    emptyDirectories: [...EMPTY_RELEASE_DIRS],
  }, null, 2) + "\n", "utf8");

  return { ...manifest, targetDir, manifestPath };
}

export function checkReleasePackages(workflowRoot: string): ReleasePackageCheckResult {
  const root = path.resolve(workflowRoot);
  const source = buildReleaseManifest(root);
  const web = inspectWebPackageArtifact(root);
  const electron = inspectElectronPackageArtifact(root);
  const sourceIssues = source.issues.filter((issue) => issue.code !== "source-release-only");
  return {
    source,
    web,
    electron,
    issues: [
      ...sourceIssues,
      ...web.issues,
      ...electron.issues,
    ],
  };
}

export function inspectWebPackageArtifact(workflowRoot: string): ReleaseArtifactCheck {
  const root = path.resolve(workflowRoot);
  const distRoot = path.join(root, "src", "ui", "desktop", "dist");
  const check = createArtifactCheck("web", distRoot);
  if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) {
    addArtifactIssue(check, "blocker", "web-dist-missing", "Web dist was not found; run the desktop Vite build before release check.", [
      "missing src/ui/desktop/dist",
    ]);
    return finalizeArtifactCheck(check);
  }

  check.files = listArtifactFiles(distRoot);
  check.evidence.push(`${check.files.length} file(s) scanned under src/ui/desktop/dist`);
  collectForbiddenArtifactFiles(check);

  if (!check.files.includes("index.html")) {
    addArtifactIssue(check, "blocker", "web-index-missing", "Web dist is missing index.html, so it cannot be served as a static entry.", [
      "missing src/ui/desktop/dist/index.html",
    ]);
  } else {
    check.evidence.push("index.html exists");
    for (const missing of findMissingStaticReferences(distRoot, check.files)) {
      addArtifactIssue(check, "blocker", "web-static-reference-missing", "Web dist index.html references a file that is not present in dist.", [
        missing,
      ]);
    }
  }

  if (!check.issues.some((issue) => issue.severity === "blocker")) {
    check.evidence.push("index.html references only files present in dist");
    check.evidence.push("no runtime/projects/secrets/save/node_modules or RMMV project marker files found in dist");
  }
  return finalizeArtifactCheck(check);
}

export function inspectElectronPackageArtifact(workflowRoot: string): ReleaseArtifactCheck {
  const root = path.resolve(workflowRoot);
  const desktopDir = path.join(root, "src", "ui", "desktop");
  const check = createArtifactCheck("electron", null);
  const metadata = readDesktopPackageMetadata(root);
  if (!metadata.exists) {
    addArtifactIssue(check, "blocker", "electron-package-metadata-missing", "Electron package metadata was not found.", [
      "missing src/ui/desktop/package.json",
    ]);
    return finalizeArtifactCheck(check);
  }

  const packagerDependency = findElectronPackagerDependency(metadata.dependencies);
  const packageScript = findElectronPackageScript(metadata.scripts);
  if (!packagerDependency || !packageScript) {
    const evidence = [];
    if (!packagerDependency) {
      evidence.push("no electron-builder, electron-packager or Electron Forge dependency is configured");
    }
    if (!packageScript) {
      evidence.push("no dist/package/make script is configured in src/ui/desktop/package.json");
    }
    addArtifactIssue(check, "blocker", "electron-package-chain-missing", "Electron installer/package proof is not available because the project has no real packaging chain.", evidence);
    return finalizeArtifactCheck(check);
  }

  check.evidence.push(`${packagerDependency} dependency configured`);
  check.evidence.push(`${packageScript} package script configured`);
  const artifactRoot = findElectronArtifactRoot(root, desktopDir);
  if (!artifactRoot) {
    addArtifactIssue(check, "blocker", "electron-artifact-missing", "Electron packaging metadata exists, but no package output directory was found to inspect.", [
      "checked runtime/out/release/electron, src/ui/desktop/release and src/ui/desktop/out",
    ]);
    return finalizeArtifactCheck(check);
  }

  check.root = artifactRoot;
  check.evidence.push(`artifact root: ${artifactRoot}`);
  check.files = listArtifactFiles(artifactRoot);
  check.evidence.push(`${check.files.length} file(s) scanned under ${path.relative(root, artifactRoot).replace(/\\/g, "/")}`);
  collectForbiddenArtifactFiles(check);
  inspectElectronArtifactStructure(check, artifactRoot);
  inspectElectronArtifactContentMarkers(check, artifactRoot);
  inspectElectronArtifactFreshness(check, root, artifactRoot);
  inspectElectronReleaseHardening(check, root);
  if (!check.issues.some((issue) => issue.severity === "blocker")) {
    check.evidence.push("no runtime/projects/secrets/save/node_modules or RMMV project marker files found in Electron artifact");
  }
  return finalizeArtifactCheck(check);
}

function createArtifactCheck(kind: ReleaseArtifactCheck["kind"], root: string | null): ReleaseArtifactCheck {
  return {
    kind,
    status: "blocked",
    root,
    files: [],
    forbidden: [],
    issues: [],
    evidence: root ? [`artifact root: ${root}`] : [],
  };
}

function finalizeArtifactCheck(check: ReleaseArtifactCheck): ReleaseArtifactCheck {
  check.status = check.issues.some((issue) => issue.severity === "blocker") ? "blocked" : "proven";
  check.files.sort();
  check.forbidden.sort((a, b) => a.path.localeCompare(b.path));
  return check;
}

function addArtifactIssue(
  check: ReleaseArtifactCheck,
  severity: ReleaseBoundaryIssue["severity"],
  code: string,
  message: string,
  evidence?: string[],
): void {
  check.issues.push({ severity, code, message, evidence });
}

function collectForbiddenArtifactFiles(check: ReleaseArtifactCheck): void {
  for (const rel of check.files) {
    const forbidden = PACKAGE_FORBIDDEN_RULES.find((rule) => rule.test(rel));
    if (forbidden) check.forbidden.push({ path: rel, reason: forbidden.reason });
  }
  if (check.forbidden.length > 0) {
    addArtifactIssue(
      check,
      "blocker",
      `${check.kind}-artifact-forbidden-files`,
      `${check.kind} artifact contains local-only or unreleasable files.`,
      check.forbidden.slice(0, 20).map((entry) => `${entry.path}: ${entry.reason}`),
    );
  }
}

function listArtifactFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const rel = path.relative(root, absolute).replace(/\\/g, "/");
        const normalized = normalizeReleasePath(rel);
        if (normalized) result.push(normalized);
      }
    }
  };
  visit(root);
  result.sort();
  return result;
}

function findMissingStaticReferences(distRoot: string, files: string[]): string[] {
  const indexPath = path.join(distRoot, "index.html");
  const content = fs.readFileSync(indexPath, "utf8");
  const fileSet = new Set(files);
  const missing: string[] = [];
  for (const match of content.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1]?.trim();
    if (!value || shouldIgnoreStaticReference(value)) continue;
    const normalized = normalizeStaticReference(value);
    if (normalized && !fileSet.has(normalized)) missing.push(value);
  }
  return [...new Set(missing)].sort();
}

function shouldIgnoreStaticReference(value: string): boolean {
  return value.startsWith("#")
    || value.startsWith("data:")
    || value.startsWith("http://")
    || value.startsWith("https://")
    || value.startsWith("mailto:")
    || value.startsWith("tel:");
}

function normalizeStaticReference(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] || "";
  return normalizeReleasePath(withoutQuery.replace(/^\//, "").replace(/^\.\//, ""));
}

function readDesktopPackageMetadata(root: string): DesktopPackageMetadata {
  const packagePath = path.join(root, "src", "ui", "desktop", "package.json");
  if (!fs.existsSync(packagePath)) {
    return { path: packagePath, exists: false, scripts: {}, dependencies: {} };
  }
  const raw = fs.readFileSync(packagePath, "utf8");
  const packageJson = JSON.parse(raw) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    path: packagePath,
    exists: true,
    scripts: packageJson.scripts || {},
    dependencies: {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    },
  };
}

function findElectronPackagerDependency(dependencies: Record<string, string>): string | null {
  for (const name of ["electron-builder", "electron-packager", "@electron-forge/cli"]) {
    if (dependencies[name]) return name;
  }
  return null;
}

function findElectronPackageScript(scripts: Record<string, string>): string | null {
  return Object.keys(scripts).find((name) => /^(dist|package|make)$/.test(name)) || null;
}

function inspectElectronArtifactStructure(check: ReleaseArtifactCheck, artifactRoot: string): void {
  const files = new Set(check.files);
  const appPackageRel = "resources/app/package.json";
  const appAsarRel = "resources/app.asar";

  if (files.has(appAsarRel) && !files.has(appPackageRel)) {
    addArtifactIssue(check, "blocker", "electron-app-asar-not-inspectable", "Electron package uses app.asar, so release-check cannot inspect the app file boundary.", [
      appAsarRel,
    ]);
    return;
  }

  if (!files.has(appPackageRel)) {
    addArtifactIssue(check, "blocker", "electron-app-package-missing", "Electron artifact is missing resources/app/package.json.", [
      appPackageRel,
    ]);
    return;
  }

  const appPackagePath = path.join(artifactRoot, appPackageRel);
  const appPackage = JSON.parse(fs.readFileSync(appPackagePath, "utf8")) as { main?: string; type?: string };
  const mainRel = normalizeReleasePath(`resources/app/${String(appPackage.main || "")}`);
  if (!appPackage.main || !mainRel || !files.has(mainRel)) {
    addArtifactIssue(check, "blocker", "electron-app-main-missing", "Electron artifact package.json points to a missing main process entry.", [
      appPackage.main ? `missing ${mainRel}` : "missing package.json main",
    ]);
  } else {
    check.evidence.push(`Electron main entry exists: ${mainRel}`);
  }
  if (appPackage.type !== "module") {
    addArtifactIssue(check, "blocker", "electron-app-type-module-missing", "Electron main build is ESM, but packaged app metadata does not set type=module.", [
      `${appPackageRel} type=${String(appPackage.type || "(missing)")}`,
    ]);
  }

  const requiredAppFiles = [
    "resources/app/src/ui/desktop/dist/index.html",
    "resources/app/src/ui/desktop/dist-electron/main.js",
    "resources/app/src/backend/src/cli.ts",
    "resources/app/src/contract/types.ts",
    "resources/app/config/agents/registry.yaml",
    "resources/app/config/opencode/AGENTS.md",
    "resources/app/config/opencode/instructions/personal-preferences.md",
    "resources/app/config/opencode/rules/runtime-policy.md",
    "resources/app/config/opencode/skills/skill-creator/SKILL.md",
    "resources/app/config/provider-seeds/providers.json",
    "resources/opencode/opencode.exe",
    "resources/opencode/rg.exe",
    "resources/opencode/LICENSE",
    "resources/opencode/RPG_AGENT_VENDOR.json",
    "resources/app/node_modules/@opencode-ai/sdk/package.json",
    "resources/app/node_modules/cross-spawn/package.json",
    "resources/app/node_modules/path-key/package.json",
    "resources/app/node_modules/shebang-command/package.json",
    "resources/app/node_modules/shebang-regex/package.json",
    "resources/app/node_modules/which/package.json",
    "resources/app/node_modules/isexe/package.json",
    "resources/app/src/backend/node_modules/@modelcontextprotocol/sdk/package.json",
    "resources/app/src/backend/node_modules/sharp/package.json",
    "resources/app/src/backend/node_modules/@img/sharp-win32-x64/package.json",
    "resources/app/src/backend/node_modules/@img/sharp-win32-x64/lib/libvips-42.dll",
    "resources/app/src/backend/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node",
    "resources/app/src/backend/node_modules/zod/package.json",
  ];
  for (const rel of requiredAppFiles) {
    if (!files.has(rel)) {
      addArtifactIssue(check, "blocker", "electron-required-file-missing", "Electron artifact is missing a required RPG-Agent-MV runtime file.", [
        rel,
      ]);
    }
  }

  if (!hasElectronExecutable(files)) {
    addArtifactIssue(check, "blocker", "electron-executable-missing", "Electron artifact does not contain a platform launcher executable.", [
      "expected a top-level Windows .exe, or a macOS .app launcher",
    ]);
  } else {
    check.evidence.push("Electron platform launcher exists");
  }
}

function inspectElectronArtifactContentMarkers(check: ReleaseArtifactCheck, artifactRoot: string): void {
  const mainRel = "resources/app/src/ui/desktop/dist-electron/main.js";
  const mainContent = readPackagedTextFile(artifactRoot, mainRel);
  if (mainContent !== null) {
    const requiredMainMarkers = [
      "ensureProviderSeedsInitialized",
      "storyPages:initializeOriginalWithGitBaseline",
    ];
    for (const marker of requiredMainMarkers) {
      if (!mainContent.includes(marker)) {
        addArtifactIssue(check, "blocker", "electron-packaged-main-stale", "Electron packaged main process is missing a current release marker.", [
          `${mainRel} missing ${marker}`,
        ]);
      }
    }
    if (requiredMainMarkers.every((marker) => mainContent.includes(marker))) {
      check.evidence.push("Electron packaged main process contains current provider and Git-baseline markers");
    }
  }

  const providerSeedsRel = "resources/app/config/provider-seeds/providers.json";
  const providerSeedsContent = readPackagedTextFile(artifactRoot, providerSeedsRel);
  if (providerSeedsContent !== null) {
    try {
      const parsed = JSON.parse(providerSeedsContent) as { providers?: unknown };
      if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
        addArtifactIssue(check, "blocker", "electron-provider-seeds-empty", "Packaged provider seed database is empty or invalid.", [
          providerSeedsRel,
        ]);
      } else {
        check.evidence.push(`provider seed database packaged with ${parsed.providers.length} provider(s)`);
      }
    } catch (error) {
      addArtifactIssue(check, "blocker", "electron-provider-seeds-invalid", "Packaged provider seed database is not valid JSON.", [
        `${providerSeedsRel}: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  const staleFrontendEvidence = allStaleTerminalMenuTextMarkers().flatMap((needle) =>
    findPackagedFrontendAssetText(artifactRoot, needle),
  );
  if (staleFrontendEvidence.length > 0) {
    addArtifactIssue(check, "blocker", "electron-packaged-web-stale", "Electron packaged frontend still contains removed terminal menu text.", staleFrontendEvidence);
  }
}

function inspectElectronArtifactFreshness(
  check: ReleaseArtifactCheck,
  workflowRoot: string,
  artifactRoot: string,
): void {
  const pairs = [
    {
      source: "src/ui/desktop/dist-electron/main.js",
      packaged: "resources/app/src/ui/desktop/dist-electron/main.js",
    },
    {
      source: "src/ui/desktop/dist/index.html",
      packaged: "resources/app/src/ui/desktop/dist/index.html",
    },
  ];
  for (const pair of pairs) {
    const sourcePath = path.join(workflowRoot, pair.source);
    const packagedPath = path.join(artifactRoot, pair.packaged);
    if (!fs.existsSync(sourcePath) || !fs.existsSync(packagedPath)) continue;
    const sourceStat = fs.statSync(sourcePath);
    const packagedStat = fs.statSync(packagedPath);
    if (sourceStat.mtimeMs - packagedStat.mtimeMs > 1000) {
      addArtifactIssue(check, "blocker", "electron-artifact-stale", "Electron package output is older than the current build output; rebuild before release.", [
        `${pair.source} ${sourceStat.mtime.toISOString()}`,
        `${pair.packaged} ${packagedStat.mtime.toISOString()}`,
      ]);
    }
  }
}

function readPackagedTextFile(artifactRoot: string, rel: string): string | null {
  const filePath = path.join(artifactRoot, rel);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > 5_000_000) return null;
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function findPackagedFrontendAssetText(artifactRoot: string, needle: string): string[] {
  const assetsRoot = path.join(artifactRoot, "resources", "app", "src", "ui", "desktop", "dist", "assets");
  if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) return [];
  const evidence: string[] = [];
  for (const entry of fs.readdirSync(assetsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:js|css|html)$/i.test(entry.name)) continue;
    const rel = normalizeReleasePath(path.join("resources/app/src/ui/desktop/dist/assets", entry.name));
    const content = readPackagedTextFile(artifactRoot, rel);
    if (content?.includes(needle)) evidence.push(`${rel} contains ${needle}`);
  }
  return evidence;
}

function inspectElectronReleaseHardening(check: ReleaseArtifactCheck, workflowRoot: string): void {
  const packagePath = path.join(workflowRoot, "package.json");
  const appPackage = readJsonObject<PackageJsonMetadata>(packagePath);
  const author = normalizePackageAuthor(appPackage?.author);
  if (!author) {
    addArtifactIssue(check, "warning", "electron-package-author-missing", "Electron package metadata has no author, so the builder emits a public release metadata warning.", [
      "missing author in package.json",
    ]);
  } else {
    check.evidence.push(`package author metadata exists: ${author}`);
  }

  const builderPath = path.join(workflowRoot, "src", "ui", "desktop", "electron-builder.json");
  const builder = readJsonObject<ElectronBuilderMetadata>(builderPath);
  if (!builder) {
    addArtifactIssue(check, "blocker", "electron-builder-config-missing", "Electron builder configuration is missing, so public package metadata cannot be audited.", [
      "missing src/ui/desktop/electron-builder.json",
    ]);
    return;
  }

  const appId = typeof builder.appId === "string" ? builder.appId.trim() : "";
  if (!appId || isLocalOnlyAppId(appId)) {
    addArtifactIssue(check, "blocker", "electron-app-id-public-release-blocker", "Electron appId is missing or local-only; public releases need a stable publisher-controlled reverse-DNS appId.", [
      appId ? `appId=${appId}` : "missing appId",
    ]);
  } else {
    check.evidence.push(`Electron appId is public-release shaped: ${appId}`);
  }

  const iconPath = resolveConfiguredElectronIcon(workflowRoot, builderPath, builder);
  if (!iconPath) {
    addArtifactIssue(check, "blocker", "electron-icon-missing", "Electron app icon is not configured, so the package will ship with the default Electron icon.", [
      "missing icon or win.icon in src/ui/desktop/electron-builder.json",
    ]);
  } else if (!fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) {
    addArtifactIssue(check, "blocker", "electron-icon-file-missing", "Electron app icon is configured but the icon file does not exist.", [
      path.relative(workflowRoot, iconPath).replace(/\\/g, "/"),
    ]);
  } else {
    check.evidence.push(`Electron app icon exists: ${path.relative(workflowRoot, iconPath).replace(/\\/g, "/")}`);
  }

  if (builder.asar === false) {
    addArtifactIssue(check, "warning", "electron-asar-disabled", "Electron asar is disabled. This keeps RPG-Agent-MV's dynamic backend files inspectable, but it is weaker than a hardened packaged app.", [
      "asar=false in src/ui/desktop/electron-builder.json",
      "current Electron main process dynamically imports src/backend files and the pinned opencode runtime is copied as unpacked resources",
    ]);
  }

  const targets = flattenElectronTargets(builder.win?.target);
  if (targets.includes("dir")) {
    check.evidence.push("Electron dir target is configured for inspectable package proof");
  } else if (targets.length > 0) {
    addArtifactIssue(check, "blocker", "electron-dir-target-missing", "Electron release configuration must keep the dir target so release-check can inspect packaged app contents.", [
      `win.target=${targets.join(", ")}`,
    ]);
  }

  if (isDirOnlyTarget(builder.win?.target)) {
    addArtifactIssue(check, "warning", "electron-dir-package-only", "Electron release output is a Windows unpacked directory package, not an installer.", [
      "win.target includes dir only",
    ]);
  }

  const installerTargets = targets.filter(isElectronInstallerTarget);
  if (installerTargets.length > 0) {
    check.evidence.push(`Electron installer target configured: ${installerTargets.join(", ")}`);
    inspectElectronInstallerArtifacts(check, workflowRoot, builderPath, builder, installerTargets);
  }
}

function readJsonObject<T extends object>(filePath: string): T | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as T : null;
  } catch {
    return null;
  }
}

function normalizePackageAuthor(author: unknown): string {
  if (typeof author === "string") return author.trim();
  if (author && typeof author === "object" && !Array.isArray(author)) {
    const record = author as { name?: unknown };
    return typeof record.name === "string" ? record.name.trim() : "";
  }
  return "";
}

function isLocalOnlyAppId(appId: string): boolean {
  const lower = appId.toLowerCase();
  return lower.startsWith("local.")
    || lower.startsWith("localhost.")
    || lower.startsWith("test.")
    || lower.startsWith("example.")
    || lower.endsWith(".local")
    || lower.includes("example");
}

function resolveConfiguredElectronIcon(
  workflowRoot: string,
  builderPath: string,
  builder: ElectronBuilderMetadata,
): string | null {
  const rawIcon = typeof builder.win?.icon === "string" && builder.win.icon.trim()
    ? builder.win.icon.trim()
    : typeof builder.icon === "string" && builder.icon.trim()
      ? builder.icon.trim()
      : "";
  if (!rawIcon) return null;

  const baseDir = typeof builder.directories?.buildResources === "string" && builder.directories.buildResources.trim()
    ? path.resolve(path.dirname(builderPath), builder.directories.buildResources.trim())
    : path.resolve(workflowRoot);
  return path.isAbsolute(rawIcon)
    ? rawIcon
    : path.resolve(baseDir, rawIcon);
}

function isDirOnlyTarget(target: unknown): boolean {
  const targets = flattenElectronTargets(target);
  return targets.length > 0 && targets.every((entry) => entry === "dir");
}

function inspectElectronInstallerArtifacts(
  check: ReleaseArtifactCheck,
  workflowRoot: string,
  builderPath: string,
  builder: ElectronBuilderMetadata,
  installerTargets: string[],
): void {
  const outputDir = resolveElectronOutputDir(workflowRoot, builderPath, builder);
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    addArtifactIssue(check, "blocker", "electron-installer-output-missing", "Electron installer target is configured, but the release output directory does not exist.", [
      path.relative(workflowRoot, outputDir).replace(/\\/g, "/"),
    ]);
    return;
  }

  const artifacts = listArtifactFiles(outputDir)
    .filter((rel) => isElectronInstallerArtifact(rel, installerTargets));
  if (artifacts.length === 0) {
    addArtifactIssue(check, "blocker", "electron-installer-artifact-missing", "Electron installer target is configured, but no matching installer artifact was found in the release output.", [
      `targets=${installerTargets.join(", ")}`,
      `output=${path.relative(workflowRoot, outputDir).replace(/\\/g, "/")}`,
    ]);
    return;
  }

  check.evidence.push(`Electron installer artifact exists: ${artifacts.slice(0, 5).join(", ")}`);
}

function resolveElectronOutputDir(
  workflowRoot: string,
  builderPath: string,
  builder: ElectronBuilderMetadata,
): string {
  const rawOutput = typeof builder.directories?.output === "string" && builder.directories.output.trim()
    ? builder.directories.output.trim()
    : "";
  if (!rawOutput) return path.join(workflowRoot, "runtime", "out", "release", "electron");
  return path.isAbsolute(rawOutput)
    ? rawOutput
    : path.resolve(path.dirname(builderPath), rawOutput);
}

function isElectronInstallerTarget(target: string): boolean {
  return ["nsis", "nsis-web", "msi", "msi-wrapped"].includes(target.toLowerCase());
}

function isElectronInstallerArtifact(rel: string, installerTargets: string[]): boolean {
  if (rel.includes("/")) return false;
  const lower = rel.toLowerCase();
  for (const target of installerTargets.map((entry) => entry.toLowerCase())) {
    if ((target === "nsis" || target === "nsis-web") && lower.endsWith(".exe")) return true;
    if ((target === "msi" || target === "msi-wrapped") && lower.endsWith(".msi")) return true;
  }
  return false;
}

function flattenElectronTargets(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (!Array.isArray(target)) return [];
  const result: string[] = [];
  for (const entry of target) {
    if (typeof entry === "string") result.push(entry);
    else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const name = (entry as { target?: unknown }).target;
      if (typeof name === "string") result.push(name);
    }
  }
  return result;
}

function hasElectronExecutable(files: Set<string>): boolean {
  for (const rel of files) {
    if (/^[^/]+\.exe$/i.test(rel)) return true;
    if (/\.app\/Contents\/MacOS\/[^/]+$/.test(rel)) return true;
  }
  return false;
}

function findElectronArtifactRoot(workflowRoot: string, desktopDir: string): string | null {
  const outputRoots = [
    path.join(workflowRoot, "runtime", "out", "release", "electron"),
    path.join(desktopDir, "release"),
    path.join(desktopDir, "out"),
  ];
  for (const root of outputRoots) {
    const packaged = findElectronPackageDirectory(root);
    if (packaged) return packaged;
  }
  return outputRoots.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) || null;
}

function findElectronPackageDirectory(root: string): string | null {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (isElectronPackageDirectory(current.dir)) return current.dir;
    if (current.depth >= 3) continue;
    for (const entry of fs.readdirSync(current.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return null;
}

function isElectronPackageDirectory(dir: string): boolean {
  return fs.existsSync(path.join(dir, "resources", "app", "package.json"))
    || fs.existsSync(path.join(dir, "resources", "app.asar"));
}

function normalizeReleasePath(value: string): string {
  const rel = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel === "." || path.isAbsolute(rel) || rel.startsWith("../") || rel.includes("/../") || rel.endsWith("/..")) {
    return "";
  }
  return rel;
}

function isScannableSourceText(rel: string): boolean {
  const base = path.posix.basename(rel);
  if (SOURCE_TEXT_BASENAMES.has(base)) return true;
  return SOURCE_TEXT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());
}

function readTextForReleaseScan(filePath: string): string | null {
  const stat = fs.statSync(filePath);
  if (stat.size > 2_000_000) return null;
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function hasPathSegment(rel: string, segment: string): boolean {
  return rel.toLowerCase().split("/").includes(segment);
}

function isRmmvProjectMarker(rel: string): boolean {
  const lower = rel.toLowerCase();
  return lower === "game.rpgproject"
    || lower.endsWith("/game.rpgproject")
    || lower === "game.rmmzproject"
    || lower.endsWith("/game.rmmzproject")
    || lower === "data/system.json"
    || lower.endsWith("/data/system.json")
    || lower === "www/data/system.json"
    || lower.endsWith("/www/data/system.json")
    || lower === "js/rmmz_core.js"
    || lower.endsWith("/js/rmmz_core.js")
    || lower === "www/js/rpg_core.js"
    || lower.endsWith("/www/js/rpg_core.js");
}

function inspectSourceReleaseScope(root: string): ReleaseBoundaryIssue[] {
  const desktopPackage = path.join(root, "src", "ui", "desktop", "package.json");
  if (!fs.existsSync(desktopPackage)) {
    return [{
      severity: "warning",
      code: "source-release-only",
      message: "release-source can only prove the source package; desktop packaging metadata was not found.",
      evidence: ["missing src/ui/desktop/package.json"],
    }];
  }
  const raw = fs.readFileSync(desktopPackage, "utf8");
  const packageJson = JSON.parse(raw) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = packageJson.scripts || {};
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  const hasInstallerPackager = Boolean(
    dependencies["electron-builder"]
      || dependencies["electron-packager"]
      || dependencies["@electron-forge/cli"],
  );
  const hasPackageScript = Object.keys(scripts).some((name) => /^(dist|package|make)$/.test(name));
  if (!hasInstallerPackager || !hasPackageScript) {
    return [{
      severity: "warning",
      code: "source-release-only",
      message: "release-source checks and creates a source release tree only; it does not prove an Electron installer or Web deployment package.",
      evidence: [
        "src/ui/desktop/package.json has dev/build/preview scripts only",
        "no electron-builder, electron-packager or Electron Forge packaging dependency is configured",
      ],
    }];
  }
  return [];
}

function normalizeGitReleasePath(value: string, productPrefix: string): string {
  const rel = normalizeReleasePath(value);
  if (!rel) return "";
  return rel.startsWith(productPrefix) ? rel.slice(productPrefix.length) : rel;
}

function isExistingReleaseFile(root: string, rel: string): boolean {
  const source = path.join(root, rel);
  if (!isPathInside(root, source)) return false;
  return fs.existsSync(source) && fs.statSync(source).isFile();
}

function assertSafeReleaseTarget(root: string, releaseRoot: string, targetDir: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedReleaseRoot = path.resolve(releaseRoot);
  const normalizedTarget = path.resolve(targetDir);
  if (!isPathInside(normalizedReleaseRoot, normalizedTarget)) {
    throw new Error(`Release target must stay inside ${normalizedReleaseRoot}`);
  }
  if (!isPathInside(normalizedRoot, normalizedReleaseRoot)) {
    throw new Error(`Release root must stay inside ${normalizedRoot}`);
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
