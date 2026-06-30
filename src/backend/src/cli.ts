#!/usr/bin/env node

import "./suppress-warnings.ts";

// Keep JSON stdout machine-parseable when agents mistakenly merge stderr (2>&1).
(process as NodeJS.Process & { noWarnings?: boolean }).noWarnings = true;

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage, type ProductLanguage } from "../../contract/i18n.ts";
import { parseArgs } from "./cli/args.ts";
import { printHelp } from "./cli/help.ts";
import { buildReleaseManifest, checkReleasePackages, createReleaseSourceTree } from "./core/desktop/release-boundary.ts";
import {
  prepareRmmvDeployCandidate,
  prepareRmmvPlaytestPlan,
  runPlaytest as runRmmvPlaytest,
  type DeployTarget,
} from "./core/desktop/runtime-deploy-service.ts";
import { resolveProjectPath } from "./core/desktop/project-service.ts";
import { pruneWorkspaceLegacyArtifacts } from "./core/desktop/workspace-legacy-cleanup.ts";
import { backendText, type BackendMessageKey } from "./core/i18n/messages.ts";
import { bootstrapDatabase } from "./core/db/bootstrap.ts";
import { initFileLogger } from "./core/file-log.ts";
import { writeOpencodeProviderSeedFile } from "./core/llm/cc-switch-provider-sync.ts";
import { resolveWorkflowRoot } from "./core/workspace-paths.ts";
import { executeWorkflow } from "./core/workflow/orchestrator/run.ts";

interface ParsedArgs {
  dryRun?: boolean;
  command?: string;
  label?: string;
  target?: string;
  mapId?: number;
  eventId?: number;
  format?: string;
  waitMs?: number;
  timeoutMs?: number;
  [key: string]: unknown;
}

function runWorkspacePruneLegacy(rest: string[]): number {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const result = pruneWorkspaceLegacyArtifacts(workflowRoot, { dryRun: Boolean(args.dryRun) });
  const action = args.dryRun ? "would remove" : "removed";
  console.log(`workspace-prune-legacy: ${action} ${result.removed.length} path(s)`);
  for (const rel of result.removed) {
    console.log(`  ${args.dryRun ? "[dry-run]" : "-"} ${rel}`);
  }
  if (result.skipped.length > 0) {
    console.warn(`skipped ${result.skipped.length} path(s): ${result.skipped.join(", ")}`);
  }
  return result.skipped.length > 0 ? 1 : 0;
}

function runReleaseSource(rest: string[]): number {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const result = args.apply
    ? createReleaseSourceTree(workflowRoot)
    : {
        ...buildReleaseManifest(workflowRoot),
        targetDir: null,
        manifestPath: null,
      };
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return result.issues.some((issue) => issue.severity === "blocker") ? 1 : 0;
  }
  console.log(`release-source: ${result.files.length} file(s) included, ${result.excluded.length} excluded`);
  console.log(`  scope: ${result.scope.kind} release`);
  if (result.scope.notProven.length > 0) {
    console.log(`  not proven: ${result.scope.notProven.join("; ")}`);
  }
  for (const issue of result.issues) {
    console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    for (const evidence of issue.evidence || []) {
      console.log(`    - ${evidence}`);
    }
  }
  if (args.apply) {
    console.log(`  source tree: ${result.targetDir}`);
    console.log(`  manifest: ${result.manifestPath}`);
  } else {
    console.log("  dry-run only; pass --apply or run npm run release:source to create the source tree");
  }
  return result.issues.some((issue) => issue.severity === "blocker") ? 1 : 0;
}

