import fs from "node:fs";
import path from "node:path";

import { resolveMemoryUserProfilePath, resolveProjectMemoryDir } from "../workspace-paths.ts";
import {
  MEMORY_TOPIC_TYPES,
  type MemoryActivityEntry,
  type MemoryFileInfo,
  type MemoryProgressEntry,
  type MemoryProfileInfo,
  type MemoryTopic,
  type MemoryTopicType,
  type ProjectMemoryOverview,
  type ProjectMemorySnapshot,
} from "./memory-types.ts";

/** Hard caps on the long-term index, mirroring Claude Code's memdir constants exactly. */
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25_000;

const WORK_MANUAL_FILE = "AGENTS.md";
const INDEX_FILE = "MEMORY.md";
const PROGRESS_FILE = "CURRENT.md";
const TOPICS_DIR = "topics";
const ACTIVITY_LOG_FILE = "activity.log.jsonl";
const DEFAULT_ACTIVITY_LIMIT = 50;
const PROGRESS_MAX_FIELD_CHARS = 1_200;

/** Lazy GC: drop CURRENT.md entries whose updatedAt is older than this on the next progress.write. */
export const PROGRESS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Lazy GC: trim activity.log.jsonl back to this many lines whenever it grows past it. */
export const ACTIVITY_LOG_MAX_LINES = 1_000;

// ── Path resolution + security boundary ─────────────────────────────

function projectDir(workflowRoot: string, projectId: string): string {
  return resolveProjectMemoryDir(workflowRoot, projectId);
}

/**
 * The single security boundary for every memory write/read: reject any candidate
 * path that escapes the project's memory directory (`..` traversal, absolute
 * paths, or symlink-style escapes). Returns the normalized absolute path.
 */
export function assertInsideMemoryDir(dir: string, candidate: string): string {
  const root = path.resolve(dir);
  const resolved = path.resolve(root, candidate);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Memory path "${candidate}" escapes the project memory directory.`);
  }
  return resolved;
}

// ── Slug + frontmatter helpers ──────────────────────────────────────

export function slugifyTopicName(name: string): string {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Cannot derive a topic slug from "${name}".`);
  return slug;
}

function singleLine(value: string): string {
  return String(value || "").replace(/\r?\n/g, " ").trim();
}

function normalizeTopicType(raw: unknown): MemoryTopicType {
  const value = String(raw || "").trim() as MemoryTopicType;
  if (!MEMORY_TOPIC_TYPES.includes(value)) {
    throw new Error(`Topic type must be one of: ${MEMORY_TOPIC_TYPES.join(", ")}.`);
  }
  return value;
}

