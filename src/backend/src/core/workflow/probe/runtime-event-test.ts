import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson } from "../../rmmv/json.ts";
import { resolveDataDir } from "../../rmmv/project-scanner.ts";
import { runNwjsRuntimeEventProbe } from "./nwjs-runtime-event-probe.ts";

const DEFAULT_TIMEOUT_MS: number = 12000;

interface TestDefinition {
  id: string;
  name: string;
  start: Record<string, unknown> | null;
  steps: TestStep[];
  expectations: TestStep[];
}

interface TestStep {
  type?: string;
  action?: string;
  assert?: string;
  mapId?: number;
  x?: number;
  y?: number;
  direction?: string | number;
  frames?: number;
  steps?: number;
  eventId?: number;
  selfSwitch?: string;
  id?: number;
  value?: unknown;
  characterName?: string;
  runtime?: boolean;
  [key: string]: unknown;
}

interface Finding {
  severity: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface StaticReviewResult {
  status: string;
  findings: Finding[];
  summary: {
    tests: number;
    blockingFindings: number;
    reviewFindings: number;
  };
}

interface RuntimeEventTestReport {
  generatedAt: string;
  projectRoot: string;
  mode: string;
  timeoutMs: number;
  status: string;
  plan: TestDefinition[];
  staticReview: StaticReviewResult;
  runtime: RuntimeProbeResult;
  summary: ReportSummary;
  limitations: string[];
}

interface ReportSummary {
  tests: number;
  staticBlockingFindings: number;
  staticReviewFindings: number;
  runtimePassed: number;
  runtimeFailed: number;
}

interface RuntimeProbeResult {
  attempted: boolean;
  method: string;
  status: string;
  detail: string;
  gameExe?: string;
  probe?: Record<string, unknown>;
  browserPath?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  stderr?: string;
  [key: string]: unknown;
}

interface RuntimeEventTestOptions {
  mode?: string;
  timeoutMs?: number;
  browserPath?: string;
}

function loadRuntimeEventTestPlan(planPath: string): unknown {
  return readJson(path.resolve(planPath));
}

function buildRuntimeEventTest(projectRoot: string, testPlan: unknown, options: RuntimeEventTestOptions = {}): RuntimeEventTestReport {
  const project: string = path.resolve(projectRoot);
  const mode: string = normalizeMode(options.mode || "static");
  const timeoutMs: number = normalizeTimeout(options.timeoutMs);
  const plan: TestDefinition[] = normalizePlan(testPlan);
  const staticReview: StaticReviewResult = reviewRuntimeTestPlan(project, plan);
  const report: RuntimeEventTestReport = {
    generatedAt: new Date().toISOString(),
    projectRoot: project,
    mode,
    timeoutMs,
    status: staticReview.summary.blockingFindings > 0 ? "blocked" : "static-pass",
    plan,
    staticReview,
    runtime: {
      attempted: false,
      method: "",
      status: "not-run",
      detail: "Runtime event execution was not requested."
    },
    summary: {
      tests: plan.length,
      staticBlockingFindings: staticReview.summary.blockingFindings,
      staticReviewFindings: staticReview.summary.reviewFindings,
      runtimePassed: 0,
      runtimeFailed: 0
    },
    limitations: [
      "Runtime event tests execute a bounded JSON test plan in an automated browser or NW.js probe when an appropriate runtime is available.",
      "The runner can start a new game, transfer the player, move, trigger map events, wait frames, and assert map/player/switch/variable/self-switch state.",
      "It still cannot prove project-specific plugin semantics, save/load flows, timing-sensitive cutscenes, or branches outside the supplied test plan."
    ]
  };

  if (staticReview.summary.blockingFindings > 0 || mode === "none" || mode === "static") {
    return report;
  }

  const runtime: RuntimeProbeResult = runRuntimeEventProbe(project, plan, {
    mode,
    timeoutMs,
    browserPath: options.browserPath
  });
  report.runtime = runtime;
  const runtimeTests: Record<string, unknown>[] = runtime.probe && Array.isArray((runtime.probe as Record<string, unknown>).tests) ? (runtime.probe as Record<string, unknown>).tests as Record<string, unknown>[] : [];
  report.summary.runtimePassed = runtimeTests.filter((test: Record<string, unknown>) => test.status === "pass").length;
  report.summary.runtimeFailed = runtimeTests.filter((test: Record<string, unknown>) => test.status === "fail").length;
  if (runtime.status === "pass") {
    report.status = "runtime-pass";
  } else if (runtime.status === "not-available") {
    report.status = "runtime-not-available";
  } else {
    report.status = "blocked";
  }
  return report;
}

function normalizeMode(mode: unknown): string {
  const value: string = String(mode || "static").toLowerCase();
  if (["none", "static", "auto", "browser", "nwjs"].includes(value)) return value;
  throw new Error(`Unsupported runtime event test mode: ${mode}`);
}

function normalizeTimeout(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed: number = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000) throw new Error("--timeout-ms must be an integer >= 1000");
  return parsed;
}

