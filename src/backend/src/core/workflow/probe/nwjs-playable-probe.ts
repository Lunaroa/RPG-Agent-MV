import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import zlib from "node:zlib";

interface BackupEntry {
  filePath: string;
  existed: boolean;
  content: Buffer | null;
}

interface ProbeResult {
  status: string;
  detail?: string;
  screen?: ScreenEvidence;
  map?: MapProbe;
  events?: EventProbe;
  runtimeJsErrors?: RuntimeJsErrorEvidence[];
  failureClassification?: ProbeFailureClassification;
  [key: string]: unknown;
}

interface ScreenEvidence {
  width?: number;
  height?: number;
  sampledPixels?: number;
  nonBlankPixels?: number;
  nonBlank?: boolean;
  exists?: boolean;
  screenshotWritten?: boolean;
  source?: string;
  decodeError?: string;
}

interface MapProbe {
  onStartMap?: boolean;
  player?: PlayerProbe;
  [key: string]: unknown;
}

interface PlayerProbe {
  visible?: boolean;
  characterName?: string;
  [key: string]: unknown;
}

interface EventProbe {
  complete?: boolean;
  [key: string]: unknown;
}

interface RuntimeJsErrorEvidence {
  message: string;
  type?: string;
  source?: string;
  sourceKind: "rmmv-plugin" | "rmmv-engine" | "probe-script" | "unknown";
  relativePath?: string;
  fileName?: string;
  pluginName?: string;
  line?: number;
  column?: number;
  stack?: string;
}

interface ProbeFailureClassification {
  code: "project-runtime-js-error" | "probe-runtime-js-error" | "runtime-js-error";
  causedBy: "rmmv-project" | "agent-rpg-probe" | "unknown";
  detail: string;
  blocksSceneMap: boolean;
  blocksStartMap: boolean;
  blocksPlayableState: boolean;
  sceneName?: string;
  expectedStartMapId?: number;
  currentMapId?: number;
  errorCount: number;
  primaryError?: RuntimeJsErrorEvidence;
}

interface PngImage {
  width: number;
  height: number;
  pixels: Buffer;
}

export interface NwjsPlayableProbeOptions {
  timeoutMs?: number;
  artifactDir?: string;
  command?: {
    executable: string;
    args: string[];
    cwd?: string;
  };
  stdoutPath?: string;
  stderrPath?: string;
}

export interface NwjsPlayableProbeResult {
  attempted: boolean;
  method: string;
  status: string;
  detail: string;
  gameExe?: string;
  probe?: ProbeResult;
  artifacts?: Artifacts;
  runnerStarted?: boolean;
  processExited?: boolean;
  timedOut?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  [key: string]: unknown;
}

interface Artifacts {
  resultJson: string;
  screenPng: string | null;
  stdout?: string | null;
  stderr?: string | null;
}

