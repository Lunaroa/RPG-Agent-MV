import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import vm from "node:vm";
import { readJson } from "../../rmmv/json.ts";
import { checkPassage, classifyPassage } from "../../rmmv/map-space.ts";
import { buildPluginInventory } from "../../rmmv/plugin-inventory.ts";
import { resolveDataDir, scanProject } from "../../rmmv/project-scanner.ts";
import { runNwjsPlayableProbe } from "./nwjs-playable-probe.ts";

interface StaticCheck {
  id: string;
  severity: string;
  pass: boolean;
  detail: string;
}

interface AlgorithmCheck {
  id: string;
  severity: string;
  pass: boolean;
  detail: string;
}

interface AlgorithmFinding {
  severity: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface StartAnalysis {
  mapId: number;
  mapName: string;
  x: number;
  y: number;
  tileClass: string;
  passage: Record<string, boolean>;
  reachableTiles: number;
  walkableTiles: number;
  reachableRatio: number;
}

interface TransferFacts {
  direct: TransferFact[];
  variable: Record<string, unknown>[];
}

interface TransferFact {
  source: string;
  mapId: number;
  x: number;
  y: number;
  direction: number;
  fadeType: number;
  location: string;
}

interface AlgorithmicPlayability {
  status: string;
  checks: AlgorithmCheck[];
  findings: AlgorithmFinding[];
  start: StartAnalysis | null;
  transfers: {
    direct: number;
    variable: number;
    validDirect: number;
    blockedDirectTargets: number;
  };
  plugins: {
    enabled: number;
    syntaxChecked: number;
    syntaxErrors: number;
    missingFiles: number;
  };
  summary: {
    failedRequired: number;
    reviewFindings: number;
  };
}

interface PlayabilityReport {
  generatedAt: string;
  projectRoot: string;
  mode: string;
  timeoutMs: number;
  status: string;
  checks: StaticCheck[];
  runtime: RuntimeProbeResult;
  playable: RuntimeProbeResult;
  algorithmic: AlgorithmicPlayability;
  summary: PlayabilitySummary;
  limitations: string[];
}

interface RuntimeProbeResult {
  attempted: boolean;
  status: string;
  method: string | null;
  detail: string;
  gameExe?: string;
  probe?: Record<string, unknown>;
  artifacts?: { resultJson: string; screenPng: string | null };
  browserPath?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  stderr?: string;
  elapsedMs?: number;
}

interface PlayabilitySummary {
  total: number;
  passed: number;
  failedRequired: number;
  failedOptional: number;
  algorithmicStatus?: string;
  algorithmicFailedRequired?: number;
  algorithmicReviewFindings?: number;
}

interface PlayabilityOptions {
  mode?: string;
  timeoutMs?: number;
  artifactDir?: string;
  browserPath?: string;
}

interface Move {
  name: string;
  opposite: string;
  dx: number;
  dy: number;
}

interface MapRecord {
  info: Record<string, unknown>;
  map: Record<string, unknown>;
  tileset: Record<string, unknown> | null;
  mapFile: string;
}

interface PluginSyntaxResult {
  summary: {
    enabled: number;
    syntaxChecked: number;
    syntaxErrors: number;
    missingFiles: number;
    runtimeSkipped: number;
    bootCompat: boolean;
  };
  findings: AlgorithmFinding[];
}

interface BootCompatResult {
  active: boolean;
  disabledPlugins: Set<string>;
  disabledReasons: Map<string, string>;
}

const DEFAULT_TIMEOUT_MS: number = 8000;
const MOVES: Move[] = [
  { name: "down", opposite: "up", dx: 0, dy: 1 },
  { name: "left", opposite: "right", dx: -1, dy: 0 },
  { name: "right", opposite: "left", dx: 1, dy: 0 },
  { name: "up", opposite: "down", dx: 0, dy: -1 }
];

function buildPlayabilityCheck(projectRoot: string, options: PlayabilityOptions = {}): PlayabilityReport {
  const project: string = path.resolve(projectRoot);
  const mode: string = normalizeMode(options.mode);
  const timeoutMs: number = normalizeTimeout(options.timeoutMs);
  const checks: StaticCheck[] = buildStaticChecks(project);
  const algorithmic: AlgorithmicPlayability = buildAlgorithmicPlayability(project);
  const report: PlayabilityReport = {
    generatedAt: new Date().toISOString(),
    projectRoot: project,
    mode,
    timeoutMs,
    status: "static-ready",
    checks,
    runtime: {
      attempted: false,
      status: "not-run",
      method: null,
      detail: "Runtime probe was not requested."
    },
    playable: {
      attempted: false,
      status: "not-run",
      method: null,
      detail: "Deep playable probe was not requested."
    },
    algorithmic,
    summary: summarizeChecks(checks),
    limitations: [
      "Runtime boot smoke proves the game can start far enough to expose RPG Maker MV runtime objects or keep NW.js alive briefly; it is launch evidence, not playable proof.",
      "Deep playable mode temporarily injects probe files, starts NW.js against the project worktree, enters a new game, samples the canvas, verifies the start map, waits for the start event loop to become idle, and restores touched files.",
      "Algorithmic checks prove only bounded static properties such as the start coordinate, local reachability, and direct transfer targets.",
      "It does not prove every generated event trigger, save-state path, plugin command, or movement route is correct.",
      "Use manual-test-plan/manual-test-plan.md for gameplay paths that static and boot checks cannot execute."
    ]
  };
  report.summary.algorithmicStatus = algorithmic.status;
  report.summary.algorithmicFailedRequired = algorithmic.summary.failedRequired;
  report.summary.algorithmicReviewFindings = algorithmic.summary.reviewFindings;

  if (report.summary.failedRequired > 0) {
    report.status = "blocked";
    report.runtime.detail = "Static required checks failed; runtime probe was skipped.";
    return report;
  }
  if (algorithmic.summary.failedRequired > 0 && mode !== "deep" && mode !== "playable") {
    report.status = "blocked";
    report.runtime.detail = "Algorithmic required playability checks failed; runtime probe was skipped.";
    return report;
  }

  if (mode === "none" || mode === "static") {
    report.status = "static-ready";
    return report;
  }

  if (mode === "deep" || mode === "playable") {
    const playable = runNwjsPlayableProbe(project, {
      timeoutMs,
      artifactDir: options.artifactDir
    });
    report.playable = playable as RuntimeProbeResult;
    report.runtime = {
      attempted: playable.attempted,
      method: playable.method,
      status: playable.status === "pass" ? "pass" : playable.status,
      detail: playable.detail,
      gameExe: playable.gameExe,
      probe: playable.probe,
      artifacts: playable.artifacts
    };
    const runtimePassed: boolean = playable.status === "pass";
    if (hasBlockingAlgorithmicFailures(algorithmic, { runtimePassed })) report.status = "blocked";
    else if (runtimePassed) report.status = "playable-probed";
    else if (playable.status === "review") report.status = "needs-playtest";
    else if (playable.status === "not-available") report.status = "runtime-not-available";
    else report.status = "blocked";
    return report;
  }

  const runtime: RuntimeProbeResult = runRuntimeProbe(project, { mode, timeoutMs, browserPath: options.browserPath });
  report.runtime = runtime;
  if (runtime.status === "pass") {
    report.status = "runtime-booted";
  } else if (runtime.status === "not-available") {
    report.status = "runtime-not-available";
  } else {
    report.status = "blocked";
  }
  return report;
}

function normalizeMode(mode: unknown): string {
  const value: string = String(mode || "static").toLowerCase();
  if (["none", "static", "auto", "browser", "nwjs", "deep", "playable"].includes(value)) return value;
  throw new Error(`Unsupported playability mode: ${mode}`);
}

function normalizeTimeout(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed: number = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000) throw new Error("--timeout-ms must be an integer >= 1000");
  return parsed;
}

