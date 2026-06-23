/** Durable agent-memory shared types (Phase 1 spine). */

/** Topic memory category, mirrored in topic frontmatter `type`. */
export type MemoryTopicType = "character" | "preference" | "decision" | "convention";

export const MEMORY_TOPIC_TYPES: readonly MemoryTopicType[] = [
  "character",
  "preference",
  "decision",
  "convention",
];

/** One durable topic memory: frontmatter header + markdown body. */
export interface MemoryTopic {
  /** kebab-case slug; also the topic filename stem under `topics/`. */
  slug: string;
  /** Short human title. */
  name: string;
  /** One-line description used to build the recall manifest without reading bodies. */
  description: string;
  type: MemoryTopicType;
  /** Markdown body (everything after the frontmatter). */
  body: string;
}

/** Lightweight metadata for a memory file, for the Settings list + recall manifest. */
export interface MemoryFileInfo {
  /** POSIX-style path relative to the project memory dir (e.g. `topics/foo.md`). */
  relPath: string;
  /** Display name (topic `name`, or the file's role for manual/index). */
  name: string;
  /** One-line description (empty for manual/index). */
  description: string;
  /** Topic category, when applicable. */
  type?: MemoryTopicType;
  /** Logical role of the file. */
  role: "work-manual" | "index" | "topic";
  sizeBytes: number;
  /** Last-modified ISO timestamp, or null if unknown. */
  updatedAt: string | null;
}

/** Snapshot of one project's long-term memory, for the Settings page. */
export interface ProjectMemorySnapshot {
  projectId: string;
  /** Absolute directory, surfaced so the UI can "open folder". */
  dir: string;
  exists: boolean;
  files: MemoryFileInfo[];
}

/** One activity-log entry (append-only JSONL). */
export interface MemoryActivityEntry {
  at: string;
  projectId: string;
  op: "write" | "remove" | "reindex" | "clear" | "review" | "progress" | "gc";
  /** Target relative path (e.g. `topics/foo.md`), when applicable. */
  target?: string;
  detail?: string;
}

/** One per-runtime-session progress note, maintained by the background reflection pass. */
export interface MemoryProgressEntry {
  sessionId: string;
  status: "pass" | "blocked" | "stopped" | "failed" | "error" | "interrupted" | "timeout" | "unknown";
  current: string;
  next: string;
  blockers: string;
  updatedAt: string;
}

export interface MemoryProfileInfo {
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface MemoryOverviewStats {
  totalFiles: number;
  totalBytes: number;
  topicCount: number;
  manualPresent: boolean;
  indexPresent: boolean;
  lastUpdatedAt: string | null;
}

export interface MemoryTodaySummary {
  reviews: number;
  writes: number;
  removes: number;
  reindexes: number;
}

export interface ProjectMemoryOverview extends ProjectMemorySnapshot {
  stats: MemoryOverviewStats;
  today: MemoryTodaySummary;
  recentActivity: MemoryActivityEntry[];
  profile: MemoryProfileInfo;
}