function runNwjsPlayableProbe(projectRoot: string, options: NwjsPlayableProbeOptions = {}): NwjsPlayableProbeResult {
  const project: string = path.resolve(projectRoot);
  const command = options.command || {
    executable: path.join(project, "Game.exe"),
    args: ["--disable-audio"],
    cwd: project,
  };
  const sourceExe: string = path.resolve(command.executable);
  if (!fs.existsSync(sourceExe)) {
    return runtimeResult("nwjs-playable", "not-available", `Probe runner was not found at ${sourceExe}.`, {
      runnerStarted: false,
      processExited: false,
      timedOut: false,
    });
  }

  const timeoutMs: number = options.timeoutMs || 15000;
  const tempRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-playable-probe-"));
  const artifactDir: string = options.artifactDir ? path.resolve(options.artifactDir) : tempRoot;
  fs.mkdirSync(artifactDir, { recursive: true });
  const resultPath: string = path.join(artifactDir, "nwjs-playable-probe.json");
  const screenPath: string = path.join(artifactDir, "nwjs-playable-screen.png");
  const webRoot = resolveProbeWebRoot(project);
  const indexRel = normalizeRel(path.relative(project, path.join(webRoot, "index.html")));
  const probeRel = normalizeRel(path.relative(project, path.join(webRoot, "js", "AIWF_PlayableProbe.js")));
  const backups: BackupEntry[] = backupProbeFiles(project, [indexRel, probeRel]);
  const stdoutFd = options.stdoutPath ? openProbeFd(options.stdoutPath) : "ignore";
  const stderrFd = options.stderrPath ? openProbeFd(options.stderrPath) : "ignore";
  let runnerStarted = false;
  let processExited = false;
  let timedOut = false;
  let exitCode: number | null = null;
  let signal: string | null = null;
  const cleanup: Array<() => void> = [];
  if (typeof stdoutFd === "number") {
    cleanup.push(() => {
      try {
        fs.closeSync(stdoutFd);
      } catch {
        // noop
      }
    });
  }
  if (typeof stderrFd === "number") {
    cleanup.push(() => {
      try {
        fs.closeSync(stderrFd);
      } catch {
        // noop
      }
    });
  }

  try {
    injectProbe(webRoot, resultPath, screenPath, timeoutMs);
    const child = childProcess.spawn(command.executable, command.args, {
      cwd: command.cwd || project,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd]
    });
    runnerStarted = true;
    const probe: ProbeResult = waitForProbeResult(resultPath, child, timeoutMs + 6000);
    timedOut = isProbeTimedOut(probe);
    const processResult = ensureProcessStopped(child, timedOut ? 3000 : 2000);
    processExited = processResult.exited;
    exitCode = processResult.exitCode;
    signal = processResult.signal;
    stopProcess(child);
    enrichProbeWithScreenEvidence(probe, screenPath);
    enrichProbeWithFailureClassification(probe);
    persistProbeResult(resultPath, probe);
    const status: string = normalizeProbeStatus(probe);
    return {
      attempted: true,
      method: "nwjs-playable",
      status,
      detail: probe.detail || detailForProbeStatus(status),
      gameExe: sourceExe,
      runnerStarted,
      processExited,
      timedOut,
      exitCode,
      signal,
      probe,
      artifacts: {
        resultJson: resultPath,
        screenPng: fs.existsSync(screenPath) ? screenPath : null,
        stdout: options.stdoutPath ? path.resolve(options.stdoutPath) : null,
        stderr: options.stderrPath ? path.resolve(options.stderrPath) : null,
      }
    };
  } catch (error) {
    return runtimeResult("nwjs-playable", "fail", (error as Error).message, {
      gameExe: sourceExe,
      runnerStarted,
      processExited,
      timedOut,
      exitCode,
      signal,
      artifacts: {
        resultJson: resultPath,
        screenPng: fs.existsSync(screenPath) ? screenPath : null,
        stdout: options.stdoutPath ? path.resolve(options.stdoutPath) : null,
        stderr: options.stderrPath ? path.resolve(options.stderrPath) : null,
      }
    });
  } finally {
    for (const task of cleanup) task();
    restoreProbeFiles(backups);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('[nwjs-playable-probe] Failed to cleanup temp dir:', tempRoot, e);
    }
  }
}

function backupProbeFiles(project: string, relativePaths: string[]): BackupEntry[] {
  return relativePaths.map((relativePath: string): BackupEntry => {
    const filePath: string = path.join(project, relativePath);
    return {
      filePath,
      existed: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
    };
  });
}

function restoreProbeFiles(backups: BackupEntry[]): void {
  for (const backup of backups.slice().reverse()) {
    if (backup.existed) {
      fs.mkdirSync(path.dirname(backup.filePath), { recursive: true });
      fs.writeFileSync(backup.filePath, backup.content!);
    } else {
      fs.rmSync(backup.filePath, { force: true });
    }
  }
}