function buildStaticChecks(project: string): StaticCheck[] {
  const checks: StaticCheck[] = [];
  const dataDir: string | null = safeResolveDataDir(project);
  addCheck(checks, "project-exists", "required", fs.existsSync(project), project);
  addCheck(checks, "data-dir", "required", Boolean(dataDir), dataDir || "www/data or data missing");
  addCheck(checks, "system-json", "required", Boolean(dataDir && fs.existsSync(path.join(dataDir, "System.json"))), dataDir ? path.join(dataDir, "System.json") : "System.json missing");
  addCheck(checks, "mapinfos-json", "required", Boolean(dataDir && fs.existsSync(path.join(dataDir, "MapInfos.json"))), dataDir ? path.join(dataDir, "MapInfos.json") : "MapInfos.json missing");
  addCheck(checks, "index-html", "required", Boolean(findIndexHtml(project)), "RPG Maker browser entry");
  addCheck(checks, "core-js", "required", hasCoreJs(project), "RPG Maker MV core JavaScript files");
  addCheck(checks, "package-json", "optional", fs.existsSync(path.join(project, "package.json")) || fs.existsSync(path.join(project, "www", "package.json")), "NW.js package metadata");
  addCheck(checks, "game-exe", "optional", fs.existsSync(path.join(project, "Game.exe")), path.join(project, "Game.exe"));
  addCheck(checks, "save-dir", "optional", fs.existsSync(path.join(project, "www", "save")) || fs.existsSync(path.join(project, "save")), "Save directory optional");
  return checks;
}