function normalizePlan(plan: unknown): TestDefinition[] {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Runtime event test plan must be an object.");
  const planObj = plan as Record<string, unknown>;
  if (planObj.engine && planObj.engine !== "rpg-maker-mv") throw new Error("Runtime event test plan engine must be rpg-maker-mv.");
  const tests: unknown[] = Array.isArray(planObj.tests) ? planObj.tests as unknown[] : [];
  return tests.map((test: unknown, index: number) => normalizeTest(test, index));
}

function normalizeTest(test: unknown, index: number): TestDefinition {
  if (!test || typeof test !== "object" || Array.isArray(test)) throw new Error(`tests[${index}] must be an object.`);
  const testObj = test as Record<string, unknown>;
  const id: string = (testObj.id as string) || `test_${index + 1}`;
  return {
    id,
    name: (testObj.name as string) || id,
    start: (testObj.start as Record<string, unknown>) || null,
    steps: Array.isArray(testObj.steps) ? testObj.steps as TestStep[] : [],
    expectations: Array.isArray(testObj.expectations) ? testObj.expectations as TestStep[] : []
  };
}

function reviewRuntimeTestPlan(project: string, plan: TestDefinition[]): StaticReviewResult {
  const findings: Finding[] = [];
  const dataDir: string | null = safeResolveDataDir(project);
  const system: Record<string, unknown> | null = dataDir ? readJsonIfExists(path.join(dataDir, "System.json")) as Record<string, unknown> | null : null;
  const mapInfos: unknown[] | null = dataDir ? readJsonIfExists(path.join(dataDir, "MapInfos.json")) as unknown[] | null : null;
  if (!fs.existsSync(project)) {
    addFinding(findings, "blocker", "project-missing", `Project path does not exist: ${project}`);
  }
  if (!dataDir) {
    addFinding(findings, "blocker", "data-dir-missing", "Project does not have a readable RPG Maker MV data directory.");
  }
  if (plan.length === 0) {
    addFinding(findings, "blocker", "empty-test-plan", "Runtime event test plan must contain at least one test.");
  }
  for (const [testIndex, test] of plan.entries()) {
    reviewTest(project, dataDir, system, mapInfos, test, testIndex, findings);
  }
  return {
    status: findings.some((finding: Finding) => finding.severity === "blocker") ? "blocked" : "ready",
    findings,
    summary: {
      tests: plan.length,
      blockingFindings: findings.filter((finding: Finding) => finding.severity === "blocker").length,
      reviewFindings: findings.filter((finding: Finding) => finding.severity === "review").length
    }
  };
}

function reviewTest(project: string, dataDir: string | null, system: Record<string, unknown> | null, mapInfos: unknown[] | null, test: TestDefinition, testIndex: number, findings: Finding[]): void {
  if (!test.steps.length && !test.expectations.length) {
    addFinding(findings, "review", "test-has-no-actions", `${test.id} has no steps or expectations.`, { testId: test.id });
  }
  if (test.start) reviewPosition(dataDir, mapInfos, test.start, findings, `${test.id}.start`);
  for (const [stepIndex, step] of test.steps.entries()) {
    reviewStep(project, dataDir, system, mapInfos, step, findings, `${test.id}.steps[${stepIndex}]`);
  }
  for (const [expectIndex, expectation] of test.expectations.entries()) {
    reviewStep(project, dataDir, system, mapInfos, expectation, findings, `${test.id}.expectations[${expectIndex}]`);
  }
  if (!test.id || /\s/.test(test.id)) {
    addFinding(findings, "review", "test-id-weak", `tests[${testIndex}] should use a stable whitespace-free id.`, { testId: test.id });
  }
}