function injectProbe(webRoot: string, resultPath: string, screenPath: string, timeoutMs: number): void {
  const indexPath: string = path.join(webRoot, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`Cannot inject playable probe; index.html not found at ${indexPath}`);
  const probePath: string = path.join(webRoot, "js", "AIWF_PlayableProbe.js");
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, renderProbeScript(resultPath, screenPath, timeoutMs), "utf8");
  const html: string = fs.readFileSync(indexPath, "utf8");
  if (html.includes("AIWF_PlayableProbe.js")) return;
  const scriptTag = '        <script type="text/javascript" src="js/AIWF_PlayableProbe.js"></script>\n';
  const marker = /(\s*<script[^>]+src=["']js\/main\.js["'][^>]*><\/script>)/i;
  const nextHtml: string = marker.test(html)
    ? html.replace(marker, `${scriptTag}$1`)
    : html.replace(/<\/body>/i, `${scriptTag}</body>`);
  fs.writeFileSync(indexPath, nextHtml, "utf8");
}

function resolveProbeWebRoot(project: string): string {
  const candidates = [path.join(project, "www"), project];
  const webRoot = candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html")));
  if (!webRoot) throw new Error(`Cannot locate RMMV index.html under ${project} or ${path.join(project, "www")}.`);
  return webRoot;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function waitForProbeResult(resultPath: string, child: childProcess.ChildProcess, timeoutMs: number): ProbeResult {
  const deadline: number = Date.now() + timeoutMs;
  let last: ProbeResult | null = null;
  while (Date.now() < deadline) {
  if (fs.existsSync(resultPath)) {
      try {
        last = JSON.parse(fs.readFileSync(resultPath, "utf8")) as ProbeResult;
        if (last.status && last.status !== "running") return last;
      } catch (e) {
        console.warn('[nwjs-playable-probe] Failed to parse probe result, retrying:', e);
      }
    }
    if (child.exitCode !== null) {
      return last || { status: "fail", detail: `Runner exited before playable probe finished with code ${child.exitCode}.` };
    }
    sleep(250);
  }
  return {
    status: "fail",
    timedOut: true,
    detail: last && last.detail
      ? `Timed out before playable probe produced a final result: ${last.detail}`
      : "Timed out before playable probe produced a final result.",
  };
}

export function ensureProcessStopped(
  child: childProcess.ChildProcess,
  timeoutMs: number,
): { exited: boolean; exitCode: number | null; signal: string | null } {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline && isProcessAlive(child)) {
    stopProcess(child);
    sleep(100);
  }
  return {
    exited: !isProcessAlive(child),
    exitCode: child.exitCode,
    signal: child.signalCode ? String(child.signalCode) : null,
  };
}

function isProcessAlive(child: childProcess.ChildProcess): boolean {
  if (!child.pid) return false;
  if (child.exitCode !== null) return false;
  if (process.platform === "win32") return isWindowsProcessAlive(child.pid);
  try {
    child.kill(0);
    return true;
  } catch {
    return false;
  }
}

function isWindowsProcessAlive(pid: number): boolean {
  const result = childProcess.spawnSync("tasklist", [
    "/FI",
    "PID eq " + pid,
    "/FO",
    "CSV",
    "/NH",
  ], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || "exit " + result.status;
    throw new Error("tasklist failed while checking PID " + pid + ": " + detail);
  }
  return String(result.stdout || "")
    .split(/\r?\n/)
    .some((line) => {
      const match = /^"[^"]*","(\d+)"/.exec(line.trim());
      return match?.[1] === String(pid);
    });
}

function stopProcess(child: childProcess.ChildProcess): void {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch (e) {
    // Fall through to taskkill.
    console.warn('[nwjs-playable-probe] Failed to kill child process, falling back to taskkill:', e);
  }
  if (process.platform === "win32" && child.pid) {
    childProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
  }
}

function normalizeProbeStatus(probe: ProbeResult): string {
  if (!probe || probe.status === "fail") return "fail";
  if (probe.status === "pass") return "pass";
  if (probe.status === "review") return "review";
  return "fail";
}

function enrichProbeWithScreenEvidence(probe: ProbeResult, screenPath: string): void {
  if (!probe || !fs.existsSync(screenPath)) return;
  const evidence: ScreenEvidence | null = analyzePngNonBlank(screenPath);
  if (!evidence) return;
  probe.screen = {
    ...(probe.screen || {}),
    ...evidence,
    exists: true,
    screenshotWritten: true
  };
  if (normalizeRuntimeJsErrors(probe.errors).length > 0) return;
  const playerVisible = probe.map && probe.map.player && probe.map.player.visible && probe.map.player.characterName;
  if (probe.status === "fail" && probe.screen.nonBlank && probe.map && probe.map.onStartMap && playerVisible && probe.events && probe.events.complete) {
    probe.status = "pass";
    probe.detail = "Screen evidence rendered, visible player loaded on the start map, and the start event loop became idle.";
  } else if (probe.status === "fail" && probe.screen.nonBlank && probe.map && probe.map.onStartMap) {
    probe.status = "review";
    probe.detail = "Screen evidence and start map rendered, but player visibility or event completion needs review.";
  }
}