// 离线导入（dev 期一次性工具）：读 cc-switch 内置 opencode 供应商预设目录 → 写本地种子库（key-free）。
// 不读 ~/.cc-switch/cc-switch.db 用户配置。非产品运行时路径；只有开发者在本机手动执行。
async function runDevImportProviderSeeds(rest: string[]): Promise<number> {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const result = await writeOpencodeProviderSeedFile(workflowRoot);
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`provider-seeds: imported ${result.written} opencode preset(s) from cc-switch catalog (offline, key-free)`);
    console.log(`  seed: ${result.seedPath}`);
    console.log(`  source: ${result.sourcePath}`);
    if (result.skipped.length > 0) {
      console.log(`  skipped: ${result.skipped.length}`);
    }
    if (result.errors.length > 0) {
      console.log(`  errors: ${result.errors.length}`);
    }
  }
  return result.errors.length > 0 ? 1 : 0;
}

function runReleaseCheck(rest: string[]): number {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const result = checkReleasePackages(workflowRoot);
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return result.issues.some((issue) => issue.severity === "blocker") ? 1 : 0;
  }

  console.log("release-check:");
  console.log(`  source: ${result.source.files.length} file(s) included, ${result.source.excluded.length} excluded`);
  console.log(`  web: ${result.web.status}`);
  console.log(`    files: ${result.web.files.length}`);
  for (const evidence of result.web.evidence) {
    console.log(`    - ${evidence}`);
  }
  console.log(`  electron: ${result.electron.status}`);
  console.log(`    files: ${result.electron.files.length}`);
  for (const evidence of result.electron.evidence) {
    console.log(`    - ${evidence}`);
  }
  for (const issue of result.issues) {
    console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    for (const evidence of issue.evidence || []) {
      console.log(`    - ${evidence}`);
    }
  }
  return result.issues.some((issue) => issue.severity === "blocker") ? 1 : 0;
}