function reviewStep(project: string, dataDir: string | null, system: Record<string, unknown> | null, mapInfos: unknown[] | null, step: TestStep, findings: Finding[], label: string): void {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    addFinding(findings, "blocker", "step-invalid", `${label} must be an object.`);
    return;
  }
  const type: string | undefined = step.type || step.action || step.assert;
  if (!type) {
    addFinding(findings, "blocker", "step-type-missing", `${label} is missing type.`);
    return;
  }
  if (type === "transfer" || type === "assert-map") {
    reviewMapId(dataDir, mapInfos, step.mapId, findings, label);
  } else if (type === "assert-player") {
    reviewPosition(dataDir, mapInfos, step as unknown as Record<string, unknown>, findings, label);
  } else if (type === "assert-player-visible") {
    if (step.characterName) reviewCharacterImage(project, step.characterName, findings, label);
  } else if (type === "interact-event" || type === "assert-event-position") {
    reviewEventReference(dataDir, step.mapId, step.eventId, findings, label);
  } else if (type === "assert-switch") {
    reviewSystemEntry(system, "switches", step.id, findings, label);
  } else if (type === "assert-variable") {
    reviewSystemEntry(system, "variables", step.id, findings, label);
  } else if (type === "assert-self-switch") {
    reviewMapId(dataDir, mapInfos, step.mapId, findings, label);
    if (!Number.isInteger(step.eventId) || (step.eventId as number) < 1) addFinding(findings, "blocker", "event-id-invalid", `${label} requires eventId >= 1.`);
    if (!["A", "B", "C", "D"].includes(step.selfSwitch as string)) addFinding(findings, "blocker", "self-switch-invalid", `${label} requires selfSwitch A, B, C, or D.`);
  } else if (!["new-game", "wait", "move", "turn"].includes(type)) {
    addFinding(findings, "blocker", "step-type-unsupported", `${label} uses unsupported step type: ${type}`);
  }
}

function reviewPosition(dataDir: string | null, mapInfos: unknown[] | null, position: Record<string, unknown>, findings: Finding[], label: string): void {
  reviewMapId(dataDir, mapInfos, position.mapId as number, findings, label);
  const map: Record<string, unknown> | null = dataDir && Number.isInteger(position.mapId) ? readMapIfExists(dataDir, position.mapId as number) : null;
  if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) {
    addFinding(findings, "blocker", "coordinate-invalid", `${label} requires integer x and y.`);
    return;
  }
  if (map && ((position.x as number) < 0 || (position.y as number) < 0 || (position.x as number) >= (map.width as number) || (position.y as number) >= (map.height as number))) {
    addFinding(findings, "blocker", "coordinate-out-of-bounds", `${label} coordinate is outside map ${position.mapId}.`, {
      x: position.x,
      y: position.y,
      width: map.width,
      height: map.height
    });
  }
}