function enrichProbeWithFailureClassification(probe: ProbeResult): void {
  if (!probe) return;
  const errors = normalizeRuntimeJsErrors(probe.errors);
  if (errors.length === 0) return;
  probe.runtimeJsErrors = errors;
  const map = recordValue(probe.map);
  const sceneName = stringValue(probe.sceneName) || stringValue(map.sceneName);
  const expectedStartMapId = numberValue(map.expectedStartMapId);
  const currentMapId = numberValue(map.currentMapId);
  const projectErrors = errors.filter((error) => error.sourceKind === "rmmv-plugin" || error.sourceKind === "rmmv-engine");
  const probeErrors = errors.filter((error) => error.sourceKind === "probe-script");
  const causedBy = projectErrors.length > 0
    ? "rmmv-project"
    : probeErrors.length === errors.length
      ? "agent-rpg-probe"
      : "unknown";
  const code = causedBy === "rmmv-project"
    ? "project-runtime-js-error"
    : causedBy === "agent-rpg-probe"
      ? "probe-runtime-js-error"
      : "runtime-js-error";
  const primaryError = projectErrors[0] || errors[0];
  const blocksSceneMap = sceneName !== "Scene_Map";
  const blocksStartMap = map.onStartMap !== true;
  const detail = `${causedBy === "rmmv-project" ? "Project runtime" : causedBy === "agent-rpg-probe" ? "Probe runtime" : "Runtime"} JavaScript error blocked playable proof${blocksSceneMap ? " before Scene_Map" : ""}: ${formatRuntimeJsError(primaryError)}`;
  probe.failureClassification = {
    code,
    causedBy,
    detail,
    blocksSceneMap,
    blocksStartMap,
    blocksPlayableState: true,
    sceneName,
    expectedStartMapId,
    currentMapId,
    errorCount: errors.length,
    primaryError,
  };
  if (probe.status === "fail") probe.detail = detail;
}

function normalizeRuntimeJsErrors(value: unknown): RuntimeJsErrorEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeRuntimeJsError(recordValue(entry)))
    .filter((entry): entry is RuntimeJsErrorEvidence => Boolean(entry));
}

function normalizeRuntimeJsError(entry: Record<string, unknown>): RuntimeJsErrorEvidence | null {
  const message = stringValue(entry.message) || "unknown runtime error";
  const source = stringValue(entry.source);
  const relativePath = source ? sourceToProjectRelativePath(source) : undefined;
  const fileName = relativePath ? path.basename(relativePath) : source ? path.basename(source) : undefined;
  const sourceKind = classifyRuntimeErrorSource(source, relativePath);
  const pluginName = sourceKind === "rmmv-plugin" && fileName ? fileName.replace(/\.js$/i, "") : undefined;
  return {
    message,
    type: runtimeErrorType(message, stringValue(entry.stack)),
    source,
    sourceKind,
    relativePath,
    fileName,
    pluginName,
    line: numberValue(entry.line),
    column: numberValue(entry.column),
    stack: stringValue(entry.stack),
  };
}

function sourceToProjectRelativePath(source: string): string | undefined {
  const normalized = decodeURIComponent(source).replace(/\\/g, "/");
  const wwwIndex = normalized.indexOf("/www/");
  if (wwwIndex >= 0) return normalized.slice(wwwIndex + 1);
  const jsIndex = normalized.indexOf("/js/");
  if (jsIndex >= 0) return normalized.slice(jsIndex + 1);
  return undefined;
}

function classifyRuntimeErrorSource(
  source: string | undefined,
  relativePath: string | undefined,
): RuntimeJsErrorEvidence["sourceKind"] {
  if (source === "AIWF_PlayableProbe" || relativePath?.includes("AIWF_PlayableProbe.js")) return "probe-script";
  if (relativePath?.startsWith("www/js/plugins/") || relativePath?.startsWith("js/plugins/")) return "rmmv-plugin";
  if (relativePath?.startsWith("www/js/") || relativePath?.startsWith("js/")) return "rmmv-engine";
  return "unknown";
}

function runtimeErrorType(message: string, stack: string | undefined): string | undefined {
  const match = /(?:Uncaught\s+)?([A-Za-z_$][\w$]*Error)\b/.exec(message) || (stack ? /^([A-Za-z_$][\w$]*Error)\b/.exec(stack) : null);
  return match ? match[1] : undefined;
}

function formatRuntimeJsError(error: RuntimeJsErrorEvidence | undefined): string {
  if (!error) return "unknown runtime error";
  const location = error.relativePath || error.source || "unknown source";
  const line = error.line ? `:${error.line}${error.column ? `:${error.column}` : ""}` : "";
  return `${error.type ? `${error.type}: ` : ""}${error.message} (${location}${line})`;
}

