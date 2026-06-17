import fs from "fs";
import path from "path";

import { readJson, writeJson } from "../../rmmv/json.ts";
import { resolveDataDir } from "../../rmmv/project-scanner.ts";
import { runNwjsPlayableProbe } from "../probe/nwjs-playable-probe.ts";
import { resolveCliOutRoot, resolveWorkflowRoot } from "../../workspace-paths.ts";

interface MapScreenshotOptions {
  mapId?: number | string;
  startX?: number;
  startY?: number;
  timeoutMs?: number;
  artifactDir?: string;
}

interface MapScreenshotReport {
  generatedAt: string;
  status: string;
  project?: string;
  mapId: number;
  requestedStart?: { x: number; y: number };
  systemOverrides?: { startMapId: number; startX: number; startY: number };
  timeoutMs?: number;
  artifactDir: string;
  screenshot: string | null;
  probe: unknown;
  blocker: string | null;
  outDir?: string;
}

interface ProbeArtifact {
  screenPng?: string;
}

interface ProbeResult {
  status: string;
  detail?: string;
  artifacts?: ProbeArtifact;
  probe?: { screen?: { nonBlank: boolean; uniqueColors?: number } };
  [key: string]: unknown;
}

interface SystemData {
  startMapId: number;
  startX: number;
  startY: number;
  [key: string]: unknown;
}

interface MapData {
  width: number;
  height: number;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 30000;

function runMapScreenshot(projectRoot: string, options: MapScreenshotOptions = {}): MapScreenshotReport {
  const project = path.resolve(projectRoot);
  const mapId = Number(options.mapId);
  if (!Number.isInteger(mapId) || mapId < 1) {
    throw new Error("map-screenshot requires --map-id <positive integer>.");
  }
  const startX = Number.isInteger(options.startX) ? options.startX! : null;
  const startY = Number.isInteger(options.startY) ? options.startY! : null;
  if (startX === null || startY === null) {
    throw new Error("map-screenshot requires --start-x and --start-y so the player lands on a passable tile.");
  }
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const artifactDir = options.artifactDir
    ? path.resolve(options.artifactDir)
    : path.join(resolveCliOutRoot(resolveWorkflowRoot(process.cwd())), `map-${String(mapId).padStart(3, "0")}-screenshot`);
  fs.mkdirSync(artifactDir, { recursive: true });

  const dataDir = resolveDataDir(project);
  const systemPath = path.join(dataDir, "System.json");
  const mapPath = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
  if (!fs.existsSync(systemPath)) {
    return failureReport(mapId, artifactDir, `System.json not found at ${systemPath}.`);
  }
  if (!fs.existsSync(mapPath)) {
    return failureReport(mapId, artifactDir, `Target map file not found: ${mapPath}.`);
  }

  const mapData: MapData = readJson(mapPath) as MapData;
  if (!validateMapBounds(mapData, startX, startY)) {
    return failureReport(mapId, artifactDir,
      `Start coordinate (${startX},${startY}) is outside Map${mapId} bounds ${mapData.width}x${mapData.height}.`);
  }

  const systemBackup = fs.readFileSync(systemPath);
  const originalSystem: SystemData = readJson(systemPath) as SystemData;
  const overrides = {
    startMapId: mapId,
    startX: startX!,
    startY: startY!
  };
  const generatedAt = new Date().toISOString();

  let probeResult: ProbeResult | null = null;
  let blocker: string | null = null;

  try {
    const mutated: SystemData = {
      ...originalSystem,
      startMapId: overrides.startMapId,
      startX: overrides.startX,
      startY: overrides.startY
    };
    writeJson(systemPath, mutated);
    probeResult = runNwjsPlayableProbe(project, {
      timeoutMs,
      artifactDir
    }) as unknown as ProbeResult;
  } catch (error: unknown) {
    blocker = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      fs.writeFileSync(systemPath, systemBackup);
    } catch (restoreError: unknown) {
      const msg = restoreError instanceof Error ? restoreError.message : String(restoreError);
      blocker = (blocker ? `${blocker}; ` : "") + `Failed to restore System.json: ${msg}`;
    }
  }

  const screenPath: string | undefined = probeResult && probeResult.artifacts && probeResult.artifacts.screenPng || undefined;
  const status = deriveStatus(probeResult, blocker, screenPath);

  const report: MapScreenshotReport = {
    generatedAt,
    status,
    project,
    mapId,
    requestedStart: { x: startX, y: startY },
    systemOverrides: overrides,
    timeoutMs,
    artifactDir,
    screenshot: screenPath && fs.existsSync(screenPath) ? screenPath : null,
    probe: probeResult,
    blocker: blocker || (probeResult && probeResult.status === "not-available" ? (probeResult.detail as string) || null : null)
  };

  const reportPath = path.join(artifactDir, "map-screenshot.json");
  writeJson(reportPath, report);
  fs.writeFileSync(path.join(artifactDir, "map-screenshot.md"), renderReportMarkdown(report), "utf8");

  return report;
}

function deriveStatus(probeResult: ProbeResult | null, blocker: string | null, screenPath: string | undefined): string {
  if (blocker) return "blocked";
  if (!probeResult) return "blocked";
  if (probeResult.status === "not-available") return "blocked";
  if (!screenPath || !fs.existsSync(screenPath)) {
    return probeResult.status === "pass" ? "review" : "blocked";
  }
  if (probeResult.status === "pass") return "pass";
  if (probeResult.status === "review") return "review";
  return "review";
}

function validateMapBounds(mapData: MapData | null, startX: number, startY: number): boolean {
  if (!mapData || !Number.isInteger(mapData.width) || !Number.isInteger(mapData.height)) return false;
  return startX >= 0 && startX < mapData.width && startY >= 0 && startY < mapData.height;
}

function failureReport(mapId: number, artifactDir: string, message: string): MapScreenshotReport {
  const report: MapScreenshotReport = {
    generatedAt: new Date().toISOString(),
    status: "blocked",
    mapId,
    artifactDir,
    blocker: message,
    screenshot: null,
    probe: null
  };
  fs.mkdirSync(artifactDir, { recursive: true });
  writeJson(path.join(artifactDir, "map-screenshot.json"), report);
  fs.writeFileSync(path.join(artifactDir, "map-screenshot.md"), renderReportMarkdown(report), "utf8");
  return report;
}

function renderReportMarkdown(report: MapScreenshotReport): string {
  const lines: string[] = [];
  lines.push("# Map Screenshot Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Map: ${report.mapId}`);
  if (report.requestedStart) lines.push(`- Requested start: (${report.requestedStart.x}, ${report.requestedStart.y})`);
  if (report.screenshot) lines.push(`- Screenshot: ${report.screenshot}`);
  else lines.push("- Screenshot: (none — see blocker below)");
  if (report.blocker) lines.push(`- Blocker: ${report.blocker}`);
  const probe = report.probe as ProbeResult | null;
  if (probe && probe.detail) lines.push(`- Probe detail: ${probe.detail}`);
  if (probe && probe.probe && probe.probe.screen) {
    const screen = probe.probe.screen;
    lines.push(`- Screen nonBlank: ${screen.nonBlank}`);
    if (screen.uniqueColors !== undefined) lines.push(`- Unique colors sampled: ${screen.uniqueColors}`);
  }
  lines.push("");
  lines.push("## How to use this");
  lines.push("");
  lines.push(`Attach ${report.screenshot || "<screenshot-path>"} to a new desktop opencode session for visual review.`);
  lines.push("");
  return lines.join("\n");
}

export {
  runMapScreenshot
};