function serializeTopic(topic: MemoryTopic): string {
  const name = singleLine(topic.name) || topic.slug;
  const description = singleLine(topic.description);
  const type = normalizeTopicType(topic.type);
  const body = String(topic.body || "").replace(/^﻿/, "").trimEnd();
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `type: ${type}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

interface ParsedTopicHeader {
  name: string;
  description: string;
  type?: MemoryTopicType;
}

function parseTopicHeader(text: string, slug: string): ParsedTopicHeader {
  const trimmed = text.replace(/^﻿/, "");
  const fm = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { name: slug, description: "" };
  const block = fm[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() || slug;
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
  const rawType = block.match(/^type:\s*(.+)$/m)?.[1]?.trim();
  const type = rawType && MEMORY_TOPIC_TYPES.includes(rawType as MemoryTopicType)
    ? (rawType as MemoryTopicType)
    : undefined;
  return { name, description, type };
}

// ── Reads ───────────────────────────────────────────────────────────

export function readWorkManual(workflowRoot: string, projectId: string): string {
  return readIfExists(path.join(projectDir(workflowRoot, projectId), WORK_MANUAL_FILE));
}

/**
 * The shared author profile (`memory/main/USER.md`) — cross-project, injected verbatim.
 * Its path is a fixed constant (no caller-supplied relative path), so there is no traversal
 * surface and no path-lock is needed here.
 */
export function readUserProfile(workflowRoot: string): string {
  return readIfExists(resolveMemoryUserProfilePath(workflowRoot));
}

export function writeUserProfile(workflowRoot: string, text: string): void {
  const filePath = resolveMemoryUserProfilePath(workflowRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = String(text || "").replace(/^﻿/, "").trimEnd();
  fs.writeFileSync(filePath, body ? `${body}\n` : "", "utf8");
}

export function readIndex(workflowRoot: string, projectId: string): string {
  return readIfExists(path.join(projectDir(workflowRoot, projectId), INDEX_FILE));
}

export function readCurrentProgress(workflowRoot: string, projectId: string): string {
  return readIfExists(path.join(projectDir(workflowRoot, projectId), PROGRESS_FILE));
}

export function readCurrentProgressEntry(
  workflowRoot: string,
  projectId: string,
  sessionId: string,
): MemoryProgressEntry | null {
  const normalizedSessionId = singleLine(sessionId);
  if (!normalizedSessionId) return null;
  return parseProgressEntries(readCurrentProgress(workflowRoot, projectId))
    .find((entry) => entry.sessionId === normalizedSessionId) || null;
}

/** Path-locked read of any file relative to the project memory dir (for the agent tool + UI). */
export function readMemoryFile(workflowRoot: string, projectId: string, relPath: string): string {
  const dir = projectDir(workflowRoot, projectId);
  const abs = assertInsideMemoryDir(dir, relPath);
  return readIfExists(abs);
}

export function listTopics(workflowRoot: string, projectId: string): Array<MemoryTopic & { relPath: string }> {
  const topicsDir = path.join(projectDir(workflowRoot, projectId), TOPICS_DIR);
  if (!fs.existsSync(topicsDir)) return [];
  const out: Array<MemoryTopic & { relPath: string }> = [];
  for (const entry of fs.readdirSync(topicsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const slug = entry.name.replace(/\.md$/, "");
    const text = readIfExists(path.join(topicsDir, entry.name));
    const header = parseTopicHeader(text, slug);
    const body = stripFrontmatter(text);
    out.push({
      slug,
      name: header.name,
      description: header.description,
      type: header.type || "convention",
      body,
      relPath: `${TOPICS_DIR}/${entry.name}`,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Snapshot of one project's long-term memory for the Settings page. */
export function listProjectMemory(workflowRoot: string, projectId: string): ProjectMemorySnapshot {
  const dir = projectDir(workflowRoot, projectId);
  const files: MemoryFileInfo[] = [];

  const manual = path.join(dir, WORK_MANUAL_FILE);
  if (fs.existsSync(manual)) files.push(fileInfo(dir, manual, "work-manual", "Work manual", ""));

  const index = path.join(dir, INDEX_FILE);
  if (fs.existsSync(index)) files.push(fileInfo(dir, index, "index", "Long-term index", ""));

  for (const topic of listTopics(workflowRoot, projectId)) {
    const abs = path.join(dir, topic.relPath);
    files.push({ ...fileInfo(dir, abs, "topic", topic.name, topic.description), type: topic.type });
  }

  return { projectId, dir, exists: fs.existsSync(dir), files };
}

export function getProjectMemoryOverview(
  workflowRoot: string,
  projectId: string,
  activityLimit = DEFAULT_ACTIVITY_LIMIT,
): ProjectMemoryOverview {
  const snapshot = listProjectMemory(workflowRoot, projectId);
  const recentActivity = readActivityLog(workflowRoot, projectId, activityLimit)
    .filter((entry) => entry.op !== "progress");
  const today = summarizeToday(recentActivity);
  const stats = summarizeFiles(snapshot.files);
  return {
    ...snapshot,
    stats,
    today,
    recentActivity,
    profile: getUserProfileInfo(workflowRoot),
  };
}

// ── Writes (all path-locked, index always rebuilt + capped) ─────────

export function writeTopic(
  workflowRoot: string,
  projectId: string,
  input: { name: string; description: string; type: MemoryTopicType | string; body: string; slug?: string },
): { slug: string; relPath: string } {
  const dir = projectDir(workflowRoot, projectId);
  const slug = input.slug ? slugifyTopicName(input.slug) : slugifyTopicName(input.name);
  const relPath = `${TOPICS_DIR}/${slug}.md`;
  const abs = assertInsideMemoryDir(dir, relPath);
  const topic: MemoryTopic = {
    slug,
    name: input.name,
    description: input.description,
    type: normalizeTopicType(input.type),
    body: input.body,
  };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeTopic(topic), "utf8");
  rebuildIndexFromTopics(workflowRoot, projectId);
  appendActivityLog(workflowRoot, projectId, { op: "write", target: relPath, detail: topic.name });
  return { slug, relPath };
}

export function writeCurrentProgress(
  workflowRoot: string,
  projectId: string,
  input: {
    sessionId: string;
    status?: string;
    current: string;
    next?: string;
    blockers?: string;
  },
): MemoryProgressEntry {
  const dir = projectDir(workflowRoot, projectId);
  const abs = assertInsideMemoryDir(dir, PROGRESS_FILE);
  const entry: MemoryProgressEntry = {
    sessionId: requireProgressField(input.sessionId, "sessionId"),
    status: normalizeProgressStatus(input.status),
    current: requireProgressField(input.current, "current"),
    next: normalizeProgressField(input.next || ""),
    blockers: normalizeProgressField(input.blockers || ""),
    updatedAt: new Date().toISOString(),
  };
  const existing = parseProgressEntries(readIfExists(abs));
  // Lazy GC: drop entries whose updatedAt is older than PROGRESS_RETENTION_MS, BEFORE
  // merging in the current entry, so we write the file at most once per call.
  const now = Date.now();
  const fresh = existing.filter((e) => {
    if (e.sessionId === entry.sessionId) return false; // replaced by the current entry
    const at = Date.parse(e.updatedAt);
    return Number.isFinite(at) && now - at <= PROGRESS_RETENTION_MS;
  });
  const droppedCount = existing.filter((e) => e.sessionId !== entry.sessionId).length - fresh.length;
  fresh.push(entry);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeProgressEntries(fresh), "utf8");
  appendActivityLog(workflowRoot, projectId, { op: "progress", target: PROGRESS_FILE, detail: entry.sessionId });
  if (droppedCount > 0) {
    appendActivityLog(workflowRoot, projectId, {
      op: "gc",
      target: PROGRESS_FILE,
      detail: `Pruned ${droppedCount} progress entr${droppedCount === 1 ? "y" : "ies"} older than ${PROGRESS_RETENTION_MS / 86_400_000}d`,
    });
  }
  return entry;
}

export function removeTopic(workflowRoot: string, projectId: string, slugInput: string): boolean {
  const dir = projectDir(workflowRoot, projectId);
  const slug = slugifyTopicName(slugInput);
  const relPath = `${TOPICS_DIR}/${slug}.md`;
  const abs = assertInsideMemoryDir(dir, relPath);
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { force: true });
  rebuildIndexFromTopics(workflowRoot, projectId);
  appendActivityLog(workflowRoot, projectId, { op: "remove", target: relPath });
  return true;
}

export function reindexProjectMemory(workflowRoot: string, projectId: string): string {
  const index = rebuildIndexFromTopics(workflowRoot, projectId);
  appendActivityLog(workflowRoot, projectId, { op: "reindex", target: INDEX_FILE, detail: "Rebuilt long-term memory index" });
  return index;
}

/** Rebuild `MEMORY.md` deterministically from the topic files, hard-capped. */
export function rebuildIndexFromTopics(workflowRoot: string, projectId: string): string {
  const dir = projectDir(workflowRoot, projectId);
  const topics = listTopics(workflowRoot, projectId);
  const markdown = buildIndexMarkdown(topics);
  if (topics.length === 0) {
    // Nothing to index; remove a stale index file rather than leaving an empty husk.
    const indexPath = path.join(dir, INDEX_FILE);
    if (fs.existsSync(indexPath)) fs.rmSync(indexPath, { force: true });
    return "";
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INDEX_FILE), markdown, "utf8");
  return markdown;
}

export function buildIndexMarkdown(topics: Array<Pick<MemoryTopic, "slug" | "name" | "description">>): string {
  const header = ["# Memory Index", ""];
  const entries = topics.map(
    (t) => `- [${singleLine(t.name) || t.slug}](${TOPICS_DIR}/${t.slug}.md)${t.description ? ` — ${singleLine(t.description)}` : ""}`,
  );
  const render = (accepted: string[], dropped: number): string => {
    const lines = [...header, ...accepted];
    if (dropped > 0) lines.push(`- … (${dropped} more, truncated)`);
    return `${lines.join("\n")}\n`;
  };
  const accepted: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const candidate = [...accepted, entries[i]];
    const droppedIfLast = entries.length - candidate.length;
    // Check the FINAL rendered output (truncation note + trailing newline included), so the
    // appended note can never push the result past the cap. dropped only shrinks as we accept
    // more, so testing with this entry as the last accepted is conservative.
    const lineCount = header.length + candidate.length + (droppedIfLast > 0 ? 1 : 0);
    const over = lineCount > MEMORY_INDEX_MAX_LINES
      || Buffer.byteLength(render(candidate, droppedIfLast), "utf8") > MEMORY_INDEX_MAX_BYTES;
    if (over) break;
    accepted.push(entries[i]);
  }
  return render(accepted, entries.length - accepted.length);
}

/** Danger zone: wipe one project's long-term memory (manual + index + topics + log). */
export function clearProjectMemory(workflowRoot: string, projectId: string): boolean {
  const dir = projectDir(workflowRoot, projectId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function appendActivityLog(
  workflowRoot: string,
  projectId: string,
  entry: Omit<MemoryActivityEntry, "at" | "projectId">,
): void {
  try {
    const dir = projectDir(workflowRoot, projectId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, ACTIVITY_LOG_FILE);
    const record: MemoryActivityEntry = { at: new Date().toISOString(), projectId, ...entry };
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
    rollActivityLog(filePath);
  } catch {
    // Activity logging is best-effort; never fail a write because the log is unwritable.
  }
}

/**
 * Lazy rolling truncation: when the log exceeds ACTIVITY_LOG_MAX_LINES * 1.2 (hysteresis to
 * avoid rewriting on every append), rewrite it with only the most recent ACTIVITY_LOG_MAX_LINES.
 * Best-effort: any IO error is swallowed so logging never breaks the caller.
 */
function rollActivityLog(filePath: string): void {
  try {
    // Cheap fast-path: skip the read entirely while the file is comfortably small.
    const stat = fs.statSync(filePath);
    if (stat.size < ACTIVITY_LOG_MAX_LINES * 80) return;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length <= Math.floor(ACTIVITY_LOG_MAX_LINES * 1.2)) return;
    const kept = lines.slice(lines.length - ACTIVITY_LOG_MAX_LINES);
    fs.writeFileSync(filePath, `${kept.join("\n")}\n`, "utf8");
  } catch {
    // Rolling is best-effort; swallow errors.
  }
}

export function readActivityLog(
  workflowRoot: string,
  projectId: string,
  limit = DEFAULT_ACTIVITY_LIMIT,
): MemoryActivityEntry[] {
  const dir = projectDir(workflowRoot, projectId);
  const filePath = path.join(dir, ACTIVITY_LOG_FILE);
  if (!fs.existsSync(filePath)) return [];
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || DEFAULT_ACTIVITY_LIMIT)));
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    const out: MemoryActivityEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < safeLimit; i--) {
      const parsed = parseActivityLine(lines[i], projectId);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

// ── Internal ────────────────────────────────────────────────────────

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseActivityLine(line: string, projectId: string): MemoryActivityEntry | null {
  try {
    const raw = JSON.parse(line) as Partial<MemoryActivityEntry>;
    const op = raw.op;
    if (!raw.at || raw.projectId !== projectId) return null;
    if (!["write", "remove", "reindex", "clear", "review", "progress", "gc"].includes(String(op))) return null;
    return {
      at: String(raw.at),
      projectId,
      op: op as MemoryActivityEntry["op"],
      target: typeof raw.target === "string" ? raw.target : undefined,
      detail: typeof raw.detail === "string" ? raw.detail : undefined,
    };
  } catch {
    return null;
  }
}

function getUserProfileInfo(workflowRoot: string): MemoryProfileInfo {
  const filePath = resolveMemoryUserProfilePath(workflowRoot);
  try {
    const stat = fs.statSync(filePath);
    return { exists: stat.isFile(), sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { exists: false, sizeBytes: 0, updatedAt: null };
  }
}

function summarizeFiles(files: MemoryFileInfo[]): ProjectMemoryOverview["stats"] {
  let lastUpdatedAt: string | null = null;
  for (const file of files) {
    if (file.updatedAt && (!lastUpdatedAt || file.updatedAt > lastUpdatedAt)) lastUpdatedAt = file.updatedAt;
  }
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    topicCount: files.filter((file) => file.role === "topic").length,
    manualPresent: files.some((file) => file.role === "work-manual"),
    indexPresent: files.some((file) => file.role === "index"),
    lastUpdatedAt,
  };
}

function summarizeToday(entries: MemoryActivityEntry[]): ProjectMemoryOverview["today"] {
  const today = new Date().toISOString().slice(0, 10);
  const summary = { reviews: 0, writes: 0, removes: 0, reindexes: 0 };
  for (const entry of entries) {
    if (!entry.at.startsWith(today)) continue;
    if (entry.op === "review") summary.reviews++;
    if (entry.op === "write") summary.writes++;
    if (entry.op === "remove") summary.removes++;
    if (entry.op === "reindex") summary.reindexes++;
  }
  return summary;
}

function normalizeProgressStatus(raw: unknown): MemoryProgressEntry["status"] {
  const value = String(raw || "").trim();
  if (["pass", "blocked", "stopped", "failed", "error", "interrupted", "timeout"].includes(value)) {
    return value as MemoryProgressEntry["status"];
  }
  return "unknown";
}

function normalizeProgressField(value: string): string {
  return String(value || "")
    .replace(/^﻿/, "")
    .trim()
    .slice(0, PROGRESS_MAX_FIELD_CHARS);
}

function requireProgressField(value: string, field: string): string {
  const normalized = field === "sessionId"
    ? singleLine(value)
    : normalizeProgressField(value);
  if (!normalized) throw new Error(`progress.write requires "${field}".`);
  return normalized;
}

function progressStart(sessionId: string): string {
  return `<!-- progress:${sessionId} -->`;
}

function progressEnd(sessionId: string): string {
  return `<!-- /progress:${sessionId} -->`;
}

export function parseProgressEntries(text: string): MemoryProgressEntry[] {
  const entries: MemoryProgressEntry[] = [];
  const pattern = /<!-- progress:([^>]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/progress:\1 -->/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const sessionId = singleLine(match[1]);
    if (!sessionId) continue;
    const block = match[2] || "";
    const field = (label: string): string => {
      // Capture from a field marker to the next `- Word:` marker or the END OF THE BLOCK.
      // No `m` flag on purpose: with `m`, `$` matches every line end, so the lazy quantifier
      // stops at the first line and multi-line values (Current/Next/Blockers may span several
      // lines) would be truncated to their first line on every re-parse. Without `m`, `$` means
      // end-of-block, so the value keeps every line until the next field marker.
      const found = block.match(new RegExp(`(?:^|\\r?\\n)- ${label}:[ \\t]*([\\s\\S]*?)(?=\\r?\\n- [A-Za-z]+:|$)`));
      return normalizeProgressField(found?.[1] || "");
    };
    const current = field("Current");
    if (!current) continue;
    entries.push({
      sessionId,
      status: normalizeProgressStatus(field("Status")),
      current,
      next: field("Next"),
      blockers: field("Blockers"),
      updatedAt: field("Updated") || new Date(0).toISOString(),
    });
  }
  return entries;
}

function serializeProgressEntries(entries: MemoryProgressEntry[]): string {
  const lines = ["# Current Progress", ""];
  for (const entry of entries) {
    lines.push(progressStart(entry.sessionId));
    lines.push(`## ${entry.sessionId}`);
    lines.push(`- Status: ${entry.status}`);
    lines.push(`- Updated: ${entry.updatedAt}`);
    lines.push(`- Current: ${entry.current}`);
    lines.push(`- Next: ${entry.next}`);
    lines.push(`- Blockers: ${entry.blockers}`);
    lines.push(progressEnd(entry.sessionId));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function stripFrontmatter(text: string): string {
  const trimmed = text.replace(/^﻿/, "");
  const fm = trimmed.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (fm ? trimmed.slice(fm[0].length) : trimmed).trim();
}

function fileInfo(
  dir: string,
  abs: string,
  role: MemoryFileInfo["role"],
  name: string,
  description: string,
): MemoryFileInfo {
  let sizeBytes = 0;
  let updatedAt: string | null = null;
  try {
    const stat = fs.statSync(abs);
    sizeBytes = stat.size;
    updatedAt = stat.mtime.toISOString();
  } catch {
    // missing/unreadable — leave defaults
  }
  return {
    relPath: path.relative(dir, abs).replace(/\\/g, "/"),
    name,
    description,
    role,
    sizeBytes,
    updatedAt,
  };
}