function persistProbeResult(resultPath: string, probe: ProbeResult): void {
  try {
    fs.writeFileSync(resultPath, JSON.stringify(probe, null, 2), "utf8");
  } catch (e) {
    console.warn('[nwjs-playable-probe] Failed to persist enriched probe result:', e);
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function analyzePngNonBlank(filePath: string): ScreenEvidence | null {
  let png: PngImage;
  try {
    png = decodePng(fs.readFileSync(filePath));
  } catch (e) {
    console.warn('[nwjs-playable-probe] Failed to decode PNG:', filePath, e);
    return {
      exists: true,
      decodeError: e instanceof Error ? e.message : String(e),
      source: "png-screen-evidence",
    };
  }
  const maxSamples: number = 4096;
  const stride: number = Math.max(1, Math.floor((png.width * png.height) / maxSamples));
  let sampledPixels: number = 0;
  let nonBlankPixels: number = 0;
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    sampledPixels += 1;
    const offset: number = pixel * 4;
    const alpha: number = png.pixels[offset + 3];
    const red: number = png.pixels[offset];
    const green: number = png.pixels[offset + 1];
    const blue: number = png.pixels[offset + 2];
    if (alpha > 0 && (red > 8 || green > 8 || blue > 8)) nonBlankPixels += 1;
  }
  return {
    width: png.width,
    height: png.height,
    sampledPixels,
    nonBlankPixels,
    nonBlank: nonBlankPixels > 8,
    source: "png-screen-evidence"
  };
}

function decodePng(buffer: Buffer): PngImage {
  const signature: string = "89504e470d0a1a0a";
  if (buffer.slice(0, 8).toString("hex") !== signature) throw new Error("Not a PNG file.");
  let offset: number = 8;
  let width: number = 0;
  let height: number = 0;
  let bitDepth: number = 0;
  let colorType: number = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length: number = buffer.readUInt32BE(offset);
    const type: string = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data: Buffer = buffer.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  const channels: number = channelsForPngColorType(colorType);
  const inflated: Buffer = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes: number = width * channels;
  const pixels: Buffer = Buffer.alloc(width * height * 4);
  let inputOffset: number = 0;
  let previous: Buffer = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter: number = inflated[inputOffset];
    inputOffset += 1;
    const row: Buffer = Buffer.from(inflated.slice(inputOffset, inputOffset + rowBytes));
    inputOffset += rowBytes;
    unfilterPngRow(row, previous, channels, filter);
    for (let x = 0; x < width; x += 1) {
      const source: number = x * channels;
      const target: number = (y * width + x) * 4;
      if (colorType === 0) {
        pixels[target] = row[source];
        pixels[target + 1] = row[source];
        pixels[target + 2] = row[source];
        pixels[target + 3] = 255;
      } else if (colorType === 2) {
        pixels[target] = row[source];
        pixels[target + 1] = row[source + 1];
        pixels[target + 2] = row[source + 2];
        pixels[target + 3] = 255;
      } else if (colorType === 4) {
        pixels[target] = row[source];
        pixels[target + 1] = row[source];
        pixels[target + 2] = row[source];
        pixels[target + 3] = row[source + 1];
      } else if (colorType === 6) {
        pixels[target] = row[source];
        pixels[target + 1] = row[source + 1];
        pixels[target + 2] = row[source + 2];
        pixels[target + 3] = row[source + 3];
      }
    }
    previous = row;
  }
  return { width, height, pixels };
}

