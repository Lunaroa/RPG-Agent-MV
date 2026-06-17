import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface PlayabilityCheckItem {
  pass: boolean;
  id: string;
  severity: string;
  detail: string;
}

interface AlgorithmicStart {
  mapId: number;
  mapName?: string;
  x: number;
  y: number;
  tileClass: string;
  reachableTiles: number;
  walkableTiles: number;
}

interface AlgorithmicTransfers {
  validDirect: number;
  direct: number;
  blockedDirectTargets: number;
  variable: number;
}

interface AlgorithmicPlugins {
  enabled: number;
  syntaxChecked: number;
  syntaxErrors: number;
  missingFiles: number;
  runtimeSkipped?: number;
  bootCompat?: boolean;
}

interface AlgorithmicFinding {
  severity: string;
  code: string;
  message: string;
}

interface AlgorithmicSection {
  status: string;
  start?: AlgorithmicStart;
  transfers?: AlgorithmicTransfers;
  plugins?: AlgorithmicPlugins;
  checks?: PlayabilityCheckItem[];
  findings?: AlgorithmicFinding[];
}

interface ProbeScreen {
  exists: boolean;
  nonBlank: boolean;
  width?: number;
  height?: number;
  nonBlankPixels?: number;
  sampledPixels?: number;
}

interface ProbeMap {
  sceneName?: string;
  currentMapId?: number;
  expectedStartMapId?: number;
  onStartMap?: boolean;
}

interface ProbeEvents {
  complete?: boolean;
  eventRunning?: boolean;
  interpreterRunning?: boolean;
  messageBusy?: boolean;
  playerCanMove?: boolean;
}

interface DeepProbe {
  screen?: ProbeScreen;
  map?: ProbeMap;
  events?: ProbeEvents;
}

interface PlayableSection {
  attempted: boolean;
  method?: string;
  status?: string;
  detail?: string;
  artifacts?: { screenPng?: string };
  probe?: DeepProbe;
}

interface RuntimeProbe {
  sceneName?: string;
  canvas?: boolean;
  ready?: boolean;
}

interface RuntimeSection {
  attempted?: boolean;
  method?: string;
  status?: string;
  detail?: string;
  browserPath?: string;
  gameExe?: string;
  error?: string;
  signal?: string;
  probe?: RuntimeProbe;
}

interface PlayabilityCheck {
  generatedAt: string;
  projectRoot: string;
  mode: string;
  status: string;
  checks?: PlayabilityCheckItem[];
  algorithmic?: AlgorithmicSection;
  playable?: PlayableSection;
  runtime?: RuntimeSection;
  limitations?: string[];
}

function writePlayabilityCheckOutputs(report: PlayabilityCheck, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "playability-check.json"), report);
  fs.writeFileSync(path.join(outDir, "playability-check.md"), renderPlayabilityCheck(report), "utf8");
}