function reviewMapId(dataDir: string | null, mapInfos: unknown[] | null, mapId: unknown, findings: Finding[], label: string): void {
  if (!Number.isInteger(mapId) || (mapId as number) < 1) {
    addFinding(findings, "blocker", "map-id-invalid", `${label} requires mapId >= 1.`);
    return;
  }
  const hasMapInfo: boolean = Array.isArray(mapInfos) && Boolean(mapInfos[mapId as number]);
  const hasMapFile: boolean = Boolean(dataDir && fs.existsSync(path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`)));
  if (!hasMapInfo && !hasMapFile) {
    addFinding(findings, "blocker", "map-missing", `${label} references missing map ${mapId}.`, { mapId });
  }
}

function reviewEventReference(dataDir: string | null, mapId: unknown, eventId: unknown, findings: Finding[], label: string): void {
  reviewMapId(dataDir, null, mapId, findings, label);
  if (!Number.isInteger(eventId) || (eventId as number) < 1) {
    addFinding(findings, "blocker", "event-id-invalid", `${label} requires eventId >= 1.`);
    return;
  }
  const map: Record<string, unknown> | null = dataDir && Number.isInteger(mapId) ? readMapIfExists(dataDir, mapId as number) : null;
  if (map && (!Array.isArray(map.events) || !(map.events as unknown[])[eventId as number])) {
    addFinding(findings, "blocker", "event-missing", `${label} references missing event ${mapId}:${eventId}.`, { mapId, eventId });
  }
}

function reviewSystemEntry(system: Record<string, unknown> | null, key: string, id: unknown, findings: Finding[], label: string): void {
  if (!Number.isInteger(id) || (id as number) < 1) {
    addFinding(findings, "blocker", "state-id-invalid", `${label} requires ${key} id >= 1.`);
    return;
  }
  if (!system || !Array.isArray(system[key])) return;
  if ((id as number) >= (system[key] as unknown[]).length) {
    addFinding(findings, "blocker", "state-id-out-of-range", `${label} references ${key} ${id}, but System.json has ${(system[key] as unknown[]).length - 1} configured slots.`);
  }
}

function reviewCharacterImage(project: string, characterName: unknown, findings: Finding[], label: string): void {
  if (typeof characterName !== "string" || !characterName.trim()) {
    addFinding(findings, "blocker", "character-name-invalid", `${label} requires a non-empty characterName.`);
    return;
  }
  if (/[\\/:]/.test(characterName)) {
    addFinding(findings, "blocker", "character-name-invalid", `${label} uses an unsafe characterName: ${characterName}`);
    return;
  }
  const imagePath: string = path.join(project, "www", "img", "characters", `${characterName}.png`);
  if (!fs.existsSync(imagePath)) {
    addFinding(findings, "blocker", "character-image-missing", `${label} references missing character image: ${imagePath}`, { characterName, imagePath });
  }
}

function runRuntimeEventProbe(project: string, plan: TestDefinition[], options: { mode: string; timeoutMs: number; browserPath?: string }): RuntimeProbeResult {
  if (options.mode === "nwjs") {
    return runNwjsRuntimeEventProbe(project, plan, {
      timeoutMs: options.timeoutMs
    }) as RuntimeProbeResult;
  }
  if (options.mode === "auto") {
    const nwjs = runNwjsRuntimeEventProbe(project, plan, {
      timeoutMs: options.timeoutMs
    }) as RuntimeProbeResult;
    if (nwjs.status !== "not-available") return nwjs;
  }
  const browserPath: string | null = options.browserPath || findChromiumBrowser();
  if (!browserPath) {
    return runtimeResult("browser", "not-available", "No Chromium browser was found. Pass --browser <path> or set RMMV_AGENT_BROWSER to run runtime event tests.");
  }
  const webRoot: string | null = resolveWebRoot(project);
  if (!webRoot) return runtimeResult("browser", "fail", "No index.html entry was found for runtime event testing.");
  const tempDir: string = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-runtime-test-"));
  const planPath: string = path.join(tempDir, "runtime-event-test-plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan), "utf8");
  try {
    const childPath: string = path.join(import.meta.dirname, "runtime-event-test-child.ts");
    const processResult = childProcess.spawnSync(process.execPath, ["--experimental-strip-types", childPath, webRoot, browserPath, String(options.timeoutMs), planPath], {
      cwd: project,
      encoding: "utf8",
      timeout: options.timeoutMs + 10000,
      windowsHide: true
    });
    const parsed = parseChildProbeResult(processResult.stdout as string);
    if (!parsed) {
      return runtimeResult("browser", "fail", "Runtime event test child did not return a readable result.", {
        browserPath,
        exitCode: processResult.status,
        signal: processResult.signal,
        error: processResult.error && processResult.error.message,
        stderr: truncate(processResult.stderr || "", 2000)
      });
    }
    return {
      attempted: true,
      method: "browser",
      status: parsed.status === "pass" ? "pass" : "fail",
      detail: parsed.detail as string || "",
      browserPath,
      exitCode: processResult.status,
      probe: (parsed.probe as Record<string, unknown>) || parsed as Record<string, unknown>,
      stderr: truncate(processResult.stderr || "", 2000)
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[runtime-event-test] Failed to cleanup temp dir:', tempDir, e);
    }
  }
}

function parseChildProbeResult(stdout: string | null): Record<string, unknown> | null {
  const text: string = String(stdout || "").trim();
  if (!text) return null;
  const lastLine: string | undefined = text.split(/\r?\n/).filter(Boolean).pop();
  if (!lastLine) return null;
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch (e) {
    console.warn('[runtime-event-test] Failed to parse child probe result:', e);
    return null;
  }
}

function findChromiumBrowser(): string | null {
  const candidates: string[] = [
    process.env.RMMV_AGENT_BROWSER,
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LocalAppData || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LocalAppData || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate: string) => fs.existsSync(candidate)) || null;
}

function resolveWebRoot(project: string): string | null {
  if (fs.existsSync(path.join(project, "www", "index.html"))) return path.join(project, "www");
  if (fs.existsSync(path.join(project, "index.html"))) return project;
  return null;
}

function runtimeResult(method: string, status: string, detail: string, extra: Record<string, unknown> = {}): RuntimeProbeResult {
  return {
    attempted: status !== "not-available",
    method,
    status,
    detail,
    ...extra
  } as RuntimeProbeResult;
}

function readMapIfExists(dataDir: string, mapId: number): Record<string, unknown> | null {
  return readJsonIfExists(path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`)) as Record<string, unknown> | null;
}

function readJsonIfExists(filePath: string): unknown {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function safeResolveDataDir(project: string): string | null {
  try {
    return resolveDataDir(project);
  } catch (e) {
    console.warn('[runtime-event-test] Failed to resolve data dir:', project, e);
    return null;
  }
}

function addFinding(findings: Finding[], severity: string, code: string, message: string, details: Record<string, unknown> = {}): void {
  findings.push({ severity, code, message, details });
}

function truncate(value: unknown, limit: number): string {
  const text: string = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export { buildRuntimeEventTest, loadRuntimeEventTestPlan, reviewRuntimeTestPlan };
