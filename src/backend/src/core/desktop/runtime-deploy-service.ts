import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';

import { getMapFileForRead } from './staging-service.ts';
import { runNwjsPlayableProbe } from '../workflow/probe/nwjs-playable-probe.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import {
  RPG_MAKER_ENGINE_PROFILES,
  type RpgMakerEngine,
} from '../rmmv/rpg-maker-engine.ts';
import { resolveRpgMakerMZProjectRuntime } from './rpg-maker-mz-runtime.ts';

export type RuntimePlanStatus = 'runnable' | 'blocked';
export type RuntimeExecutionStatus = 'not-started' | 'completed' | 'failed' | 'timed-out' | 'blocked';
export type DeployTarget = 'web' | 'windows';
export type DeployStatus = 'ready' | 'blocked';
export type RuntimeIssueSeverity = 'blocker' | 'warning';

export interface RuntimeIssue {
  severity: RuntimeIssueSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface RuntimeCheck {
  id: string;
  severity: RuntimeIssueSeverity;
  pass: boolean;
  path?: string;
  detail: string;
}

export interface RuntimeCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export interface ScreenEvidence {
  required: boolean;
  exists: boolean;
  nonBlank: boolean;
  screenshotWritten: boolean;
  path?: string;
  width?: number;
  height?: number;
  sampledPixels?: number;
  nonBlankPixels?: number;
  decodeError?: string;
  detail: string;
}

export interface StartMapVerification {
  required: boolean;
  verified: boolean;
  expectedStartMapId?: number;
  currentMapId?: number;
  requestedMapId?: number;
  sceneName?: string;
  detail: string;
}

export interface SaveIsolationEvidence {
  enabled: boolean;
  strategy: 'temporary-project-copy' | 'direct-project-run' | 'not-run';
  sourceProject: string;
  runProject?: string;
  probeWorkspace?: string;
  sourceSavePaths: string[];
  excludedFromProbeWorkspace: boolean;
  sourceFingerprintBefore: string;
  sourceFingerprintAfter?: string;
  sourceUnchanged?: boolean;
  cleaned?: boolean;
  cleanupError?: string;
  detail: string;
}

export interface IdleOrReadyEvidence {
  required: boolean;
  verified: boolean;
  mode: 'idle' | 'ready' | 'missing';
  sceneName?: string;
  eventRunning?: boolean;
  interpreterRunning?: boolean;
  messageBusy?: boolean;
  playerCanMove?: boolean;
  detail: string;
}

export interface RuntimeJsErrorEvidence {
  message: string;
  type?: string;
  source?: string;
  sourceKind: 'rmmv-plugin' | 'rmmv-engine' | 'probe-script' | 'unknown';
  relativePath?: string;
  fileName?: string;
  pluginName?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface RuntimeFailureEvidence {
  code: 'project-runtime-js-error' | 'probe-runtime-js-error' | 'runtime-js-error';
  causedBy: 'rmmv-project' | 'agent-rpg-probe' | 'unknown';
  detail: string;
  blocksSceneMap: boolean;
  blocksStartMap: boolean;
  blocksPlayableState: boolean;
  sceneName?: string;
  expectedStartMapId?: number;
  currentMapId?: number;
  errorCount: number;
  primaryError?: RuntimeJsErrorEvidence;
  errors: RuntimeJsErrorEvidence[];
}

export interface RmmvPlaytestPlan {
  status: RuntimePlanStatus;
  execution: 'not-started';
  generatedAt: string;
  project: string;
  engine: RpgMakerEngine;
  mapId?: number;
  startMapId?: number;
  startX: number;
  startY: number;
  webRoot?: string;
  dataDir?: string;
  indexHtml?: string;
  packageJson?: string;
  pluginsJs?: string;
  gameExe?: string;
  nwjsRunner?: string;
  command?: RuntimeCommand;
  probe?: {
    enabled: boolean;
    logKeywords: string[];
  };
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
  artifactPath: string;
  checks: RuntimeCheck[];
  issues: RuntimeIssue[];
}

export interface RmmvPlaytestRunResult {
  status: RuntimeExecutionStatus;
  execution: Exclude<RuntimeExecutionStatus, 'not-started'>;
  generatedAt: string;
  probeStatus?: string;
  screenEvidence: ScreenEvidence;
  startMapVerified: StartMapVerification;
  saveIsolation: SaveIsolationEvidence;
  idleOrReadyEvidence: IdleOrReadyEvidence;
  runtimeFailure?: RuntimeFailureEvidence;
  evidenceFiles: string[];
  blockers: string[];
  startedAt?: string;
  endedAt: string;
  durationMs: number;
  timeoutMs: number;
  project: string;
  mapId?: number;
  startX: number;
  startY: number;
  command?: RuntimeCommand;
  pid?: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  runnerStarted: boolean;
  processExited: boolean;
  error?: string;
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
  artifactPath: string;
  planArtifactPath: string;
  checks: RuntimeCheck[];
  issues: RuntimeIssue[];
}

export interface DeployManifestEntry {
  path: string;
  bytes: number;
}

export interface DeployExcludedEntry {
  path: string;
  reason: string;
}

export interface RmmvDeployManifest {
  status: DeployStatus;
  target: DeployTarget;
  generatedAt: string;
  project: string;
  engine: RpgMakerEngine;
  sourceRoot: string;
  targetDir: string;
  manifestPath: string;
  files: DeployManifestEntry[];
  excluded: DeployExcludedEntry[];
  checks: RuntimeCheck[];
  issues: RuntimeIssue[];
}

export interface PlaytestOptions {
  mapId?: number;
  startX?: number;
  startY?: number;
  nwjsRunner?: string;
  timeoutMs?: number;
  probe?: boolean;
  probeKeywords?: string[];
  generatedAt?: string;
}

export interface DeployOptions {
  target?: DeployTarget;
  generatedAt?: string;
}

const DEFAULT_PLAYTEST_TIMEOUT_MS = 15000;

export function prepareRmmvPlaytestPlan(
  workflowRoot: string,
  project: string,
  options: PlaytestOptions = {},
): RmmvPlaytestPlan {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const projectRoot = path.resolve(project);
  const artifactDir = path.join(
    path.resolve(workflowRoot),
    'runtime',
    'out',
    'playtest',
    safeStamp(generatedAt),
  );
  fs.mkdirSync(artifactDir, { recursive: true });

  const checks: RuntimeCheck[] = [];
  const issues: RuntimeIssue[] = [];
  const layout = resolveRuntimeLayout(projectRoot);
  const engineFiles = RPG_MAKER_ENGINE_PROFILES[layout.engine].engineFiles
    .filter((relative) => relative.startsWith('js/') && relative !== 'js/plugins.js');
  const startX = normalizeCoordinate(options.startX);
  const startY = normalizeCoordinate(options.startY);
  const probeKeywords = normalizeProbeKeywords(options.probeKeywords);
  const systemStartMapId = resolveSystemStartMapId(layout);
  if (options.mapId && systemStartMapId && Number(options.mapId) !== systemStartMapId) {
    checks.push({
      id: 'start-map-consistency',
      severity: 'warning',
      pass: false,
      path: layout.dataDir || undefined,
      detail: `Map ${options.mapId} was requested, but System.json start map is ${systemStartMapId}.`,
    });
    issues.push({
      severity: 'warning',
      code: 'start-map-consistency-mismatch',
      message: `Requested map ${options.mapId} does not match System start map ${systemStartMapId}.`,
      path: layout.dataDir || undefined,
    });
  }

  addPathCheck(checks, issues, 'project-dir', 'blocker', projectRoot, 'RMMV project directory', 'directory');
  addPathCheck(checks, issues, 'data-dir', 'blocker', layout.dataDir, 'RMMV data directory', 'directory');
  addPathCheck(checks, issues, 'index-html', 'blocker', layout.indexHtml, 'Browser/NW.js entry index.html', 'file');
  addPathCheck(checks, issues, 'package-json', 'blocker', layout.packageJson, 'NW.js package metadata', 'file');
  for (const relative of engineFiles) {
    const fileName = path.basename(relative);
    addPathCheck(
      checks,
      issues,
      `engine-${fileName}`,
      'blocker',
      layout.webRoot ? path.join(layout.webRoot, ...relative.split('/')) : null,
      `RPG Maker ${layout.engine === 'rpg-maker-mz' ? 'MZ' : 'MV'} engine file ${fileName}`,
      'file',
    );
  }
  addPathCheck(checks, issues, 'plugins-js', 'blocker', layout.pluginsJs, 'RMMV plugin configuration plugins.js', 'file');
  if (Number.isInteger(options.mapId) && Number(options.mapId) > 0) {
    addPathCheck(
      checks,
      issues,
      'target-map',
      'blocker',
      resolveMapFileForRuntime(workflowRoot, projectRoot, layout.dataDir, Number(options.mapId)),
      `Requested playtest map ${options.mapId}`,
      'file',
    );
  }

  if (layout.pluginsJs && isFile(layout.pluginsJs)) {
    inspectPluginFiles(layout.pluginsJs, layout.pluginsDir, checks, issues);
  }

  const runner = resolveRunner(projectRoot, layout, options.nwjsRunner);
  checks.push({
    id: 'runtime-runner',
    severity: 'blocker',
    pass: Boolean(runner.command),
    path: runner.path,
    detail: runner.detail,
  });
  if (!runner.command) {
    issues.push({
      severity: 'blocker',
      code: 'runtime-runner-missing',
      message: runner.detail,
      path: runner.path,
    });
  }

  const artifactPath = path.join(artifactDir, 'playtest-plan.json');
  const plan: RmmvPlaytestPlan = {
    status: hasBlockers(issues) ? 'blocked' : 'runnable',
    execution: 'not-started',
    generatedAt,
    project: projectRoot,
    engine: layout.engine,
    mapId: Number.isInteger(options.mapId) && Number(options.mapId) > 0 ? Number(options.mapId) : undefined,
    startMapId: systemStartMapId || undefined,
    startX,
    startY,
    webRoot: layout.webRoot || undefined,
    dataDir: layout.dataDir || undefined,
    indexHtml: layout.indexHtml || undefined,
    packageJson: layout.packageJson || undefined,
    pluginsJs: layout.pluginsJs || undefined,
    gameExe: layout.gameExe || undefined,
    nwjsRunner: runner.kind === 'nwjs' ? runner.path : undefined,
    command: runner.command,
    probe: {
      enabled: Boolean(options.probe),
      logKeywords: probeKeywords,
    },
    logPath: path.join(artifactDir, 'playtest.log'),
    stdoutPath: path.join(artifactDir, 'playtest.stdout.log'),
    stderrPath: path.join(artifactDir, 'playtest.stderr.log'),
    artifactPath,
    checks,
    issues,
  };
  writeJson(artifactPath, plan);
  return plan;
}

export async function runPlaytest(
  workflowRoot: string,
  project: string,
  options: PlaytestOptions = {},
): Promise<RmmvPlaytestRunResult> {
  const plan = prepareRmmvPlaytestPlan(workflowRoot, project, options);
  const timeoutMs = normalizePlaytestTimeoutMs(options.timeoutMs);
  const artifactPath = path.join(path.dirname(plan.artifactPath), 'playtest-run.json');
  initializeRunLogs(plan, timeoutMs);

  if (plan.status === 'blocked' || !plan.command) {
    const now = new Date().toISOString();
    appendRunLog(plan.logPath, `blocked: playtest runner did not start\n`);
    const result = buildRunResult(plan, {
      status: 'blocked',
      endedAt: now,
      durationMs: 0,
      timeoutMs,
      exitCode: null,
      signal: null,
      timedOut: false,
      runnerStarted: false,
      processExited: false,
      blockers: plan.issues
        .filter((issue) => issue.severity === 'blocker')
        .map((issue) => `${issue.code}: ${issue.message}`),
      probeStatus: undefined,
      evidenceFiles: [plan.logPath, plan.stdoutPath, plan.stderrPath],
      artifactPath,
    });
    writeJson(artifactPath, result);
    return result;
  }

  if (plan.probe?.enabled) {
    const result = runPlaytestWithProbe(plan, timeoutMs);
    writeJson(artifactPath, result);
    return result;
  }

  const startedAt = new Date();
  const command = plan.command;
  appendRunLog(plan.logPath, `startedAt: ${startedAt.toISOString()}\n`);
  const commandLine = [command.executable, ...command.args].join(' ');
  appendRunLog(plan.logPath, `command: ${commandLine}\n`);
  appendRunLog(plan.logPath, `cwd: ${command.cwd}\n\n`);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let runnerStarted = false;
    let processExited = false;
    let timeout: NodeJS.Timeout | null = null;
    let forceFinishTimeout: NodeJS.Timeout | null = null;
    let child: childProcess.ChildProcess | null = null;

    const finish = (status: Exclude<RuntimeExecutionStatus, 'not-started'>, payload: {
      exitCode: number | null;
      signal: string | null;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceFinishTimeout) clearTimeout(forceFinishTimeout);
      const endedAt = new Date();
      appendRunLog(plan.logPath, `\nendedAt: ${endedAt.toISOString()}\n`);
      appendRunLog(plan.logPath, `status: ${status}\n`);
      if (payload.exitCode !== null) appendRunLog(plan.logPath, `exitCode: ${payload.exitCode}\n`);
      if (payload.signal) appendRunLog(plan.logPath, `signal: ${payload.signal}\n`);
      if (payload.error) appendRunLog(plan.logPath, `error: ${payload.error}\n`);

      const result = buildRunResult(plan, {
        status,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        timeoutMs,
        pid: child?.pid,
        exitCode: payload.exitCode,
        signal: payload.signal,
        timedOut,
        runnerStarted,
        processExited,
        error: payload.error,
        artifactPath,
      });
      writeJson(artifactPath, result);
      resolve(result);
    };

    try {
      child = childProcess.spawn(command.executable, command.args, {
        cwd: command.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runnerStarted = true;
    } catch (error) {
      finish('failed', {
        exitCode: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        fs.appendFileSync(plan.stdoutPath, data);
        fs.appendFileSync(plan.logPath, data);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        fs.appendFileSync(plan.stderrPath, data);
        fs.appendFileSync(plan.logPath, data);
      });
    }
    child.once('error', (error) => {
      finish('failed', {
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });
    child.once('exit', (code, signal) => {
      processExited = true;
      const status = timedOut
        ? 'timed-out'
        : code === 0
          ? 'completed'
          : 'failed';
      finish(status, {
        exitCode: code,
        signal,
      });
    });

    timeout = setTimeout(() => {
      timedOut = true;
      appendRunLog(plan.logPath, `\ntimeout: ${timeoutMs}ms elapsed, stopping runner\n`);
      stopProcessTree(child);
      forceFinishTimeout = setTimeout(() => {
        finish('timed-out', {
          exitCode: child?.exitCode ?? null,
          signal: child?.signalCode ?? null,
        });
      }, 2000);
    }, timeoutMs);
  });
}

function runPlaytestWithProbe(plan: RmmvPlaytestPlan, timeoutMs: number): RmmvPlaytestRunResult {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const probeArtifactsDir = path.join(path.dirname(plan.artifactPath), 'probe');
  const sourceSaveFingerprintBefore = fingerprintSaveState(plan.project);
  const runContext = prepareProbeWorkspace(plan);
  const probeWorkspaceExcludedSave = probeWorkspaceExcludesSaveDirs(runContext);
  const cleanup: Array<() => void> = [];
  const blockers: string[] = [];
  let cleanupError: string | undefined;
  if (runContext.workdir) {
    appendRunLog(plan.logPath, `probeWorkspace: ${runContext.workdir}\n`);
    cleanup.push(() => {
      if (runContext.workdir) fs.rmSync(runContext.workdir, { recursive: true, force: true });
    });
  }

  const result = runNwjsPlayableProbe(runContext.projectRoot, {
    timeoutMs,
    artifactDir: probeArtifactsDir,
    command: runContext.command,
    stdoutPath: path.join(path.dirname(plan.artifactPath), 'probe.stdout.log'),
    stderrPath: path.join(path.dirname(plan.artifactPath), 'probe.stderr.log'),
  });

  const finalStatus: RuntimeExecutionStatus = deriveProbeRunStatus(result, plan.probe?.enabled || false);
  let adjustedStatus = finalStatus;
  const endedAt = new Date();
  const screenEvidence = deriveScreenEvidence(result, true);
  const startMapVerified = deriveStartMapVerification(plan, result, true);
  const idleOrReadyEvidence = deriveIdleOrReadyEvidence(result, true);
  const runtimeFailure = deriveRuntimeFailureEvidence(result);
  const evidenceFiles: string[] = [
    plan.logPath,
    plan.stdoutPath,
    plan.stderrPath,
  ];
  if (result.artifacts?.resultJson) evidenceFiles.push(result.artifacts.resultJson);
  if (result.artifacts?.screenPng) evidenceFiles.push(result.artifacts.screenPng);
  if (typeof result.artifacts?.stdout === 'string') evidenceFiles.push(result.artifacts.stdout);
  if (typeof result.artifacts?.stderr === 'string') evidenceFiles.push(result.artifacts.stderr);

  if (result.status === 'not-available') {
    blockers.push('playable probe is unavailable');
  }
  if (!result.attempted && finalStatus === 'blocked') {
    blockers.push('playable probe could not be started');
  }
  if (result.status === 'review') {
    blockers.push('playable probe reported review; manual verification recommended');
  }
  if (result.status === 'fail') {
    blockers.push(runtimeFailure?.detail || result.detail || 'playable probe failed');
  }
  if (result.timedOut) {
    blockers.push(result.detail || 'Playable probe timed out before producing a final result.');
  }
  blockers.push(...blockersForProbeEvidence(screenEvidence, startMapVerified, idleOrReadyEvidence));

  const probeLogKeywords = plan.probe?.logKeywords || [];
  if (probeLogKeywords.length > 0) {
    const logText = readTextOrEmpty(plan.logPath);
    const stdoutText = readTextOrEmpty(plan.stdoutPath);
    const stderrText = readTextOrEmpty(plan.stderrPath);
    const probeStdoutText = typeof result.artifacts?.stdout === 'string' ? readTextOrEmpty(result.artifacts.stdout) : '';
    const probeStderrText = typeof result.artifacts?.stderr === 'string' ? readTextOrEmpty(result.artifacts.stderr) : '';
    const combined = `${logText}\n${stdoutText}\n${stderrText}\n${probeStdoutText}\n${probeStderrText}`;
    for (const keyword of probeLogKeywords) {
      if (!combined.includes(keyword)) {
        blockers.push(`Missing required log keyword: ${keyword}`);
      }
    }
  }

  if (plan.mapId && plan.startMapId && plan.mapId !== plan.startMapId) {
    blockers.push(`Requested map ${plan.mapId} does not match System start map ${plan.startMapId}`);
  }

  for (const cleanupTask of cleanup) {
    try {
      cleanupTask();
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }

  const saveIsolation = deriveSaveIsolationEvidence(
    plan.project,
    runContext,
    sourceSaveFingerprintBefore,
    probeWorkspaceExcludedSave,
    cleanupError,
  );
  blockers.push(...blockersForSaveIsolation(saveIsolation));

  if (blockers.length > 0) {
    if (adjustedStatus === 'completed') adjustedStatus = 'failed';
    if (adjustedStatus !== 'timed-out' && !result.attempted) adjustedStatus = 'blocked';
  }

  const payload = buildRunResult(plan, {
    status: adjustedStatus,
    startedAt: startedAtIso,
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    timeoutMs,
    pid: undefined,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    runnerStarted: Boolean(result.runnerStarted),
    processExited: Boolean(result.processExited),
    timedOut: result.timedOut || false,
    artifactPath: path.join(path.dirname(plan.artifactPath), 'playtest-run.json'),
    probeStatus: result.status,
    screenEvidence,
    startMapVerified,
    saveIsolation,
    idleOrReadyEvidence,
    runtimeFailure,
    evidenceFiles: dedupe(evidenceFiles),
    blockers,
    command: runContext.command,
  });

  for (const pathValue of payload.evidenceFiles) {
    if (pathValue && fs.existsSync(pathValue)) {
      appendRunLog(plan.logPath, `evidence: ${pathValue}\n`);
    }
  }

  if (blockers.length > 0) {
    appendRunLog(plan.logPath, `blockers: ${blockers.join('; ')}\n`);
  }
  appendRunLog(plan.logPath, `status: ${adjustedStatus}\n`);
  appendRunLog(plan.logPath, `probeStatus: ${result.status}\n`);
  appendRunLog(plan.logPath, `screenEvidence: ${screenEvidence.detail}\n`);
  appendRunLog(plan.logPath, `startMapVerified: ${startMapVerified.detail}\n`);
  if (runtimeFailure) appendRunLog(plan.logPath, `runtimeFailure: ${runtimeFailure.detail}\n`);
  appendRunLog(plan.logPath, `saveIsolation: ${saveIsolation.detail}\n`);
  appendRunLog(plan.logPath, `idleOrReadyEvidence: ${idleOrReadyEvidence.detail}\n`);
  appendRunLog(plan.logPath, `endedAt: ${endedAt.toISOString()}\n`);
  if (result.exitCode !== null) appendRunLog(plan.logPath, `exitCode: ${result.exitCode}\n`);
  if (result.signal) appendRunLog(plan.logPath, `signal: ${result.signal}\n`);

  return payload;
}

interface ProbeWorkspace {
  command: RuntimeCommand;
  projectRoot: string;
  workdir: string | null;
}

function prepareProbeWorkspace(plan: RmmvPlaytestPlan): ProbeWorkspace {
  if (!plan.command) {
    throw new Error('Cannot prepare probe workspace: playtest command is missing.');
  }
  const command = plan.command;
  const sourceProject = plan.project;
  const runningDir = typeof command.cwd === 'string' ? path.resolve(command.cwd) : sourceProject;
  const sourceRoot = path.resolve(sourceProject);
  if (!isPathInside(sourceRoot, runningDir)) {
    return { command, projectRoot: sourceProject, workdir: null };
  }

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-playtest-probe-'));
  copyProjectForProbe(sourceProject, probeRoot);
  const mappedCommand = {
    executable: mapPathForWorkspace(command.executable, sourceProject, probeRoot),
    args: command.args.map((item) => mapPathForWorkspace(item, sourceProject, probeRoot)),
    cwd: mapPathForWorkspace(runningDir, sourceProject, probeRoot),
  };
  return {
    command: mappedCommand,
    projectRoot: probeRoot,
    workdir: probeRoot,
  };
}

function deriveProbeRunStatus(result: ReturnType<typeof runNwjsPlayableProbe>, isProbeMode: boolean): Exclude<RuntimeExecutionStatus, 'not-started'> {
  if (!isProbeMode) return 'failed';
  if (!result.attempted) return 'blocked';
  if (result.timedOut) return 'timed-out';
  if (result.status === 'pass') return 'completed';
  if (result.status === 'review') return 'completed';
  if (result.status === 'not-available') return 'blocked';
  return 'failed';
}

function resolveSystemStartMapId(layout: {
  dataDir: string | null;
}): number | null {
  const systemJson = layout.dataDir ? path.join(layout.dataDir, 'System.json') : null;
  if (!systemJson || !isFile(systemJson)) return null;
  try {
    const raw = fs.readFileSync(systemJson, 'utf8');
    const data = JSON.parse(raw) as { startMapId?: unknown };
    const parsed = Number(data.startMapId);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeProbeKeywords(values: string[] | undefined): string[] {
  const deduped = new Set<string>();
  for (const source of values || []) {
    source
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .forEach((keyword) => {
        deduped.add(keyword);
      });
  }
  return [...deduped];
}

function copyProjectForProbe(sourceRoot: string, targetRoot: string): void {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (sourcePath) => {
      const relative = path.relative(source, sourcePath);
      if (!relative) {
        return true;
      }
      const normalized = relative.replace(/\\/g, '/');
      const segments = normalized.split('/');
      if (segments.includes('runtime') || segments.includes('secrets') || segments.includes('.git')) {
        return false;
      }
      if (segments.includes('www') && segments.includes('save')) {
        return false;
      }
      if (segments.includes('node_modules')) return false;
      return true;
    },
  });
}

function mapPathForWorkspace(value: string, sourceRoot: string, workspaceRoot: string): string {
  if (!path.isAbsolute(value)) return value;
  const source = path.resolve(sourceRoot);
  const workspace = path.resolve(workspaceRoot);
  const absolute = path.resolve(value);
  return isPathInside(source, absolute) ? path.join(workspace, path.relative(source, absolute)) : absolute;
}

function dedupe(paths: string[]): string[] {
  const normalized = new Set<string>();
  const out: string[] = [];
  for (const value of paths) {
    const normalizedValue = path.normalize(value);
    if (!normalized.has(normalizedValue)) {
      normalized.add(normalizedValue);
      out.push(normalizedValue);
    }
  }
  return out;
}

function readTextOrEmpty(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function deriveScreenEvidence(result: ReturnType<typeof runNwjsPlayableProbe>, required: boolean): ScreenEvidence {
  const artifactPath = typeof result.artifacts?.screenPng === 'string' ? result.artifacts.screenPng : undefined;
  const screen = readRecord(readRecord(result.probe).screen);
  const exists = Boolean(artifactPath && fs.existsSync(artifactPath));
  const decodeError = stringValue(screen.decodeError) || stringValue(screen.error);
  const width = numberValue(screen.width);
  const height = numberValue(screen.height);
  const nonBlank = screen.nonBlank === true;
  const screenshotWritten = screen.screenshotWritten === true || exists;
  let detail = 'Screen proof was not produced.';
  if (exists && decodeError) detail = `Screenshot exists but could not be decoded: ${decodeError}`;
  else if (exists && nonBlank) detail = `Screenshot is non-blank${width && height ? ` (${width}x${height})` : ''}.`;
  else if (exists) detail = `Screenshot exists but did not prove a non-blank frame${width && height ? ` (${width}x${height})` : ''}.`;
  return {
    required,
    exists,
    nonBlank,
    screenshotWritten,
    path: artifactPath,
    width,
    height,
    sampledPixels: numberValue(screen.sampledPixels),
    nonBlankPixels: numberValue(screen.nonBlankPixels),
    decodeError,
    detail,
  };
}

function deriveStartMapVerification(
  plan: RmmvPlaytestPlan,
  result: ReturnType<typeof runNwjsPlayableProbe>,
  required: boolean,
): StartMapVerification {
  const probe = readRecord(result.probe);
  const map = readRecord(probe.map);
  const expectedStartMapId = numberValue(map.expectedStartMapId) || plan.startMapId;
  const currentMapId = numberValue(map.currentMapId);
  const verified = map.onStartMap === true
    && Boolean(expectedStartMapId)
    && Boolean(currentMapId)
    && expectedStartMapId === currentMapId;
  return {
    required,
    verified,
    expectedStartMapId,
    currentMapId,
    requestedMapId: plan.mapId,
    sceneName: stringValue(map.sceneName) || stringValue(probe.sceneName),
    detail: verified
      ? `Runtime loaded expected start map ${expectedStartMapId}.`
      : `Runtime did not prove start map. expected=${expectedStartMapId || 0}, current=${currentMapId || 0}.`,
  };
}

function deriveIdleOrReadyEvidence(
  result: ReturnType<typeof runNwjsPlayableProbe>,
  required: boolean,
): IdleOrReadyEvidence {
  const probe = readRecord(result.probe);
  const events = readRecord(probe.events);
  const sceneName = stringValue(probe.sceneName) || stringValue(readRecord(probe.map).sceneName);
  if (events.complete === true) {
    return {
      required,
      verified: true,
      mode: 'idle',
      sceneName,
      eventRunning: booleanValue(events.eventRunning),
      interpreterRunning: booleanValue(events.interpreterRunning),
      messageBusy: booleanValue(events.messageBusy),
      playerCanMove: booleanValue(events.playerCanMove),
      detail: 'Start event loop reached idle state and player control is available.',
    };
  }
  if (probe.ready === true) {
    return {
      required,
      verified: true,
      mode: 'ready',
      sceneName,
      eventRunning: booleanValue(events.eventRunning),
      interpreterRunning: booleanValue(events.interpreterRunning),
      messageBusy: booleanValue(events.messageBusy),
      playerCanMove: booleanValue(events.playerCanMove),
      detail: 'Runtime reported ready, but start event idle state was not proven.',
    };
  }
  return {
    required,
    verified: false,
    mode: 'missing',
    sceneName,
    eventRunning: booleanValue(events.eventRunning),
    interpreterRunning: booleanValue(events.interpreterRunning),
    messageBusy: booleanValue(events.messageBusy),
    playerCanMove: booleanValue(events.playerCanMove),
    detail: 'Runtime did not prove an idle or ready playable state.',
  };
}

function deriveRuntimeFailureEvidence(result: ReturnType<typeof runNwjsPlayableProbe>): RuntimeFailureEvidence | undefined {
  const probe = readRecord(result.probe);
  const classification = readRecord(probe.failureClassification);
  const errors = normalizeRuntimeJsErrors(Array.isArray(probe.runtimeJsErrors) ? probe.runtimeJsErrors : probe.errors);
  if (errors.length === 0) return undefined;
  const map = readRecord(probe.map);
  const primaryError = normalizeRuntimeJsError(readRecord(classification.primaryError)) || errors[0];
  const projectErrors = errors.filter((error) => error.sourceKind === 'rmmv-plugin' || error.sourceKind === 'rmmv-engine');
  const probeErrors = errors.filter((error) => error.sourceKind === 'probe-script');
  const causedBy = runtimeFailureCausedBy(stringValue(classification.causedBy), projectErrors.length, probeErrors.length, errors.length);
  const code = runtimeFailureCode(stringValue(classification.code), causedBy);
  const sceneName = stringValue(classification.sceneName) || stringValue(probe.sceneName) || stringValue(map.sceneName);
  const expectedStartMapId = numberValue(classification.expectedStartMapId) || numberValue(map.expectedStartMapId);
  const currentMapId = numberValue(classification.currentMapId) || numberValue(map.currentMapId);
  const blocksSceneMap = booleanValue(classification.blocksSceneMap) ?? sceneName !== 'Scene_Map';
  const blocksStartMap = booleanValue(classification.blocksStartMap) ?? map.onStartMap !== true;
  const detail = stringValue(classification.detail)
    || `${causedBy === 'rmmv-project' ? 'Project runtime' : causedBy === 'agent-rpg-probe' ? 'Probe runtime' : 'Runtime'} JavaScript error blocked playable proof${blocksSceneMap ? ' before Scene_Map' : ''}: ${formatRuntimeJsError(primaryError)}`;
  return {
    code,
    causedBy,
    detail,
    blocksSceneMap,
    blocksStartMap,
    blocksPlayableState: booleanValue(classification.blocksPlayableState) ?? true,
    sceneName,
    expectedStartMapId,
    currentMapId,
    errorCount: errors.length,
    primaryError,
    errors,
  };
}

function normalizeRuntimeJsErrors(value: unknown): RuntimeJsErrorEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeRuntimeJsError(readRecord(entry)))
    .filter((entry): entry is RuntimeJsErrorEvidence => Boolean(entry));
}

function normalizeRuntimeJsError(entry: Record<string, unknown>): RuntimeJsErrorEvidence | null {
  const message = stringValue(entry.message);
  if (!message) return null;
  const source = stringValue(entry.source);
  const relativePath = stringValue(entry.relativePath) || (source ? sourceToProjectRelativePath(source) : undefined);
  const fileName = stringValue(entry.fileName) || (relativePath ? path.basename(relativePath) : source ? path.basename(source) : undefined);
  const sourceKind = runtimeErrorSourceKind(stringValue(entry.sourceKind), source, relativePath);
  return {
    message,
    type: stringValue(entry.type) || runtimeErrorType(message, stringValue(entry.stack)),
    source,
    sourceKind,
    relativePath,
    fileName,
    pluginName: stringValue(entry.pluginName) || (sourceKind === 'rmmv-plugin' && fileName ? fileName.replace(/\.js$/i, '') : undefined),
    line: numberValue(entry.line),
    column: numberValue(entry.column),
    stack: stringValue(entry.stack),
  };
}

function runtimeFailureCausedBy(
  value: string | undefined,
  projectErrorCount: number,
  probeErrorCount: number,
  errorCount: number,
): RuntimeFailureEvidence['causedBy'] {
  if (value === 'rmmv-project' || value === 'agent-rpg-probe' || value === 'unknown') return value;
  if (projectErrorCount > 0) return 'rmmv-project';
  if (probeErrorCount === errorCount) return 'agent-rpg-probe';
  return 'unknown';
}

function runtimeFailureCode(
  value: string | undefined,
  causedBy: RuntimeFailureEvidence['causedBy'],
): RuntimeFailureEvidence['code'] {
  if (value === 'project-runtime-js-error' || value === 'probe-runtime-js-error' || value === 'runtime-js-error') return value;
  if (causedBy === 'rmmv-project') return 'project-runtime-js-error';
  if (causedBy === 'agent-rpg-probe') return 'probe-runtime-js-error';
  return 'runtime-js-error';
}

function runtimeErrorSourceKind(
  value: string | undefined,
  source: string | undefined,
  relativePath: string | undefined,
): RuntimeJsErrorEvidence['sourceKind'] {
  if (value === 'rmmv-plugin' || value === 'rmmv-engine' || value === 'probe-script' || value === 'unknown') return value;
  if (source === 'AIWF_PlayableProbe' || relativePath?.includes('AIWF_PlayableProbe.js')) return 'probe-script';
  if (relativePath?.startsWith('www/js/plugins/') || relativePath?.startsWith('js/plugins/')) return 'rmmv-plugin';
  if (relativePath?.startsWith('www/js/') || relativePath?.startsWith('js/')) return 'rmmv-engine';
  return 'unknown';
}

function sourceToProjectRelativePath(source: string): string | undefined {
  const normalized = decodeURIComponent(source).replace(/\\/g, '/');
  const wwwIndex = normalized.indexOf('/www/');
  if (wwwIndex >= 0) return normalized.slice(wwwIndex + 1);
  const jsIndex = normalized.indexOf('/js/');
  if (jsIndex >= 0) return normalized.slice(jsIndex + 1);
  return undefined;
}

function runtimeErrorType(message: string, stack: string | undefined): string | undefined {
  const match = /(?:Uncaught\s+)?([A-Za-z_$][\w$]*Error)\b/.exec(message) || (stack ? /^([A-Za-z_$][\w$]*Error)\b/.exec(stack) : null);
  return match ? match[1] : undefined;
}

function formatRuntimeJsError(error: RuntimeJsErrorEvidence | undefined): string {
  if (!error) return 'unknown runtime error';
  const location = error.relativePath || error.source || 'unknown source';
  const line = error.line ? `:${error.line}${error.column ? `:${error.column}` : ''}` : '';
  return `${error.type ? `${error.type}: ` : ''}${error.message} (${location}${line})`;
}

function blockersForProbeEvidence(
  screenEvidence: ScreenEvidence,
  startMapVerified: StartMapVerification,
  idleOrReadyEvidence: IdleOrReadyEvidence,
): string[] {
  const blockers: string[] = [];
  if (!screenEvidence.exists) blockers.push('screen evidence artifact is missing');
  else if (screenEvidence.decodeError) blockers.push(`Screenshot decode failed: ${screenEvidence.decodeError}`);
  else if (!screenEvidence.nonBlank) blockers.push('screen evidence did not prove a non-blank frame');
  if (!startMapVerified.verified) blockers.push(startMapVerified.detail);
  if (!idleOrReadyEvidence.verified) blockers.push(idleOrReadyEvidence.detail);
  return blockers;
}

function probeWorkspaceExcludesSaveDirs(runContext: ProbeWorkspace): boolean {
  if (!runContext.workdir) return false;
  return candidateSavePaths(runContext.projectRoot).every((candidate) => !fs.existsSync(candidate));
}

function deriveSaveIsolationEvidence(
  sourceProject: string,
  runContext: ProbeWorkspace,
  sourceFingerprintBefore: string,
  excludedFromProbeWorkspace: boolean,
  cleanupError?: string,
): SaveIsolationEvidence {
  const sourceFingerprintAfter = fingerprintSaveState(sourceProject);
  const sourceUnchanged = sourceFingerprintBefore === sourceFingerprintAfter;
  const cleaned = runContext.workdir ? !fs.existsSync(runContext.workdir) : false;
  const enabled = Boolean(runContext.workdir)
    && excludedFromProbeWorkspace
    && sourceUnchanged
    && cleaned
    && !cleanupError;
  const strategy: SaveIsolationEvidence['strategy'] = runContext.workdir ? 'temporary-project-copy' : 'direct-project-run';
  let detail = 'Probe ran without save isolation.';
  if (enabled) {
    detail = 'Probe ran in a temporary project copy, save folders were excluded, source save fingerprint stayed unchanged, and the temporary workspace was cleaned.';
  } else if (runContext.workdir && cleanupError) {
    detail = `Probe workspace cleanup failed: ${cleanupError}`;
  } else if (runContext.workdir && !sourceUnchanged) {
    detail = 'Source project save fingerprint changed during probe.';
  } else if (runContext.workdir && !excludedFromProbeWorkspace) {
    detail = 'Probe workspace still contained save directories.';
  } else if (runContext.workdir && !cleaned) {
    detail = 'Probe workspace was not cleaned after run.';
  }
  return {
    enabled,
    strategy,
    sourceProject,
    runProject: runContext.projectRoot,
    probeWorkspace: runContext.workdir || undefined,
    sourceSavePaths: candidateSavePaths(sourceProject).filter((candidate) => fs.existsSync(candidate)),
    excludedFromProbeWorkspace,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    sourceUnchanged,
    cleaned,
    cleanupError,
    detail,
  };
}

function blockersForSaveIsolation(saveIsolation: SaveIsolationEvidence): string[] {
  const blockers: string[] = [];
  if (!saveIsolation.enabled) blockers.push(saveIsolation.detail);
  return blockers;
}

function defaultScreenEvidence(required: boolean, detail: string): ScreenEvidence {
  return {
    required,
    exists: false,
    nonBlank: false,
    screenshotWritten: false,
    detail,
  };
}

function defaultStartMapVerification(
  plan: RmmvPlaytestPlan,
  required: boolean,
  detail: string,
): StartMapVerification {
  return {
    required,
    verified: false,
    expectedStartMapId: plan.startMapId,
    requestedMapId: plan.mapId,
    detail,
  };
}

function defaultSaveIsolation(
  plan: RmmvPlaytestPlan,
  strategy: SaveIsolationEvidence['strategy'],
): SaveIsolationEvidence {
  const fingerprint = fingerprintSaveState(plan.project);
  return {
    enabled: false,
    strategy,
    sourceProject: plan.project,
    sourceSavePaths: candidateSavePaths(plan.project).filter((candidate) => fs.existsSync(candidate)),
    excludedFromProbeWorkspace: false,
    sourceFingerprintBefore: fingerprint,
    sourceFingerprintAfter: fingerprint,
    sourceUnchanged: true,
    cleaned: strategy === 'not-run',
    detail: strategy === 'not-run'
      ? 'Playtest runner did not start; save isolation was not exercised.'
      : 'Plain run executes the configured project directly; use probe mode for temporary-copy save isolation.',
  };
}

function defaultIdleOrReadyEvidence(required: boolean, detail: string): IdleOrReadyEvidence {
  return {
    required,
    verified: false,
    mode: 'missing',
    detail,
  };
}

function fingerprintSaveState(projectRoot: string): string {
  const hash = crypto.createHash('sha256');
  for (const candidate of candidateSavePaths(projectRoot)) {
    const relative = normalizeRel(path.relative(projectRoot, candidate));
    const exists = fs.existsSync(candidate);
    hash.update(`save-dir:${relative}:${exists ? 'exists' : 'missing'}\n`);
    if (!exists || !isDirectory(candidate)) continue;
    for (const file of listFiles(candidate)) {
      const rel = normalizeRel(path.relative(projectRoot, file));
      const stat = fs.statSync(file);
      hash.update(`file:${rel}:${stat.size}:`);
      hash.update(fs.readFileSync(file));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

function candidateSavePaths(projectRoot: string): string[] {
  return [
    path.join(projectRoot, 'save'),
    path.join(projectRoot, 'www', 'save'),
  ];
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(absolute));
    else if (entry.isFile()) out.push(absolute);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function prepareRmmvDeployCandidate(
  workflowRoot: string,
  project: string,
  options: DeployOptions = {},
): RmmvDeployManifest {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = normalizeDeployTarget(options.target);
  const projectRoot = path.resolve(project);
  const layout = resolveRuntimeLayout(projectRoot);
  const checks: RuntimeCheck[] = [];
  const issues: RuntimeIssue[] = [];

  addPathCheck(checks, issues, 'project-dir', 'blocker', projectRoot, 'RMMV project directory', 'directory');
  addPathCheck(checks, issues, 'index-html', 'blocker', layout.indexHtml, 'Browser entry index.html', 'file');
  addPathCheck(checks, issues, 'plugins-js', 'blocker', layout.pluginsJs, 'RMMV plugin configuration plugins.js', 'file');
  addPathCheck(
    checks,
    issues,
    'core-js',
    'blocker',
    layout.webRoot && RPG_MAKER_ENGINE_PROFILES[layout.engine].engineFiles
      .filter((relative) => relative.startsWith('js/') && relative !== 'js/plugins.js')
      .every((relative) => isFile(path.join(layout.webRoot!, ...relative.split('/'))))
      ? path.join(layout.webRoot, 'js')
      : null,
    `RPG Maker ${layout.engine === 'rpg-maker-mz' ? 'MZ' : 'MV'} engine JavaScript set`,
    'directory',
  );
  if (target === 'windows') {
    addPathCheck(checks, issues, 'package-json', 'blocker', layout.packageJson, 'NW.js package metadata', 'file');
  }

  const sourceRoot = target === 'web' && layout.webRoot ? layout.webRoot : projectRoot;
  const outputRoot = path.join(path.resolve(workflowRoot), 'runtime', 'out', 'deploy', target);
  const targetDir = path.join(outputRoot, `${safeProjectName(projectRoot)}-${safeStamp(generatedAt)}`);
  assertSafeOutputTarget(workflowRoot, outputRoot, targetDir);

  const copyPlan = collectDeployFiles(sourceRoot);
  const manifestPath = path.join(targetDir, 'deploy-manifest.json');
  const status: DeployStatus = hasBlockers(issues) ? 'blocked' : 'ready';

  fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(targetDir, { recursive: true });
  if (status === 'ready') {
    for (const file of copyPlan.files) {
      const source = path.join(sourceRoot, file.path);
      const destination = path.join(targetDir, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
  }

  const manifest: RmmvDeployManifest = {
    status,
    target,
    generatedAt,
    project: projectRoot,
    engine: layout.engine,
    sourceRoot,
    targetDir,
    manifestPath,
    files: copyPlan.files,
    excluded: copyPlan.excluded,
    checks,
    issues,
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

function resolveRuntimeLayout(projectRoot: string): {
  engine: RpgMakerEngine;
  webRoot: string | null;
  dataDir: string | null;
  indexHtml: string | null;
  packageJson: string | null;
  pluginsJs: string | null;
  pluginsDir: string | null;
  gameExe: string | null;
} {
  const manifest = inspectRmmvProject(projectRoot);
  const webRoot = manifest.resourceRoot;
  const dataDir = manifest.dataDir;
  const packageJson = firstExistingFile([
    path.join(projectRoot, 'package.json'),
    webRoot ? path.join(webRoot, 'package.json') : '',
  ]);
  return {
    engine: manifest.engine,
    webRoot,
    dataDir,
    indexHtml: webRoot ? path.join(webRoot, 'index.html') : null,
    packageJson,
    pluginsJs: webRoot ? path.join(webRoot, 'js', 'plugins.js') : null,
    pluginsDir: webRoot ? path.join(webRoot, 'js', 'plugins') : null,
    gameExe: firstExistingFile([path.join(projectRoot, 'Game.exe')]),
  };
}

function resolveRunner(
  projectRoot: string,
  layout: ReturnType<typeof resolveRuntimeLayout>,
  nwjsRunner?: string,
): { kind: 'game-exe' | 'nwjs' | 'missing'; path?: string; command?: RuntimeCommand; detail: string } {
  if (layout.engine === 'rpg-maker-mz') {
    try {
      const runtime = resolveRpgMakerMZProjectRuntime(projectRoot);
      return {
        kind: 'game-exe',
        path: runtime.executable,
        command: { executable: runtime.executable, args: [projectRoot], cwd: projectRoot },
        detail: 'The validated project-local RPG Maker MZ Game.exe runtime is available.',
      };
    } catch (error) {
      return {
        kind: 'missing',
        path: path.join(projectRoot, 'Game.exe'),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (nwjsRunner) {
    const runnerPath = path.resolve(nwjsRunner);
    if (!isFile(runnerPath)) {
      return {
        kind: 'missing',
        path: runnerPath,
        detail: `Configured NW.js runner does not exist: ${runnerPath}`,
      };
    }
    const appRoot = layout.packageJson ? path.dirname(layout.packageJson) : layout.webRoot;
    if (!appRoot) {
      return {
        kind: 'missing',
        path: runnerPath,
        detail: 'Configured NW.js runner exists, but no app root with index.html/package.json was found.',
      };
    }
    return {
      kind: 'nwjs',
      path: runnerPath,
      command: { executable: runnerPath, args: [appRoot], cwd: appRoot },
      detail: `NW.js runner is available at ${runnerPath}.`,
    };
  }
  if (layout.gameExe) {
    return {
      kind: 'game-exe',
      path: layout.gameExe,
      command: { executable: layout.gameExe, args: [], cwd: projectRoot },
      detail: `Game.exe is available at ${layout.gameExe}.`,
    };
  }
  return {
    kind: 'missing',
    path: path.join(projectRoot, 'Game.exe'),
    detail: 'No real NW.js runner was found. Provide a NW.js executable path or include Game.exe; playtest remains blocked.',
  };
}

function inspectPluginFiles(
  pluginsJs: string,
  pluginsDir: string | null,
  checks: RuntimeCheck[],
  issues: RuntimeIssue[],
): void {
  const plugins = readPluginsConfig(pluginsJs);
  if ('error' in plugins) {
    checks.push({
      id: 'plugins-js-parse',
      severity: 'blocker',
      pass: false,
      path: pluginsJs,
      detail: plugins.error,
    });
    issues.push({
      severity: 'blocker',
      code: 'plugins-js-parse-failed',
      message: plugins.error,
      path: pluginsJs,
    });
    return;
  }
  checks.push({
    id: 'plugins-js-parse',
    severity: 'blocker',
    pass: true,
    path: pluginsJs,
    detail: `${plugins.entries.length} plugin entries parsed`,
  });
  for (const plugin of plugins.entries) {
    if (!plugin.name) continue;
    const filePath = pluginsDir ? path.join(pluginsDir, `${plugin.name}.js`) : null;
    const pass = Boolean(filePath && isFile(filePath));
    const severity: RuntimeIssueSeverity = plugin.status ? 'blocker' : 'warning';
    checks.push({
      id: `plugin-file-${plugin.name}`,
      severity,
      pass,
      path: filePath || undefined,
      detail: plugin.status
        ? `Enabled plugin ${plugin.name} must have a JS file`
        : `Disabled plugin ${plugin.name} file is optional but tracked`,
    });
    if (!pass) {
      issues.push({
        severity,
        code: plugin.status ? 'enabled-plugin-file-missing' : 'disabled-plugin-file-missing',
        message: `${plugin.status ? 'Enabled' : 'Disabled'} plugin ${plugin.name} is missing its JS file.`,
        path: filePath || undefined,
      });
    }
  }
}

function readPluginsConfig(filePath: string): { entries: { name: string; status: boolean }[] } | { error: string } {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return { error: `Cannot locate $plugins array in ${filePath}` };
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as Array<{ name?: unknown; status?: unknown }>;
    return {
      entries: (data || [])
        .filter(Boolean)
        .map((entry) => ({
          name: typeof entry.name === 'string' ? entry.name : '',
          status: Boolean(entry.status),
        })),
    };
  } catch (error) {
    return { error: `Cannot parse ${filePath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function collectDeployFiles(sourceRoot: string): { files: DeployManifestEntry[]; excluded: DeployExcludedEntry[] } {
  const files: DeployManifestEntry[] = [];
  const excluded: DeployExcludedEntry[] = [];
  walkDeployRoot(sourceRoot, '', files, excluded);
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excluded };
}

function walkDeployRoot(
  sourceRoot: string,
  relativeDir: string,
  files: DeployManifestEntry[],
  excluded: DeployExcludedEntry[],
): void {
  const dir = path.join(sourceRoot, relativeDir);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = normalizeRel(path.join(relativeDir, entry.name));
    const exclusion = deployExclusionReason(rel);
    if (exclusion) {
      excluded.push({ path: rel, reason: exclusion });
      continue;
    }
    const absolute = path.join(sourceRoot, rel);
    if (entry.isDirectory()) {
      walkDeployRoot(sourceRoot, rel, files, excluded);
    } else if (entry.isFile()) {
      files.push({ path: rel, bytes: fs.statSync(absolute).size });
    }
  }
}

function deployExclusionReason(rel: string): string | null {
  const lower = rel.toLowerCase();
  const segments = lower.split('/');
  if (segments.includes('node_modules')) return 'dependencies must not be copied into deploy source candidates';
  if (segments.includes('runtime')) return 'runtime state is local-only';
  if (segments.includes('secrets')) return 'secrets are local-only';
  if (segments.includes('.git')) return 'git metadata is not part of deploy candidates';
  if (segments.includes('save')) return 'RMMV save data is local runtime state';
  if (lower === '.env' || lower.startsWith('.env.')) return 'local environment file';
  return null;
}

function addPathCheck(
  checks: RuntimeCheck[],
  issues: RuntimeIssue[],
  id: string,
  severity: RuntimeIssueSeverity,
  filePath: string | null,
  detail: string,
  kind: 'file' | 'directory',
): void {
  const pass = kind === 'file' ? Boolean(filePath && isFile(filePath)) : Boolean(filePath && isDirectory(filePath));
  checks.push({ id, severity, pass, path: filePath || undefined, detail });
  if (!pass) {
    issues.push({
      severity,
      code: `${id}-missing`,
      message: `${detail} is missing.`,
      path: filePath || undefined,
    });
  }
}

function firstExistingFile(candidates: string[]): string | null {
  return candidates.filter(Boolean).find((candidate) => isFile(candidate)) || null;
}

function resolveMapFileForRuntime(
  workflowRoot: string,
  project: string,
  dataDir: string | null,
  mapId: number,
): string | null {
  try {
    const stagedOrSource = getMapFileForRead(workflowRoot, project, mapId);
    if (stagedOrSource) return stagedOrSource;
  } catch {
    // Runtime readiness checks must also work before the staging database is bootstrapped.
  }
  return dataDir ? path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`) : null;
}

function firstExistingDirectory(candidates: string[], requiredChild?: string): string | null {
  return candidates.filter(Boolean).find((candidate) => {
    if (!isDirectory(candidate)) return false;
    return requiredChild ? isFile(path.join(candidate, requiredChild)) : true;
  }) || null;
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function hasBlockers(issues: RuntimeIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocker');
}

function initializeRunLogs(plan: RmmvPlaytestPlan, timeoutMs: number): void {
  fs.mkdirSync(path.dirname(plan.logPath), { recursive: true });
  fs.writeFileSync(plan.stdoutPath, '', 'utf8');
  fs.writeFileSync(plan.stderrPath, '', 'utf8');
  fs.writeFileSync(plan.logPath, `RPG-Agent-MV playtest run\nplan: ${plan.artifactPath}\ntimeoutMs: ${timeoutMs}\n`, 'utf8');
  for (const issue of plan.issues) {
    fs.appendFileSync(plan.logPath, `[${issue.severity}] ${issue.code}: ${issue.message}\n`, 'utf8');
  }
}

function appendRunLog(filePath: string, text: string): void {
  fs.appendFileSync(filePath, text, 'utf8');
}

function buildRunResult(
  plan: RmmvPlaytestPlan,
  payload: {
    status: Exclude<RuntimeExecutionStatus, 'not-started'>;
    startedAt?: string;
    endedAt: string;
    durationMs: number;
    timeoutMs: number;
    pid?: number;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    runnerStarted: boolean;
    processExited: boolean;
    probeStatus?: string;
    screenEvidence?: ScreenEvidence;
    startMapVerified?: StartMapVerification;
    saveIsolation?: SaveIsolationEvidence;
    idleOrReadyEvidence?: IdleOrReadyEvidence;
    runtimeFailure?: RuntimeFailureEvidence;
    evidenceFiles?: string[];
    blockers?: string[];
    command?: RuntimeCommand;
    error?: string;
    artifactPath: string;
  },
): RmmvPlaytestRunResult {
  const probeRequested = plan.probe?.enabled === true;
  return {
    status: payload.status,
    execution: payload.status,
    probeStatus: payload.probeStatus,
    screenEvidence: payload.screenEvidence || defaultScreenEvidence(probeRequested, probeRequested
      ? 'Probe did not start, so no screenshot evidence was produced.'
      : 'Screen proof was not requested. Use probe mode for screenshot evidence.'),
    startMapVerified: payload.startMapVerified || defaultStartMapVerification(plan, probeRequested, probeRequested
      ? 'Probe did not start, so start map verification was not produced.'
      : 'Start map proof was not requested. Use probe mode for runtime map verification.'),
    saveIsolation: payload.saveIsolation || defaultSaveIsolation(plan, payload.runnerStarted ? 'direct-project-run' : 'not-run'),
    idleOrReadyEvidence: payload.idleOrReadyEvidence || defaultIdleOrReadyEvidence(probeRequested, probeRequested
      ? 'Probe did not start, so idle/ready evidence was not produced.'
      : 'Idle/ready proof was not requested. Use probe mode for runtime playable-state evidence.'),
    runtimeFailure: payload.runtimeFailure,
    evidenceFiles: dedupe([
      payload.artifactPath,
      ...(payload.evidenceFiles || [
        plan.logPath,
        plan.stdoutPath,
        plan.stderrPath,
      ]),
    ]),
    blockers: payload.blockers || [],
    generatedAt: plan.generatedAt,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    durationMs: payload.durationMs,
    timeoutMs: payload.timeoutMs,
    project: plan.project,
    mapId: plan.mapId,
    startX: plan.startX,
    startY: plan.startY,
    command: payload.command || plan.command,
    pid: payload.pid,
    exitCode: payload.exitCode,
    signal: payload.signal,
    runnerStarted: payload.runnerStarted,
    processExited: payload.processExited,
    timedOut: payload.timedOut,
    error: payload.error,
    logPath: plan.logPath,
    stdoutPath: plan.stdoutPath,
    stderrPath: plan.stderrPath,
    artifactPath: payload.artifactPath,
    planArtifactPath: plan.artifactPath,
    checks: plan.checks,
    issues: plan.issues,
  };
}

function stopProcessTree(child: childProcess.ChildProcess | null): void {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    // Fall through to taskkill on Windows.
  }
  if (process.platform === 'win32' && child.pid) {
    childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}

function normalizePlaytestTimeoutMs(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_PLAYTEST_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100) throw new Error('--timeout-ms must be an integer >= 100');
  return parsed;
}

function normalizeCoordinate(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeDeployTarget(value: unknown): DeployTarget {
  return value === 'windows' ? 'windows' : 'web';
}

function safeStamp(value: string): string {
  return value.replace(/[:.]/g, '-').replace(/[^A-Za-z0-9_-]/g, '-');
}

function safeProjectName(projectRoot: string): string {
  return path.basename(projectRoot).replace(/[^A-Za-z0-9_-]/g, '-') || 'Project';
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function assertSafeOutputTarget(workflowRoot: string, outputRoot: string, targetDir: string): void {
  const root = path.resolve(workflowRoot);
  const output = path.resolve(outputRoot);
  const target = path.resolve(targetDir);
  if (!isPathInside(root, output)) throw new Error(`Deploy output root must stay inside ${root}`);
  if (!isPathInside(output, target)) throw new Error(`Deploy target must stay inside ${output}`);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