function buildAlgorithmicPlayability(project: string): AlgorithmicPlayability {
  const checks: AlgorithmCheck[] = [];
  const findings: AlgorithmFinding[] = [];
  const analysis: AlgorithmicPlayability = {
    status: "pass",
    checks,
    findings,
    start: null,
    transfers: {
      direct: 0,
      variable: 0,
      validDirect: 0,
      blockedDirectTargets: 0
    },
    plugins: {
      enabled: 0,
      syntaxChecked: 0,
      syntaxErrors: 0,
      missingFiles: 0
    },
    summary: {
      failedRequired: 0,
      reviewFindings: 0
    }
  };

  try {
    const dataDir: string = resolveDataDir(project);
    const system = readJson(path.join(dataDir, "System.json")) as Record<string, unknown>;
    const mapInfos = readJson(path.join(dataDir, "MapInfos.json")) as Record<string, unknown>[];
    const tilesets = readJson(path.join(dataDir, "Tilesets.json")) as Record<string, unknown>[];
    const mapInfoById = new Map((mapInfos || []).filter(Boolean).map((info: Record<string, unknown>) => [info.id, info]));
    const mapCache = new Map<number, MapRecord | null>();
    const loadMap = (mapId: number): MapRecord | null => loadMapRecord(dataDir, mapInfoById, tilesets, mapCache, mapId);

    const startMapId = system.startMapId as number;
    const startX = system.startX as number;
    const startY = system.startY as number;
    addAlgorithmCheck(checks, "start-map-configured", "required", Number.isInteger(startMapId) && startMapId > 0, `startMapId=${startMapId || 0}`);
    addAlgorithmCheck(checks, "start-coordinate-configured", "required", Number.isInteger(startX) && Number.isInteger(startY) && startX >= 0 && startY >= 0, `start=(${startX},${startY})`);

    const startRecord: MapRecord | null = Number.isInteger(startMapId) && startMapId > 0 ? loadMap(startMapId) : null;
    addAlgorithmCheck(checks, "start-map-loadable", "required", Boolean(startRecord && startRecord.map && startRecord.tileset), startRecord ? `${(startRecord.info as Record<string, unknown>).name || "(unnamed)"} Map${String(startMapId).padStart(3, "0")}.json` : `Map ${startMapId || 0} missing`);

    if (startRecord && startRecord.map) {
      const inBounds: boolean = inMapBounds(startRecord.map, startX, startY);
      addAlgorithmCheck(checks, "start-coordinate-in-bounds", "required", inBounds, `map ${startMapId} bounds ${startRecord.map.width}x${startRecord.map.height}, start=(${startX},${startY})`);
      if (inBounds && startRecord.tileset) {
        const passage: Record<string, boolean> = checkPassage(startRecord.map as unknown as Parameters<typeof checkPassage>[0], startRecord.tileset as unknown as Parameters<typeof checkPassage>[1], startX, startY);
        const tileClass: string = classifyPassage(passage);
        const reachability = analyzeReachability(startRecord.map as unknown as Parameters<typeof checkPassage>[0], startRecord.tileset as unknown as Parameters<typeof checkPassage>[1], startX, startY);
        analysis.start = {
          mapId: startMapId,
          mapName: ((startRecord.info as Record<string, unknown>).name as string) || "",
          x: startX,
          y: startY,
          tileClass,
          passage,
          reachableTiles: reachability.reachableTiles,
          walkableTiles: reachability.walkableTiles,
          reachableRatio: reachability.walkableTiles ? Number((reachability.reachableTiles / reachability.walkableTiles).toFixed(3)) : 0
        };
        addAlgorithmCheck(checks, "start-position-passability", "required", tileClass !== "blocked", `start tile is ${tileClass}`);
        addAlgorithmCheck(checks, "start-map-reachable-area", "required", reachability.reachableTiles > 0, `${reachability.reachableTiles}/${reachability.walkableTiles} walkable tiles reachable from start`);
        if (reachability.walkableTiles > 0 && reachability.reachableTiles < Math.min(5, reachability.walkableTiles)) {
          addAlgorithmFinding(findings, "review", "small-start-reachable-area", `Only ${reachability.reachableTiles} walkable tile(s) are reachable from the start coordinate.`, {
            mapId: startMapId,
            x: startX,
            y: startY
          });
        }
      }
    }

    const scan = scanProject(project);
    const transferFacts: TransferFacts = collectTransferFacts(scan as unknown as Record<string, unknown>);
    analysis.transfers.direct = transferFacts.direct.length;
    analysis.transfers.variable = transferFacts.variable.length;
    for (const transfer of transferFacts.direct) {
      const target: MapRecord | null = loadMap(transfer.mapId);
      if (!target || !target.map || !target.tileset) {
        addAlgorithmFinding(findings, "fail", "transfer-target-map-missing", `${transfer.location} transfers to missing map ${transfer.mapId}.`, transfer as unknown as Record<string, unknown>);
        continue;
      }
      if (!inMapBounds(target.map, transfer.x, transfer.y)) {
        addAlgorithmFinding(findings, "fail", "transfer-target-out-of-bounds", `${transfer.location} transfers outside map ${transfer.mapId} bounds ${target.map.width}x${target.map.height}.`, transfer as unknown as Record<string, unknown>);
        continue;
      }
      const tileClass: string = classifyPassage(checkPassage(target.map as unknown as Parameters<typeof checkPassage>[0], target.tileset as unknown as Parameters<typeof checkPassage>[1], transfer.x, transfer.y));
      if (tileClass === "blocked") {
        analysis.transfers.blockedDirectTargets += 1;
        addAlgorithmFinding(findings, "review", "transfer-target-blocked", `${transfer.location} transfers to blocked tile map ${transfer.mapId} (${transfer.x},${transfer.y}).`, {
          ...transfer as unknown as Record<string, unknown>,
          tileClass
        });
      } else {
        analysis.transfers.validDirect += 1;
      }
    }
    for (const transfer of transferFacts.variable.slice(0, 20)) {
      addAlgorithmFinding(findings, "review", "variable-transfer-target", `${(transfer as Record<string, unknown>).location} uses variable-based transfer coordinates that cannot be statically resolved.`, transfer as Record<string, unknown>);
    }
    if (transferFacts.variable.length > 20) {
      addAlgorithmFinding(findings, "review", "variable-transfer-targets-truncated", `${transferFacts.variable.length - 20} additional variable-based transfers were omitted from the report.`, {
        omitted: transferFacts.variable.length - 20
      });
    }
    const hardTransferFailures: number = findings.filter((item) => item.code === "transfer-target-map-missing" || item.code === "transfer-target-out-of-bounds").length;
    addAlgorithmCheck(checks, "direct-transfer-targets-loadable", "required", hardTransferFailures === 0, `${analysis.transfers.direct - hardTransferFailures}/${analysis.transfers.direct} direct transfer target(s) are loadable and in bounds`);

    const startMap = ((scan as unknown as Record<string, unknown>).maps as Record<string, unknown>[] || []).find((map) => map.id === startMapId);
    const startAutoruns = collectAutorunPages(startMap);
    if (startAutoruns.length) {
      addAlgorithmFinding(findings, "review", "start-map-autorun", `Start map ${startMapId} has ${startAutoruns.length} autorun page(s); static analysis cannot prove they terminate.`, {
        mapId: startMapId,
        pages: startAutoruns.slice(0, 20)
      });
    }

    const pluginSyntax: PluginSyntaxResult = analyzeEnabledPluginSyntax(project);
    analysis.plugins = pluginSyntax.summary;
    for (const finding of pluginSyntax.findings) findings.push(finding);
    addAlgorithmCheck(checks, "enabled-plugin-files-parse", "required", pluginSyntax.summary.syntaxErrors === 0 && pluginSyntax.summary.missingFiles === 0, `${pluginSyntax.summary.syntaxChecked}/${pluginSyntax.summary.enabled} enabled plugin file(s) parsed`);
  } catch (error) {
    addAlgorithmFinding(findings, "fail", "algorithmic-analysis-error", (error as Error).message);
  }

  analysis.summary.failedRequired = checks.filter((check) => check.severity === "required" && !check.pass).length
    + findings.filter((finding) => finding.severity === "fail").length;
  analysis.summary.reviewFindings = findings.filter((finding) => finding.severity === "review").length;
  if (analysis.summary.failedRequired > 0) analysis.status = "fail";
  else if (analysis.summary.reviewFindings > 0) analysis.status = "review";
  return analysis;
}