async function runPlaytestPlan(rest: string[]): Promise<number> {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const project = resolveProjectPath(workflowRoot, args.project as string | undefined);
  const options = {
    mapId: args.mapId as number | undefined,
    startX: args.startX as number | undefined,
    startY: args.startY as number | undefined,
    nwjsRunner: args.nwjs as string | undefined,
    timeoutMs: args.timeoutMs as number | undefined,
    probe: args.probe as boolean | undefined,
    probeKeywords: args.probeKeywords as string[] | undefined,
  };
  const result = args.apply
    ? await runRmmvPlaytest(workflowRoot, project, options)
    : prepareRmmvPlaytestPlan(workflowRoot, project, options);
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${args.apply ? "playtest-run" : "playtest-plan"}: ${result.status}`);
    console.log(`  artifact: ${result.artifactPath}`);
    console.log(`  log: ${result.logPath}`);
    if (result.command) {
      console.log(`  command: ${result.command.executable} ${result.command.args.join(" ")}`.trim());
    }
    if (args.apply && "exitCode" in result) {
      console.log(`  stdout: ${result.stdoutPath}`);
      console.log(`  stderr: ${result.stderrPath}`);
      console.log(`  exitCode: ${result.exitCode ?? "(none)"}`);
      console.log(`  signal: ${result.signal ?? "(none)"}`);
      console.log(`  timedOut: ${result.timedOut ? "yes" : "no"}`);
      console.log(`  runnerStarted: ${result.runnerStarted ? "yes" : "no"}`);
      console.log(`  processExited: ${result.processExited ? "yes" : "no"}`);
      if (result.probeStatus) console.log(`  probeStatus: ${result.probeStatus}`);
      console.log(`  screenEvidence: ${result.screenEvidence.detail}`);
      console.log(`  startMapVerified: ${result.startMapVerified.detail}`);
      console.log(`  saveIsolation: ${result.saveIsolation.detail}`);
      console.log(`  idleOrReadyEvidence: ${result.idleOrReadyEvidence.detail}`);
      for (const blocker of result.blockers) {
        console.log(`  [blocker] ${blocker}`);
      }
    }
    for (const issue of result.issues) {
      console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }
  return result.status === "blocked" || result.status === "failed" || result.status === "timed-out" ? 1 : 0;
}

function runDeploySource(rest: string[]): number {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const project = resolveProjectPath(workflowRoot, args.project as string | undefined);
  const target = normalizeDeployTarget(args.target);
  const result = prepareRmmvDeployCandidate(workflowRoot, project, { target });
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`deploy-source: ${result.status} (${result.target})`);
    console.log(`  target: ${result.targetDir}`);
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(`  files: ${result.files.length}, excluded: ${result.excluded.length}`);
    for (const issue of result.issues) {
      console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }
  return result.status === "blocked" ? 1 : 0;
}

async function runAgentConsole(): Promise<void> {
  console.log(cliText("cli.agentConsole.moved"));
  console.log(cliText("cli.agentConsole.startCommand"));
  console.log(cliText("cli.agentConsole.readme"));
}

async function runUiControl(rest: string[]): Promise<number> {
  const args = parseArgs(rest) as ParsedArgs;
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const command = buildUiControlCommand(args);
  const result = await sendUiControlCommand(workflowRoot, command);
  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`ui-control: ${result.ok ? "ok" : "failed"}`);
    if (result.snapshot && typeof result.snapshot === "object") {
      const snapshot = result.snapshot as { screenshotPath?: unknown; metadataPath?: unknown };
      if (snapshot.screenshotPath) console.log(`  screenshot: ${snapshot.screenshotPath}`);
      if (snapshot.metadataPath) console.log(`  metadata: ${snapshot.metadataPath}`);
    }
    if (result.error) console.log(`  error: ${result.error}`);
  }
  return result.ok ? 0 : 1;
}

async function runWorkflowCommand(rest: string[]): Promise<number> {
  const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
  const [sub, ...subRest] = rest;

  if (sub !== "run") {
    throw new Error(
      `Unknown workflow subcommand: ${sub ?? "(none)"}。用法：workflow run --script <脚本文件> [--summary <说明>] [--title <标题>] [--project <工程>]`,
    );
  }

  const args = parseArgs(subRest) as ParsedArgs;
  const scriptFile = args.script as string | undefined;
  if (!scriptFile) {
    throw new Error("workflow run 需要 --script <脚本文件>（AI 现写的只读编排脚本）。");
  }
  const script = fs.readFileSync(path.resolve(scriptFile), "utf8");
  const project = resolveProjectPath(workflowRoot, args.project as string | undefined);
  const title = (args.title as string | undefined) ?? path.basename(scriptFile);

  if (args.dryRun) {
    console.log(`workflow run [dry-run]`);
    console.log(`  project: ${project}`);
    console.log(`  script: ${path.resolve(scriptFile)} (${script.length} chars)`);
    console.log("  dry-run: 已读入脚本，未派发任何子 agent。");
    return 0;
  }

  const record = await executeWorkflow({
    workflowRoot,
    project,
    script,
    summary: args.summary as string | undefined,
    title,
    productLanguage: cliLanguage(),
    onEvent: (event) => {
      if (event.type === "log") console.log(`  · ${event.message}`);
    },
  });

  const reportPath = path.join(workflowRoot, "runtime", "out", "workflows", record.runId, "report.json");
  if (args.format === "json") {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`workflow run ${title}: ${record.status}`);
    console.log(`  runId: ${record.runId}`);
    console.log(`  子 agent: ${record.agentCount}，tokens: in ${record.inputTokens} / out ${record.outputTokens}`);
    if (record.error) console.log(`  error: ${record.error}`);
    console.log(`  report: ${reportPath}`);
  }
  return record.status === "completed" ? 0 : 1;
}

const commandRunners: Record<string, (rest: string[]) => unknown> = {
  "agent-console": runAgentConsole,
  "workflow": runWorkflowCommand,
  "dev-import-provider-seeds": runDevImportProviderSeeds,
  "deploy-source": runDeploySource,
  "playtest-plan": runPlaytestPlan,
  "release-check": runReleaseCheck,
  "release-source": runReleaseSource,
  "ui-control": runUiControl,
  "workspace-prune-legacy": runWorkspacePruneLegacy,
};

function buildUiControlCommand(args: ParsedArgs): Record<string, unknown> {
  const type = String(args.command || "capture-current");
  if (!["capture-current", "navigate", "open-event-editor", "state", "click", "input", "key", "read", "wait"].includes(type)) {
    throw new Error("--command must be capture-current, navigate, open-event-editor, state, click, input, key, read, or wait");
  }
  const command: Record<string, unknown> = {
    type,
    label: args.label,
    capture: args.capture,
    waitMs: args.waitMs,
    timeoutMs: args.timeoutMs,
  };
  if (type === "navigate") {
    if (!args.target) throw new Error("--target is required for ui-control --command navigate");
    command.target = args.target;
  }
  if (type === "open-event-editor") {
    if (!args.mapId) throw new Error("--map-id is required for ui-control --command open-event-editor");
    if (!args.eventId) throw new Error("--event-id is required for ui-control --command open-event-editor");
    command.mapId = args.mapId;
    command.eventId = args.eventId;
  }
  if (["click", "input", "read", "wait"].includes(type)) {
    addUiControlElementTarget(command, args, type);
  }
  if (type === "input") {
    if (args.text === undefined) throw new Error("--text is required for ui-control --command input");
    command.text = args.text;
  }
  if (type === "key") {
    if (args.selector || args.testId) addUiControlElementTarget(command, args, type);
    if (!args.key) throw new Error("--key is required for ui-control --command key");
    command.key = args.key;
    if (args.modifiers) command.modifiers = args.modifiers;
  }
  if (type === "wait") {
    if (args.condition) command.condition = args.condition;
    if (args.expect !== undefined) command.expect = args.expect;
  }
  return Object.fromEntries(Object.entries(command).filter(([, value]) => value !== undefined));
}

function addUiControlElementTarget(command: Record<string, unknown>, args: ParsedArgs, type: string): void {
  if (args.selector && args.testId) throw new Error("Use either --selector or --test-id, not both");
  if (!args.selector && !args.testId) throw new Error(`--selector or --test-id is required for ui-control --command ${type}`);
  if (args.selector) command.selector = args.selector;
  if (args.testId) command.testId = args.testId;
}

async function sendUiControlCommand(workflowRoot: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const infoPath = path.join(workflowRoot, "runtime", "out", "ui-control", "server.json");
  if (!fs.existsSync(infoPath)) {
    throw new Error("UI control bridge is not running. Start the Electron desktop app first.");
  }
  const info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as { commandUrl?: string; token?: string };
  if (!info.commandUrl || !info.token) throw new Error("UI control bridge metadata is invalid.");
  const response = await fetch(info.commandUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-rpg-token": info.token,
    },
    body: JSON.stringify(command),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok && result.ok !== false) {
    return { ok: false, error: `UI control bridge returned HTTP ${response.status}`, result };
  }
  return result;
}

function normalizeDeployTarget(value: unknown): DeployTarget {
  if (value === undefined || value === null || value === "" || value === "web") return "web";
  if (value === "windows") return "windows";
  throw new Error("--target must be web or windows");
}

function cliLanguage(): ProductLanguage {
  const explicit = String(process.env.RMMV_PRODUCT_LANGUAGE || process.env.RPG_AGENT_MV_LANGUAGE || "").trim();
  if (explicit) return normalizeProductLanguage(explicit);
  const locale = String(process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || "").toLowerCase();
  return locale.startsWith("en") ? "en-US" : DEFAULT_PRODUCT_LANGUAGE;
}

function cliText(key: BackendMessageKey): string {
  return backendText(key, cliLanguage());
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  const runner = commandRunners[command];
  if (!runner) throw new Error(`Unknown maintenance command: ${command}`);
  const result = runner(rest);
  return result instanceof Promise ? await result : (result as number);
}

Promise.resolve()
  .then(() => initFileLogger())
  .then(() => bootstrapDatabase(resolveWorkflowRoot(import.meta.dirname)))
  .then(() => main(process.argv.slice(2)))
  .then((code: unknown) => {
    process.exitCode = code as number;
  })
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
