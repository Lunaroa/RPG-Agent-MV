import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { format } from "node:util";

const OPENCODE_DIR = ".opencode";
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _initialized = false;
let _logsRoot: string | null = null; // .opencode/logs
let _sessionId: string = "";

// ── 工具函数 ──

function findOpencodeDir(fromDir: string): string | null {
  let current = path.resolve(fromDir);
  while (true) {
    const candidate = path.join(current, OPENCODE_DIR);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  if (args.length === 1 && typeof args[0] === "string") return args[0];
  try {
    return format(...args);
  } catch {
    return args.map(String).join(" ");
  }
}

// ── 写入 ──

/**
 * 写入一条日志。
 * - tools:  .opencode/logs/tools/{date}/{sessionId}.log       （所有工具共用）
 * - skills: .opencode/logs/skills/{name}/{date}/{sessionId}.log（按技能名分目录）
 */
function writeEntry(
  category: string,
  name: string,
  level: string,
  tag: string,
  args: unknown[],
  splitByName: boolean,
): void {
  if (!_logsRoot || !_sessionId) return;
  const segments = splitByName
    ? [_logsRoot, category, name, today()]
    : [_logsRoot, category, today()];
  const dir = path.join(...segments);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${_sessionId}.log`);
    const line = `${timestamp()} ${level} [${tag}] ${formatArgs(args)}\n`;
    fs.appendFileSync(file, line);
  } catch {
    /* 日志写入失败不能影响主流程 */
  }
}

// ── 清理 ──

function cleanupOldLogs(rootDir: string): void {
  const cutoff = Date.now() - MAX_LOG_AGE_MS;
  walkDateDirs(rootDir, cutoff);
}

/** 递归查找 {YYYY-MM-DD}/ 目录，删除过期日期下的所有文件。 */
function walkDateDirs(dir: string, cutoff: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 日期目录？
      const m = /^(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
      if (m) {
        const fileDate = new Date(m[1]);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
          try {
            for (const f of fs.readdirSync(full)) fs.unlinkSync(path.join(full, f));
            fs.rmdirSync(full);
          } catch { /* ignore */ }
        }
      } else {
        walkDateDirs(full, cutoff);
      }
    }
  }
}

// ── 公共 API ──

/**
 * 初始化文件日志系统。幂等——多次调用只有首次生效。
 *
 * 从环境变量 AIWF_SESSION_ID 读取会话 ID；若无则生成 cli-{时间戳}-{uuid8}。
 * 目录结构：
 *   .opencode/logs/tools/{date}/{sessionId}.log
 *   .opencode/logs/skills/{name}/{date}/{sessionId}.log
 */
export function initFileLogger(): void {
  if (_initialized) return;
  _initialized = true;

  const base =
    process.env.AGENT_RPG_ROOT?.trim() ||
    process.env.AIWF_WORKFLOW_ROOT?.trim() ||
    process.env.RMMV_AGENT_WORKFLOW_ROOT?.trim() ||
    process.cwd();

  const opencodeDir = findOpencodeDir(base);
  if (!opencodeDir) return;

  _logsRoot = path.join(opencodeDir, "logs");
  fs.mkdirSync(_logsRoot, { recursive: true });

  _sessionId =
    process.env.AIWF_SESSION_ID?.trim() ||
    `cli-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // 异步清理旧日志
  setImmediate(() => cleanupOldLogs(_logsRoot!));
}

/** 当前会话 ID（initFileLogger 后可用）。 */
export function getLogSessionId(): string {
  return _sessionId;
}

export interface ToolDiagnosticRecord {
  diagnosticId: string;
  tool: string;
  action: string;
  phase: "started" | "completed" | "failed";
  at: string;
  durationMs?: number;
  projectId?: string | null;
  bindingVersion?: number;
  stage?: string;
  warning?: string;
  errorCode?: string;
  errorType?: string;
  error?: string;
  stack?: string;
}

/** Append a structured per-tool diagnostic beside the desktop turn artifacts. */
export function appendToolDiagnostic(record: ToolDiagnosticRecord): void {
  const sessionLogDir = String(process.env.AIWF_SESSION_LOG_DIR || "").trim();
  if (!sessionLogDir) {
    toolLogger("diagnostic")[record.phase === "failed" ? "error" : "warn"](JSON.stringify(redactDiagnostic(record)));
    return;
  }
  try {
    fs.mkdirSync(sessionLogDir, { recursive: true });
    fs.appendFileSync(
      path.join(sessionLogDir, "tool-internal.jsonl"),
      `${JSON.stringify(redactDiagnostic(record))}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never change tool behavior.
  }
}

function redactDiagnostic<T>(value: T): T {
  const walk = (input: unknown, key = ""): unknown => {
    if (/token|secret|password|credential|api.?key|authorization/i.test(key)) return "[REDACTED]";
    if (Array.isArray(input)) return input.map((item) => walk(item));
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        walk(child, childKey),
      ]));
    }
    if (typeof input === "string") {
      return input
        .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
    }
    return input;
  };
  return walk(value) as T;
}

// ── Logger ──

export interface Logger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const _cache = new Map<string, Logger>();

/**
 * 获取工具日志器。所有工具的日志写入同一个文件
 * .opencode/logs/tools/{date}/{sessionId}.log，每行带 [module] 标签区分来源。
 *
 * @example
 *   const log = toolLogger('event-page-compiler');
 *   log.warn('命令归一化修正了 3 处：add→increase; ...');
 */
export function toolLogger(module: string): Logger {
  const key = `tools/${module}`;
  let logger = _cache.get(key);
  if (!logger) {
    logger = {
      warn: (...args: unknown[]) => writeEntry("tools", module, "WARN", module, args, false),
      error: (...args: unknown[]) => writeEntry("tools", module, "ERROR", module, args, false),
    };
    _cache.set(key, logger);
  }
  return logger;
}

/**
 * 获取技能日志器。按技能名分目录：
 * .opencode/logs/skills/{name}/{date}/{sessionId}.log
 *
 * @example
 *   const log = skillLogger('story-writing-constraints');
 *   log.warn('大纲缺少游戏体验段落');
 */
export function skillLogger(name: string): Logger {
  const key = `skills/${name}`;
  let logger = _cache.get(key);
  if (!logger) {
    logger = {
      warn: (...args: unknown[]) => writeEntry("skills", name, "WARN", name, args, true),
      error: (...args: unknown[]) => writeEntry("skills", name, "ERROR", name, args, true),
    };
    _cache.set(key, logger);
  }
  return logger;
}