function loadMapRecord(dataDir: string, mapInfoById: Map<unknown, unknown>, tilesets: Record<string, unknown>[], cache: Map<number, MapRecord | null>, mapId: number): MapRecord | null {
  if (cache.has(mapId)) return cache.get(mapId)!;
  const info = mapInfoById.get(mapId) as Record<string, unknown> | undefined;
  if (!info) {
    cache.set(mapId, null);
    return null;
  }
  const mapFile: string = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
  if (!fs.existsSync(mapFile)) {
    cache.set(mapId, null);
    return null;
  }
  const map = readJson(mapFile) as Record<string, unknown>;
  const tileset: Record<string, unknown> | null = tilesets && tilesets[map.tilesetId as number] ? tilesets[map.tilesetId as number] : null;
  const record: MapRecord = { info, map, tileset, mapFile };
  cache.set(mapId, record);
  return record;
}

function analyzeReachability(map: Parameters<typeof checkPassage>[0], tileset: Parameters<typeof checkPassage>[1], startX: number, startY: number): { reachableTiles: number; walkableTiles: number } {
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [];
  let walkableTiles: number = 0;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (classifyPassage(checkPassage(map, tileset, x, y)) !== "blocked") walkableTiles += 1;
    }
  }
  if (classifyPassage(checkPassage(map, tileset, startX, startY)) === "blocked") {
    return { reachableTiles: 0, walkableTiles };
  }
  queue.push({ x: startX, y: startY });
  visited.add(positionKey(startX, startY));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const move of MOVES) {
      const next = { x: current.x + move.dx, y: current.y + move.dy };
      const key: string = positionKey(next.x, next.y);
      if (visited.has(key) || !inMapBounds(map as unknown as Record<string, unknown>, next.x, next.y)) continue;
      if (!canMove(map, tileset, current.x, current.y, move)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return { reachableTiles: visited.size, walkableTiles };
}

function canMove(map: Parameters<typeof checkPassage>[0], tileset: Parameters<typeof checkPassage>[1], x: number, y: number, move: Move): boolean {
  const nextX: number = x + move.dx;
  const nextY: number = y + move.dy;
  if (!inMapBounds(map as unknown as Record<string, unknown>, nextX, nextY)) return false;
  const from: Record<string, boolean> = checkPassage(map, tileset, x, y);
  const to: Record<string, boolean> = checkPassage(map, tileset, nextX, nextY);
  return Boolean(from[move.name] && to[move.opposite]);
}

function inMapBounds(map: Record<string, unknown>, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < (map.width as number) && y < (map.height as number);
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

function collectTransferFacts(scan: Record<string, unknown>): TransferFacts {
  const result: TransferFacts = { direct: [], variable: [] };
  for (const map of (scan.maps || []) as Record<string, unknown>[]) {
    for (const event of (map.events || []) as Record<string, unknown>[]) {
      for (const page of (event.pages || []) as Record<string, unknown>[]) {
        for (const transfer of ((page.commands as Record<string, unknown>)?.transfers || []) as Record<string, unknown>[]) {
          const fact: TransferFact = {
            source: "map-event",
            mapId: transfer.mapId as number,
            x: transfer.x as number,
            y: transfer.y as number,
            direction: transfer.direction as number,
            fadeType: transfer.fadeType as number,
            location: `Map ${map.id}:${map.name || "(unnamed)"} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber}`
          };
          if (transfer.mode === "direct") result.direct.push(fact);
          else result.variable.push({ ...transfer, source: "map-event", location: fact.location });
        }
      }
    }
  }
  for (const event of (scan.commonEvents || []) as Record<string, unknown>[]) {
    for (const transfer of ((event.commands as Record<string, unknown>)?.transfers || []) as Record<string, unknown>[]) {
      const fact: TransferFact = {
        source: "common-event",
        mapId: transfer.mapId as number,
        x: transfer.x as number,
        y: transfer.y as number,
        direction: transfer.direction as number,
        fadeType: transfer.fadeType as number,
        location: `Common event ${event.id}:${event.name || "(unnamed)"}`
      };
      if (transfer.mode === "direct") result.direct.push(fact);
      else result.variable.push({ ...transfer, source: "common-event", location: fact.location });
    }
  }
  return result;
}

function collectAutorunPages(map: Record<string, unknown> | undefined): { eventId: number; eventName: string; pageNumber: number; conditions: unknown[] }[] {
  const result: { eventId: number; eventName: string; pageNumber: number; conditions: unknown[] }[] = [];
  if (!map) return result;
  for (const event of (map.events || []) as Record<string, unknown>[]) {
    for (const page of (event.pages || []) as Record<string, unknown>[]) {
      if (page.trigger === "autorun") {
        result.push({
          eventId: event.id as number,
          eventName: (event.name as string) || "",
          pageNumber: page.pageNumber as number,
          conditions: (page.conditions as unknown[]) || []
        });
      }
    }
  }
  return result;
}

function analyzeEnabledPluginSyntax(project: string): PluginSyntaxResult {
  const inventory = buildPluginInventory(project);
  const bootCompat: BootCompatResult = detectPlayableBootCompat(project);
  const enabled = (inventory.installedPlugins as unknown as Record<string, unknown>[] || [])
    .filter((plugin: Record<string, unknown>) => plugin && plugin.status && plugin.name && !plugin.parseError);
  const summary: PluginSyntaxResult["summary"] = {
    enabled: enabled.length,
    syntaxChecked: 0,
    syntaxErrors: 0,
    missingFiles: 0,
    runtimeSkipped: 0,
    bootCompat: bootCompat.active
  };
  const findings: AlgorithmFinding[] = [];
  for (const plugin of enabled) {
    if (bootCompat.disabledPlugins.has(plugin.name as string)) {
      summary.runtimeSkipped += 1;
      addAlgorithmFinding(findings, "review", "enabled-plugin-runtime-skipped", `Enabled plugin ${plugin.name} is skipped by MOD_PlayableBootCompat at runtime.`, {
        plugin: plugin.name,
        reason: bootCompat.disabledReasons.get(plugin.name as string) || "Runtime boot compatibility layer disables this plugin."
      });
      continue;
    }
    if (/[\\/:]/.test(plugin.name as string)) {
      summary.missingFiles += 1;
      addAlgorithmFinding(findings, "fail", "enabled-plugin-invalid-name", `Enabled plugin name is not a safe file stem: ${plugin.name}`, { plugin: plugin.name });
      continue;
    }
    const filePath: string = path.join(project, "www", "js", "plugins", `${plugin.name}.js`);
    if (!fs.existsSync(filePath)) {
      summary.missingFiles += 1;
      addAlgorithmFinding(findings, "fail", "enabled-plugin-file-missing", `Enabled plugin ${plugin.name} is missing ${filePath}.`, { plugin: plugin.name, filePath });
      continue;
    }
    summary.syntaxChecked += 1;
    try {
      new vm.Script(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""), { filename: filePath });
    } catch (error) {
      summary.syntaxErrors += 1;
      addAlgorithmFinding(findings, "fail", "enabled-plugin-syntax-error", `Enabled plugin ${plugin.name} does not parse: ${(error as Error).message}`, {
        plugin: plugin.name,
        filePath,
        message: (error as Error).message
      });
    }
  }
  return { summary, findings };
}

function detectPlayableBootCompat(project: string): BootCompatResult {
  const result: BootCompatResult = {
    active: false,
    disabledPlugins: new Set(),
    disabledReasons: new Map()
  };
  const indexPath: string | null = findIndexHtml(project);
  const compatPath: string = path.join(project, "www", "js", "plugins", "MOD_PlayableBootCompat.js");
  if (!indexPath || !fs.existsSync(compatPath)) return result;
  const indexHtml: string = fs.readFileSync(indexPath, "utf8");
  if (!/js\/plugins\/MOD_PlayableBootCompat\.js/i.test(indexHtml)) return result;
  result.active = true;
  const source: string = fs.readFileSync(compatPath, "utf8");
  if (/\bItemBook\b/.test(source)) {
    result.disabledPlugins.add("ItemBook");
    result.disabledReasons.set("ItemBook", "The project boot compatibility layer marks the bundled ItemBook file as binary/invalid JavaScript.");
  }
  return result;
}

function hasBlockingAlgorithmicFailures(algorithmic: AlgorithmicPlayability, options: { runtimePassed?: boolean } = {}): boolean {
  if (!algorithmic) return true;
  const runtimePassed: boolean = Boolean(options.runtimePassed);
  const failedChecks = (algorithmic.checks || []).filter((check) => check.severity === "required" && !check.pass);
  const failedFindings = (algorithmic.findings || []).filter((finding) => finding.severity === "fail");
  if (!runtimePassed) return failedChecks.length + failedFindings.length > 0;
  const nonRuntimeProvenChecks = failedChecks.filter((check) => check.id !== "enabled-plugin-files-parse");
  const nonRuntimeProvenFindings = failedFindings.filter((finding) => finding.code !== "enabled-plugin-syntax-error");
  return nonRuntimeProvenChecks.length + nonRuntimeProvenFindings.length > 0;
}

function addAlgorithmCheck(checks: AlgorithmCheck[], id: string, severity: string, pass: unknown, detail: string): void {
  checks.push({ id, severity, pass: Boolean(pass), detail });
}

function addAlgorithmFinding(findings: AlgorithmFinding[], severity: string, code: string, message: string, details: Record<string, unknown> = {}): void {
  findings.push({ severity, code, message, details });
}

function safeResolveDataDir(project: string): string | null {
  try {
    return resolveDataDir(project);
  } catch (e) {
    console.warn('[playability-check] Failed to resolve data dir:', project, e);
    return null;
  }
}

function findIndexHtml(project: string): string | null {
  const candidates: string[] = [
    path.join(project, "www", "index.html"),
    path.join(project, "index.html")
  ];
  return candidates.find((candidate: string) => fs.existsSync(candidate)) || null;
}

function hasCoreJs(project: string): boolean {
  const roots: string[] = [path.join(project, "www"), project];
  const files: string[] = ["js/rpg_core.js", "js/rpg_managers.js", "js/rpg_objects.js", "js/rpg_scenes.js", "js/rpg_sprites.js", "js/rpg_windows.js", "js/main.js"];
  return roots.some((root: string) => files.every((file: string) => fs.existsSync(path.join(root, file))));
}

function addCheck(checks: StaticCheck[], id: string, severity: string, pass: unknown, detail: string): void {
  checks.push({ id, severity, pass: Boolean(pass), detail });
}

function summarizeChecks(checks: StaticCheck[]): PlayabilitySummary {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.pass).length,
    failedRequired: checks.filter((check) => check.severity === "required" && !check.pass).length,
    failedOptional: checks.filter((check) => check.severity === "optional" && !check.pass).length
  };
}