function channelsForPngColorType(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type: ${colorType}`);
}

function unfilterPngRow(row: Buffer, previous: Buffer, bytesPerPixel: number, filter: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left: number = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up: number = previous[index] || 0;
    const upLeft: number = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + up) & 0xff;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate: number = left + up - upLeft;
  const distanceLeft: number = Math.abs(estimate - left);
  const distanceUp: number = Math.abs(estimate - up);
  const distanceUpLeft: number = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

function detailForProbeStatus(status: string): string {
  if (status === "pass") return "NW.js playable probe rendered the start map and the start event loop became idle.";
  if (status === "review") return "NW.js playable probe rendered a screen and map, but event completion needs review.";
  return "NW.js playable probe failed.";
}

function sleep(ms: number): void {
  const until: number = Date.now() + ms;
  while (Date.now() < until) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, until - Date.now()));
  }
}

function openProbeFd(targetPath: string): number | "ignore" {
  const filePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.openSync(filePath, "a");
}

function isProbeTimedOut(probe: ProbeResult): boolean {
  return Boolean(probe && (
    probe.status === "running" ||
    probe.timedOut === true
  ));
}

function runtimeResult(method: string, status: string, detail: string, extra: Record<string, unknown> = {}): NwjsPlayableProbeResult {
  return {
    attempted: status !== "not-available",
    method,
    status,
    detail,
    ...extra
  };
}

export function renderProbeScript(resultPath: string, screenPath: string, timeoutMs: number): string {
  return `/* eslint-disable */
(function () {
  var fs = null;
  try { fs = require("fs"); } catch (_error) {}
  var resultPath = ${JSON.stringify(resultPath)};
  var screenPath = ${JSON.stringify(screenPath)};
  var startedAt = Date.now();
  var timeoutMs = ${JSON.stringify(timeoutMs)};
  var errors = [];
  var lastErrorPrinterText = "";
  var engineErrorHookInstalled = false;
  var launchedMap = false;
  var firstMapAt = 0;
  var captureInFlight = false;
  window.addEventListener("error", function (event) {
    errors.push({
      message: String(event.message || event.error || "unknown error"),
      source: event.filename || "",
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 1000) : ""
    });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    errors.push({
      message: String(reason && reason.message || reason || "unhandled rejection"),
      source: "unhandledrejection",
      line: 0,
      column: 0,
      stack: reason && reason.stack ? String(reason.stack).slice(0, 1000) : ""
    });
  });
  function recordHandledRuntimeError(error, source) {
    var message = String(error && error.message || error || "unknown error");
    var stack = error && error.stack ? String(error.stack).slice(0, 1000) : "";
    var duplicate = errors.some(function (entry) {
      return entry.source === source && entry.message === message && entry.stack === stack;
    });
    if (duplicate) return;
    errors.push({
      message: message,
      source: source,
      line: 0,
      column: 0,
      stack: stack
    });
  }
  function installEngineErrorHook() {
    if (engineErrorHookInstalled || !window.SceneManager || typeof window.SceneManager.catchException !== "function") return;
    var originalCatchException = window.SceneManager.catchException;
    window.SceneManager.catchException = function (error) {
      recordHandledRuntimeError(error, "SceneManager.catchException");
      return originalCatchException.apply(this, arguments);
    };
    engineErrorHookInstalled = true;
  }
  function captureRmmvErrorPrinter() {
    var graphicsPrinter = window.Graphics && window.Graphics._errorPrinter;
    var domPrinter = typeof document.getElementById === "function" && document.getElementById("ErrorPrinter");
    var printer = graphicsPrinter || domPrinter;
    var text = printer && String(printer.innerText || printer.textContent || "").replace(/\\s+/g, " ").trim();
    if (!text || text === lastErrorPrinterText) return;
    lastErrorPrinterText = text;
    errors.push({
      message: text.slice(0, 1000),
      source: "RMMV_ErrorPrinter",
      line: 0,
      column: 0,
      stack: ""
    });
  }
  function write(result) {
    result.generatedAt = new Date().toISOString();
    result.elapsedMs = Date.now() - startedAt;
    result.errors = errors.slice(0, 20);
    result.ready = ready();
    result.sceneName = result.sceneName || sceneName();
    try {
      if (fs) fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    } catch (_error) {}
  }
  function sceneName() {
    var scene = window.SceneManager && window.SceneManager._scene;
    return scene && scene.constructor && scene.constructor.name || null;
  }
  function ready() {
    if (!(window.DataManager && window.SceneManager && window.Graphics && window.$dataSystem && window.$dataMapInfos)) {
      return false;
    }
    if (typeof window.DataManager.isDatabaseLoaded !== "function") return false;
    try {
      return Boolean(window.DataManager.isDatabaseLoaded());
    } catch (error) {
      var message = "Database readiness check failed: " + String(error && error.message || error || "unknown error");
      var alreadyRecorded = errors.some(function (entry) {
        return entry.source === "DataManager.isDatabaseLoaded" && entry.message === message;
      });
      if (!alreadyRecorded) {
        errors.push({
          message: message,
          source: "DataManager.isDatabaseLoaded",
          line: 0,
          column: 0,
          stack: error && error.stack ? String(error.stack).slice(0, 1000) : ""
        });
      }
      return false;
    }
  }
  function pressOk() {
    if (!window.Input) return;
    window.Input._currentState = window.Input._currentState || {};
    window.Input._currentState.ok = true;
    window.Input._currentState.z = true;
    setTimeout(function () {
      if (window.Input && window.Input._currentState) {
        window.Input._currentState.ok = false;
        window.Input._currentState.z = false;
      }
    }, 80);
  }
  function setupNewGame() {
    if (launchedMap || !ready()) return;
    launchedMap = true;
    try {
      window.DataManager.setupNewGame();
      if (window.SceneManager && window.Scene_Map) window.SceneManager.goto(window.Scene_Map);
    } catch (error) {
        errors.push({
          message: "setupNewGame failed: " + error.message,
          source: "AIWF_PlayableProbe",
          line: 0,
          column: 0,
          stack: error.stack ? String(error.stack).slice(0, 1000) : ""
        });
    }
  }
  function canvasProbe() {
    var source = renderableCanvas();
    var canvas = source && source.canvas;
    var result = {
      exists: Boolean(canvas),
      width: canvas && canvas.width || 0,
      height: canvas && canvas.height || 0,
      nonBlank: false,
      sampledPixels: 0,
      nonBlankPixels: 0,
      screenshotWritten: false,
      source: source && source.source || null,
      error: null,
      diagnostics: renderDiagnostics()
    };
    if (!canvas || !canvas.width || !canvas.height) return result;
    try {
      sampleCanvas(canvas, result);
      if (fs && result.nonBlank) {
        var png = canvas.toDataURL("image/png").replace(/^data:image\\/png;base64,/, "");
        fs.writeFileSync(screenPath, png, "base64");
        result.screenshotWritten = true;
      }
    } catch (error) {
      result.error = error.message;
    }
    return result;
  }
  function renderableCanvas() {
    var scene = window.SceneManager && window.SceneManager._scene;
    var renderer = window.Graphics && window.Graphics._renderer;
    var extract = renderer && (renderer.extract || renderer.plugins && renderer.plugins.extract);
    if (extract && extract.canvas && scene) {
      try {
        var extracted = extract.canvas(scene);
        if (extracted && extracted.width && extracted.height) {
          return { canvas: normalizeProofCanvas(extracted), source: "pixi-renderer-extract" };
        }
      } catch (error) {}
    }
    var canvas = window.Graphics && window.Graphics._canvas || document.querySelector("canvas");
    return canvas ? { canvas: canvas, source: "graphics-canvas-readback" } : null;
  }
  function normalizeProofCanvas(canvas) {
    var displayCanvas = window.Graphics && window.Graphics._canvas || document.querySelector("canvas");
    var targetWidth = displayCanvas && displayCanvas.width || 0;
    var targetHeight = displayCanvas && displayCanvas.height || 0;
    if (!targetWidth || !targetHeight || canvas.width <= targetWidth * 2 || canvas.height <= targetHeight * 2) {
      return canvas;
    }
    var scaled = document.createElement("canvas");
    scaled.width = targetWidth;
    scaled.height = targetHeight;
    var context = scaled.getContext("2d");
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled;
  }
  function sampleCanvas(canvas, result) {
    var sample = document.createElement("canvas");
    sample.width = Math.min(64, canvas.width);
    sample.height = Math.min(48, canvas.height);
    var context = sample.getContext("2d");
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    var data = context.getImageData(0, 0, sample.width, sample.height).data;
    for (var index = 0; index < data.length; index += 4) {
      result.sampledPixels += 1;
      if (data[index + 3] > 0 && (data[index] > 8 || data[index + 1] > 8 || data[index + 2] > 8)) {
        result.nonBlankPixels += 1;
      }
    }
    result.nonBlank = result.nonBlankPixels > 8;
  }
  function renderDiagnostics() {
    var scene = window.SceneManager && window.SceneManager._scene;
    var spriteset = scene && scene._spriteset;
    var tilemap = spriteset && spriteset._tilemap;
    var renderer = window.Graphics && window.Graphics._renderer;
    var extract = renderer && (renderer.extract || renderer.plugins && renderer.plugins.extract);
    var screen = window.$gameScreen;
    var imageReady = null;
    try { imageReady = window.ImageManager && window.ImageManager.isReady && window.ImageManager.isReady(); } catch (_error) {}
    return {
      brightness: screen && screen.brightness && screen.brightness(),
      screenBrightness: screen && screen._brightness,
      imageReady: imageReady,
      sceneStarted: scene && scene._started,
      spritesetReady: Boolean(spriteset),
      tilemapReady: Boolean(tilemap),
      tilemapChildren: tilemap && tilemap.children ? tilemap.children.length : 0,
      rendererReady: Boolean(renderer),
      rendererType: renderer && renderer.type,
      rendererExtractReady: Boolean(extract && extract.canvas),
      displayX: window.$gameMap && window.$gameMap._displayX,
      displayY: window.$gameMap && window.$gameMap._displayY
    };
  }
  function requestPageCapture() {
    if (!fs || captureInFlight) return;
    var nwApi = window.nw || null;
    var win = nwApi && nwApi.Window && nwApi.Window.get && nwApi.Window.get();
    if (!win || !win.capturePage) return;
    captureInFlight = true;
    try {
      win.capturePage(function (data) {
        captureInFlight = false;
        try {
          if (data && data.constructor && data.constructor.name === "Buffer") {
            fs.writeFileSync(screenPath, data);
          } else if (typeof data === "string") {
            fs.writeFileSync(screenPath, data.replace(/^data:image\\/png;base64,/, ""), "base64");
          }
        } catch (_error) {}
      }, { format: "png", datatype: "buffer" });
    } catch (_error) {
      captureInFlight = false;
    }
  }
  function mapProbe() {
    var mapId = window.$gameMap && window.$gameMap.mapId && window.$gameMap.mapId();
    var startMapId = window.$dataSystem && window.$dataSystem.startMapId;
    var player = window.$gamePlayer;
    var playerSprite = player ? playerSpriteProbe(player) : null;
    return {
      sceneName: sceneName(),
      expectedStartMapId: startMapId || 0,
      currentMapId: mapId || 0,
      onStartMap: Boolean(startMapId && mapId === startMapId),
      player: player ? {
        x: player.x,
        y: player.y,
        direction: player.direction && player.direction(),
        canMove: player.canMove && player.canMove(),
        transparent: player.isTransparent && player.isTransparent(),
        visible: player.isTransparent ? !player.isTransparent() : true,
        characterName: player.characterName && player.characterName(),
        characterIndex: player.characterIndex && player.characterIndex(),
        spriteVisible: playerSprite && playerSprite.visible,
        spriteOpacity: playerSprite && playerSprite.opacity
      } : null
    };
  }
  function playerSpriteProbe(player) {
    var scene = window.SceneManager && window.SceneManager._scene;
    var spriteset = scene && scene._spriteset;
    var sprites = spriteset && spriteset._characterSprites || [];
    for (var index = 0; index < sprites.length; index += 1) {
      if (sprites[index] && sprites[index]._character === player) {
        return {
          visible: sprites[index].visible,
          opacity: sprites[index].opacity
        };
      }
    }
    return null;
  }
  function eventProbe() {
    var interpreter = window.$gameMap && window.$gameMap._interpreter;
    var messageBusy = window.$gameMessage && window.$gameMessage.isBusy && window.$gameMessage.isBusy();
    var eventRunning = window.$gameMap && window.$gameMap.isEventRunning && window.$gameMap.isEventRunning();
    var interpreterRunning = interpreter && interpreter.isRunning && interpreter.isRunning();
    var playerCanMove = window.$gamePlayer && window.$gamePlayer.canMove && window.$gamePlayer.canMove();
    return {
      eventRunning: Boolean(eventRunning),
      interpreterRunning: Boolean(interpreterRunning),
      messageBusy: Boolean(messageBusy),
      playerCanMove: Boolean(playerCanMove),
      complete: !eventRunning && !interpreterRunning && !messageBusy && Boolean(playerCanMove)
    };
  }
  function tick() {
    var elapsed = Date.now() - startedAt;
    installEngineErrorHook();
    captureRmmvErrorPrinter();
    if (errors.length) {
      write({
        status: "fail",
        detail: "Runtime JavaScript error while proving playable state.",
        sceneName: sceneName(),
        screen: canvasProbe(),
        map: mapProbe(),
        events: eventProbe()
      });
      return;
    }
    if (ready()) setupNewGame();
    if (launchedMap && !firstMapAt && window.$gameMap && window.$gameMap.mapId && window.$gameMap.mapId() === window.$dataSystem.startMapId) {
      firstMapAt = Date.now();
    }
    if (elapsed % 500 < 120) pressOk();
    var map = mapProbe();
    var events = eventProbe();
    var screen = canvasProbe();
    requestPageCapture();
    var enoughMapTime = firstMapAt && Date.now() - firstMapAt > 2500;
    var playerVisible = map.player && map.player.visible && map.player.characterName;
    if (screen.nonBlank && map.onStartMap && playerVisible && events.complete && enoughMapTime) {
      write({
        status: "pass",
        detail: "Screen rendered, visible player loaded on the start map, and start event loop became idle.",
        screen: screen,
        map: map,
        events: events
      });
      window.close();
      return;
    }
    if (elapsed > timeoutMs) {
      var status = screen.nonBlank && map.onStartMap ? "review" : "fail";
      write({
        status: status,
        detail: status === "review"
          ? "Screen and start map rendered, but player visibility or start events did not reach a playable state before timeout."
          : "Playable probe timed out before screen and start map were both proven.",
        screen: screen,
        map: map,
        events: events
      });
      window.close();
      return;
    }
    write({
      status: "running",
      detail: "Waiting for screen, start map, and event idle state.",
      screen: screen,
      map: map,
      events: events
    });
    setTimeout(tick, 250);
  }
  write({ status: "running", detail: "Playable probe injected." });
  setTimeout(tick, 250);
}());
`;
}

export { runNwjsPlayableProbe };