function renderPlayabilityCheck(report: PlayabilityCheck): string {
  const lines = [];
  lines.push("# Playability Check");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Project: ${report.projectRoot}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Status: ${report.status}`);
  lines.push("");
  lines.push("## Static Checks");
  lines.push("");
  for (const check of report.checks || []) {
    lines.push(`- [${check.pass ? "pass" : "fail"}] ${check.id} (${check.severity}): ${check.detail}`);
  }
  lines.push("");
  if (report.algorithmic) {
    lines.push("## Algorithmic Playability");
    lines.push("");
    lines.push(`- Status: ${report.algorithmic.status}`);
    if (report.algorithmic.start) {
      const start = report.algorithmic.start;
      lines.push(`- Start: map ${start.mapId}:${start.mapName || "(unnamed)"} (${start.x},${start.y}), tile=${start.tileClass}, reachable=${start.reachableTiles}/${start.walkableTiles}`);
    }
    if (report.algorithmic.transfers) {
      const transfers = report.algorithmic.transfers;
      lines.push(`- Direct transfers: ${transfers.validDirect}/${transfers.direct} valid, blocked targets=${transfers.blockedDirectTargets}, variable transfers=${transfers.variable}`);
    }
    if (report.algorithmic.plugins) {
      const plugins = report.algorithmic.plugins;
      const skipped = plugins.runtimeSkipped ? `, runtime skipped=${plugins.runtimeSkipped}` : "";
      const compat = plugins.bootCompat ? ", boot compat=yes" : "";
      lines.push(`- Enabled plugins: ${plugins.enabled}; syntax checked=${plugins.syntaxChecked}, syntax errors=${plugins.syntaxErrors}, missing files=${plugins.missingFiles}${skipped}${compat}`);
    }
    lines.push("");
    lines.push("### Algorithm Checks");
    lines.push("");
    for (const check of report.algorithmic.checks || []) {
      lines.push(`- [${check.pass ? "pass" : "fail"}] ${check.id} (${check.severity}): ${check.detail}`);
    }
    if (report.algorithmic.findings && report.algorithmic.findings.length) {
      lines.push("");
      lines.push("### Algorithm Findings");
      lines.push("");
      for (const finding of report.algorithmic.findings) {
        lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
      }
    }
    lines.push("");
  }
  if (report.playable) {
    lines.push("## Deep Playable Probe");
    lines.push("");
    const playable = report.playable;
    lines.push(`- Attempted: ${playable.attempted ? "yes" : "no"}`);
    lines.push(`- Method: ${playable.method || "(none)"}`);
    lines.push(`- Status: ${playable.status || "(unknown)"}`);
    if (playable.detail) lines.push(`- Detail: ${playable.detail}`);
    if (playable.artifacts && playable.artifacts.screenPng) lines.push(`- Screen evidence: ${playable.artifacts.screenPng}`);
    const probe = playable.probe || {};
    if (probe.screen) {
      lines.push(`- Screen: exists=${probe.screen.exists ? "yes" : "no"}, nonBlank=${probe.screen.nonBlank ? "yes" : "no"}, size=${probe.screen.width || 0}x${probe.screen.height || 0}, sampled=${probe.screen.nonBlankPixels || 0}/${probe.screen.sampledPixels || 0}`);
    }
    if (probe.map) {
      lines.push(`- Map: scene=${probe.map.sceneName || "(none)"}, current=${probe.map.currentMapId || 0}, expected=${probe.map.expectedStartMapId || 0}, onStartMap=${probe.map.onStartMap ? "yes" : "no"}`);
    }
    if (probe.events) {
      lines.push(`- Events idle: ${probe.events.complete ? "yes" : "no"}; eventRunning=${probe.events.eventRunning ? "yes" : "no"}, interpreterRunning=${probe.events.interpreterRunning ? "yes" : "no"}, messageBusy=${probe.events.messageBusy ? "yes" : "no"}, playerCanMove=${probe.events.playerCanMove ? "yes" : "no"}`);
    }
    lines.push("");
  }
  lines.push("## Runtime Probe");
  lines.push("");
  const runtime = report.runtime || {};
  lines.push(`- Attempted: ${runtime.attempted ? "yes" : "no"}`);
  lines.push(`- Method: ${runtime.method || "(none)"}`);
  lines.push(`- Status: ${runtime.status || "(unknown)"}`);
  if (runtime.detail) lines.push(`- Detail: ${runtime.detail}`);
  if (runtime.browserPath) lines.push(`- Browser: ${runtime.browserPath}`);
  if (runtime.gameExe) lines.push(`- Game.exe: ${runtime.gameExe}`);
  if (runtime.error) lines.push(`- Error: ${runtime.error}`);
  if (runtime.signal) lines.push(`- Signal: ${runtime.signal}`);
  if (runtime.probe) {
    lines.push(`- Probe scene: ${runtime.probe.sceneName || "(none)"}`);
    lines.push(`- Probe canvas: ${runtime.probe.canvas ? "yes" : "no"}`);
    lines.push(`- Probe ready: ${runtime.probe.ready ? "yes" : "no"}`);
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const item of report.limitations || []) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export { writePlayabilityCheckOutputs };