function runRuntimeProbe(project: string, options: { mode: string; timeoutMs: number; browserPath?: string }): RuntimeProbeResult {
  if (options.mode === "nwjs" || options.mode === "auto") {
    const gameExe: string = path.join(project, "Game.exe");
    if (fs.existsSync(gameExe)) return runNwjsSmoke(project, gameExe, options.timeoutMs);
    if (options.mode === "nwjs") {
      return runtimeResult("nwjs", "not-available", `Game.exe was not found at ${gameExe}.`);
    }
  }

  if (options.mode === "browser" || options.mode === "auto") {
    const browserPath: string | null = options.browserPath || findChromiumBrowser();
    if (browserPath) return runBrowserProbe(project, browserPath, options.timeoutMs);
    if (options.mode === "browser") {
      return runtimeResult("browser", "not-available", `No Chromium browser was found. Pass --browser <path> to run this probe.`);
    }
  }

  return runtimeResult("auto", "not-available", "No supported runtime probe was available. Install Chrome/Edge or include Game.exe for automated boot smoke.");
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

function runBrowserProbe(project: string, browserPath: string, timeoutMs: number): RuntimeProbeResult {
  const webRoot: string | null = resolveWebRoot(project);
  if (!webRoot) return runtimeResult("browser", "fail", "No index.html entry was found for browser probing.");
  try {
    const childPath: string = path.join(import.meta.dirname, "browser-probe-child.ts");
    const processResult = childProcess.spawnSync(process.execPath, ["--experimental-strip-types", childPath, webRoot, browserPath, String(timeoutMs)], {
      cwd: project,
      encoding: "utf8",
      timeout: timeoutMs + 8000,
      windowsHide: true
    });
    const parsed = parseChildProbeResult(processResult.stdout as string);
    if (!parsed) {
      return runtimeResult("browser", "fail", "Browser probe child did not return a readable result.", {
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
      probe: (parsed.probe as Record<string, unknown>) || parsed as Record<string, unknown>
    };
  } catch (error) {
    return runtimeResult("browser", "fail", (error as Error).message, {
      browserPath
    });
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
    console.warn('[playability-check] Failed to parse child probe result:', e);
    return null;
  }
}

function resolveWebRoot(project: string): string | null {
  if (fs.existsSync(path.join(project, "www", "index.html"))) return path.join(project, "www");
  if (fs.existsSync(path.join(project, "index.html"))) return project;
  return null;
}

function runNwjsSmoke(project: string, gameExe: string, timeoutMs: number): RuntimeProbeResult {
  try {
    const result = childProcess.spawnSync(gameExe, [], {
      cwd: project,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: "ignore"
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      return {
        attempted: true,
        method: "nwjs",
        status: "pass",
        detail: "Game.exe stayed alive through the boot smoke window.",
        gameExe,
        elapsedMs: timeoutMs
      };
    }
    if (result.error) return runtimeResult("nwjs", "fail", result.error.message, { gameExe });
    return runtimeResult("nwjs", "fail", `Game.exe exited early with code ${result.status}.`, { gameExe, exitCode: result.status });
  } catch (error) {
    return runtimeResult("nwjs", "fail", (error as Error).message, { gameExe });
  }
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

function truncate(value: unknown, limit: number): string {
  const text: string = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export { buildPlayabilityCheck };
