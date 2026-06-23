import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendActivityLog,
  assertInsideMemoryDir,
  buildIndexMarkdown,
  clearProjectMemory,
  getProjectMemoryOverview,
  listProjectMemory,
  listTopics,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  parseProgressEntries,
  readActivityLog,
  readCurrentProgressEntry,
  readIndex,
  readMemoryFile,
  readUserProfile,
  rebuildIndexFromTopics,
  reindexProjectMemory,
  removeTopic,
  writeCurrentProgress,
  writeTopic,
  writeUserProfile,
  ACTIVITY_LOG_MAX_LINES,
  PROGRESS_RETENTION_MS,
} from "./memory-store.ts";
import { resolveProjectMemoryDir } from "../workspace-paths.ts";
import { resolveActiveProjectId } from "./active-project.ts";
import { buildMemoryPreamble, composeMemoryPreamble } from "./memory-preamble.ts";
import { buildRecallManifest } from "./recall.ts";

const PROJECT_ID = "DemoGame";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpg-memory-"));
}

test("writeTopic round-trips and builds an index", () => {
  const root = makeRoot();
  try {
    const { slug, relPath } = writeTopic(root, PROJECT_ID, {
      name: "Elder voice",
      description: "Speaks slowly, archaic diction",
      type: "character",
      body: "The elder uses formal speech and long pauses.",
    });
    assert.equal(slug, "elder-voice");
    const content = readMemoryFile(root, PROJECT_ID, relPath);
    assert.match(content, /name: Elder voice/);
    assert.match(content, /type: character/);
    assert.match(content, /formal speech/);

    const topics = listTopics(root, PROJECT_ID);
    assert.equal(topics.length, 1);
    assert.equal(topics[0].type, "character");

    const index = readIndex(root, PROJECT_ID);
    assert.match(index, /# Memory Index/);
    assert.match(index, /\[Elder voice\]\(topics\/elder-voice\.md\)/);
    assert.match(index, /Speaks slowly/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("path-lock rejects traversal", () => {
  const root = makeRoot();
  try {
    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    assert.throws(() => assertInsideMemoryDir(dir, "../escape.md"), /escapes the project memory/);
    assert.throws(() => assertInsideMemoryDir(dir, "../../../../etc/passwd"), /escapes the project memory/);
    assert.throws(() => readMemoryFile(root, PROJECT_ID, "../../secrets.txt"), /escapes the project memory/);
    // A normal nested path is allowed.
    assert.doesNotThrow(() => assertInsideMemoryDir(dir, "topics/ok.md"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("index stays under the hard caps with many topics", () => {
  const root = makeRoot();
  try {
    for (let i = 0; i < 400; i++) {
      writeTopic(root, PROJECT_ID, {
        name: `Topic number ${i} with a fairly long descriptive title`,
        description: "A reasonably long one-line description that consumes bytes ".repeat(2),
        type: "convention",
        body: `Body ${i}`,
      });
    }
    const index = readIndex(root, PROJECT_ID);
    const lines = index.split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length <= MEMORY_INDEX_MAX_LINES, `lines=${lines.length}`);
    assert.ok(Buffer.byteLength(index, "utf8") <= MEMORY_INDEX_MAX_BYTES, `bytes=${Buffer.byteLength(index, "utf8")}`);
    assert.match(index, /truncated/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildIndexMarkdown caps and notes the drop count", () => {
  const topics = Array.from({ length: 300 }, (_, i) => ({
    slug: `t-${i}`,
    name: `Name ${i}`,
    description: "d".repeat(120),
  }));
  const md = buildIndexMarkdown(topics);
  assert.ok(md.split("\n").length <= MEMORY_INDEX_MAX_LINES + 2);
  assert.match(md, /more, truncated/);
});

test("removeTopic updates the index and reindex clears an empty index", () => {
  const root = makeRoot();
  try {
    writeTopic(root, PROJECT_ID, { name: "Only one", description: "x", type: "decision", body: "b" });
    assert.equal(removeTopic(root, PROJECT_ID, "only-one"), true);
    assert.equal(listTopics(root, PROJECT_ID).length, 0);
    rebuildIndexFromTopics(root, PROJECT_ID);
    assert.equal(readIndex(root, PROJECT_ID), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listProjectMemory reflects manual + index + topics; clear wipes it", () => {
  const root = makeRoot();
  try {
    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Work manual\nBe consistent.", "utf8");
    writeTopic(root, PROJECT_ID, { name: "A topic", description: "desc", type: "preference", body: "body" });

    const snap = listProjectMemory(root, PROJECT_ID);
    assert.equal(snap.exists, true);
    const roles = snap.files.map((f) => f.role).sort();
    assert.deepEqual(roles, ["index", "topic", "work-manual"]);

    assert.equal(clearProjectMemory(root, PROJECT_ID), true);
    assert.equal(listProjectMemory(root, PROJECT_ID).exists, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("current progress round-trips by session without entering memory index or recall", () => {
  const root = makeRoot();
  try {
    writeTopic(root, PROJECT_ID, { name: "Durable topic", description: "visible", type: "decision", body: "This is durable." });
    const first = writeCurrentProgress(root, PROJECT_ID, {
      sessionId: "runtime-session-1",
      status: "pass",
      current: "Finished the settings panel.",
      next: "Wire the reflection pass.",
      blockers: "",
    });
    assert.equal(first.sessionId, "runtime-session-1");
    assert.equal(readCurrentProgressEntry(root, PROJECT_ID, "runtime-session-1")?.current, "Finished the settings panel.");

    writeCurrentProgress(root, PROJECT_ID, {
      sessionId: "runtime-session-1",
      status: "blocked",
      current: "Reflection prompt needs a stable session id.",
      next: "Use the desktop runtime session id.",
      blockers: "None",
    });
    const progress = readCurrentProgressEntry(root, PROJECT_ID, "runtime-session-1");
    assert.equal(progress?.status, "blocked");
    assert.equal(progress?.current, "Reflection prompt needs a stable session id.");

    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    const entries = parseProgressEntries(fs.readFileSync(path.join(dir, "CURRENT.md"), "utf8"));
    assert.equal(entries.length, 1);
    assert.doesNotMatch(readIndex(root, PROJECT_ID), /Reflection prompt/);
    assert.deepEqual(buildRecallManifest(root, PROJECT_ID).map((entry) => entry.slug), ["durable-topic"]);
    assert.deepEqual(listProjectMemory(root, PROJECT_ID).files.map((file) => file.relPath).sort(), ["MEMORY.md", "topics/durable-topic.md"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("overview summarizes files, profile, activity, and today counts", () => {
  const root = makeRoot();
  try {
    writeUserProfile(root, "Prefers terse production notes.");
    writeTopic(root, PROJECT_ID, { name: "Tone", description: "warm", type: "preference", body: "Keep it warm." });
    writeTopic(root, PROJECT_ID, { name: "Old note", description: "remove me", type: "decision", body: "Temporary." });
    assert.equal(removeTopic(root, PROJECT_ID, "old-note"), true);
    appendActivityLog(root, PROJECT_ID, { op: "review", detail: "Background memory review completed" });
    appendActivityLog(root, PROJECT_ID, { op: "progress", detail: "runtime-session-1" });
    const rebuilt = reindexProjectMemory(root, PROJECT_ID);
    assert.match(rebuilt, /\[Tone\]/);

    const entries = readActivityLog(root, PROJECT_ID, 10);
    assert.deepEqual(entries.slice(0, 6).map((entry) => entry.op), ["reindex", "progress", "review", "remove", "write", "write"]);

    const overview = getProjectMemoryOverview(root, PROJECT_ID);
    assert.equal(overview.profile.exists, true);
    assert.ok(overview.profile.sizeBytes > 0);
    assert.equal(overview.stats.topicCount, 1);
    assert.equal(overview.stats.indexPresent, true);
    assert.equal(overview.stats.manualPresent, false);
    assert.equal(overview.stats.totalFiles, 2);
    assert.ok(overview.stats.totalBytes > 0);
    assert.equal(overview.today.reviews, 1);
    assert.equal(overview.today.writes, 2);
    assert.equal(overview.today.removes, 1);
    assert.equal(overview.today.reindexes, 1);
    assert.equal(overview.recentActivity[0].op, "reindex");
    assert.equal(overview.recentActivity.some((entry) => entry.op === "progress"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearProjectMemory leaves the shared author profile intact", () => {
  const root = makeRoot();
  try {
    writeUserProfile(root, "Shared author profile survives project clears.");
    writeTopic(root, PROJECT_ID, { name: "A topic", description: "desc", type: "preference", body: "body" });
    assert.equal(clearProjectMemory(root, PROJECT_ID), true);
    assert.equal(listProjectMemory(root, PROJECT_ID).exists, false);
    assert.match(readUserProfile(root), /survives project clears/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory preamble: empty project still injects rules + placeholder (CC parity)", () => {
  const root = makeRoot();
  try {
    // No memory yet but a resolvable project ⇒ inject rules + empty placeholder (Claude Code parity).
    const emptyPreamble = buildMemoryPreamble(root, PROJECT_ID);
    assert.match(emptyPreamble, /RmmvMemory/);
    assert.match(emptyPreamble, /MEMORY\.md is currently empty/);
    // No resolvable project scope ⇒ nothing.
    assert.equal(buildMemoryPreamble(root, null), "");

    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "Always keep tone consistent.", "utf8");
    writeTopic(root, PROJECT_ID, {
      name: "Secret body",
      description: "indexed description",
      type: "convention",
      body: "THIS_TOPIC_BODY_SHOULD_NOT_BE_INJECTED",
    });

    const preamble = buildMemoryPreamble(root, PROJECT_ID);
    assert.match(preamble, /Always keep tone consistent/);
    assert.match(preamble, /indexed description/);
    assert.doesNotMatch(preamble, /THIS_TOPIC_BODY_SHOULD_NOT_BE_INJECTED/);
    assert.match(preamble, /RmmvMemory/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("composeMemoryPreamble always carries rules + empty placeholder when blank", () => {
  const out = composeMemoryPreamble({ projectId: "X", memoryDir: "/m", userProfile: "", workManual: "  ", index: "" });
  assert.match(out, /RmmvMemory/);
  assert.match(out, /MEMORY\.md is currently empty/);
  // No work manual / profile / recall sections when those inputs are blank.
  assert.doesNotMatch(out, /## Work manual/);
  assert.doesNotMatch(out, /About the author/);
  assert.doesNotMatch(out, /Recalled memory/);
});

test("composeMemoryPreamble injects USER.md verbatim on top and recalled bodies after the index", () => {
  const out = composeMemoryPreamble({
    projectId: "X",
    memoryDir: "/m",
    userProfile: "AUTHOR_PREFERS_TERSE_DIALOGUE",
    workManual: "",
    index: "# Memory Index\n- [t](topics/t.md)",
    recalledBodies: [{ slug: "t", name: "Topic T", body: "RECALLED_BODY_T" }],
  });
  assert.match(out, /## About the author/);
  assert.match(out, /AUTHOR_PREFERS_TERSE_DIALOGUE/);
  assert.match(out, /## Recalled memory/);
  assert.match(out, /RECALLED_BODY_T/);
  // Profile appears before the index; recalled bodies appear after it.
  assert.ok(out.indexOf("AUTHOR_PREFERS_TERSE_DIALOGUE") < out.indexOf("## MEMORY.md"));
  assert.ok(out.indexOf("## MEMORY.md") < out.indexOf("RECALLED_BODY_T"));
});

test("composeMemoryPreamble incremental: only newly-recalled bodies, no profile/index/rules", () => {
  const parts = {
    projectId: "X",
    memoryDir: "/m",
    userProfile: "AUTHOR_PREFERS_TERSE_DIALOGUE",
    workManual: "Always keep tone consistent.",
    index: "# Memory Index\n- [t](topics/t.md)",
    recalledBodies: [{ slug: "t", name: "Topic T", body: "RECALLED_BODY_T" }],
  };
  const inc = composeMemoryPreamble(parts, "incremental");
  // Carries the recalled body under its own heading...
  assert.match(inc, /RECALLED_BODY_T/);
  assert.match(inc, /Newly relevant memory/);
  // ...but none of the session-start material (profile, rules, work manual, index).
  assert.doesNotMatch(inc, /AUTHOR_PREFERS_TERSE_DIALOGUE/);
  assert.doesNotMatch(inc, /About the author/);
  assert.doesNotMatch(inc, /RmmvMemory/);
  assert.doesNotMatch(inc, /## MEMORY\.md/);
  assert.doesNotMatch(inc, /Always keep tone consistent/);
  // Incremental with nothing recalled ⇒ inject nothing at all.
  assert.equal(composeMemoryPreamble({ ...parts, recalledBodies: [] }, "incremental"), "");
});

test("user profile round-trips and injects verbatim through buildMemoryPreamble", () => {
  const root = makeRoot();
  try {
    assert.equal(readUserProfile(root), "");
    writeUserProfile(root, "The author writes dark fantasy and dislikes exclamation marks.");
    assert.match(readUserProfile(root), /dark fantasy/);
    const preamble = buildMemoryPreamble(root, PROJECT_ID);
    assert.match(preamble, /## About the author/);
    assert.match(preamble, /dark fantasy and dislikes exclamation marks/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveActiveProjectId mirrors event-registry basename and rejects traversal", () => {
  assert.equal(resolveActiveProjectId({ projectPath: "/games/projects/DemoGame" }), "DemoGame");
  assert.equal(resolveActiveProjectId({ projectId: "Explicit" }), "Explicit");
  assert.equal(resolveActiveProjectId({ projectId: "../evil" }), null);
  assert.equal(resolveActiveProjectId({}), null);
});
test("writeCurrentProgress prunes entries older than PROGRESS_RETENTION_MS", () => {
  const root = makeRoot();
  try {
    // Write an entry normally (gets a fresh timestamp, survives pruning).
    writeCurrentProgress(root, PROJECT_ID, { sessionId: "fresh", current: "Alive" });
    assert.equal(readCurrentProgressEntry(root, PROJECT_ID, "fresh")?.current, "Alive");

    // Manually write a stale entry to CURRENT.md.
    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    const abs = path.join(dir, "CURRENT.md");
    const staleEntry = {
      sessionId: "stale",
      status: "pass" as const,
      current: "Dead",
      next: "",
      blockers: "",
      updatedAt: new Date(Date.now() - PROGRESS_RETENTION_MS - 86_400_000).toISOString(), // 1 day past expiry
    };
    // Re-read the file, append the stale entry, write back.
    const text = fs.readFileSync(abs, "utf8");
    const all = [...parseProgressEntries(text), staleEntry];
    fs.writeFileSync(abs, (() => {
      // Reuse the same serialization as the real code
      const lines = ["# Current Progress", ""];
      for (const e of all) {
        lines.push(`<!-- progress:${e.sessionId} -->`);
        lines.push(`## ${e.sessionId}`);
        lines.push(`- Status: ${e.status}`);
        lines.push(`- Updated: ${e.updatedAt}`);
        lines.push(`- Current: ${e.current}`);
        lines.push(`- Next: ${e.next}`);
        lines.push(`- Blockers: ${e.blockers}`);
        lines.push(`<!-- /progress:${e.sessionId} -->`);
        lines.push("");
      }
      return lines.join("\n").trimEnd() + "\n";
    })(), "utf8");

    // Confirm both are present before GC.
    assert.ok(parseProgressEntries(fs.readFileSync(abs, "utf8")).length >= 2);

    // Trigger GC by writing a second fresh entry.
    writeCurrentProgress(root, PROJECT_ID, { sessionId: "trigger", current: "GC pass" });

    // Stale entry should be gone.
    assert.equal(readCurrentProgressEntry(root, PROJECT_ID, "stale"), null);
    // Fresh entry survives.
    assert.equal(readCurrentProgressEntry(root, PROJECT_ID, "fresh")?.current, "Alive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("appendActivityLog rolls when the file exceeds the line cap", () => {
  const root = makeRoot();
  try {
    // Write enough entries to trigger rolling (threshold = ACTIVITY_LOG_MAX_LINES * 1.2).
    const target = Math.ceil(ACTIVITY_LOG_MAX_LINES * 1.2) + 10;
    const firstWritten: string[] = [];
    for (let i = 0; i < target; i++) {
      const detail = `entry-${i}`;
      if (i < ACTIVITY_LOG_MAX_LINES) firstWritten.push(detail);
      appendActivityLog(root, PROJECT_ID, { op: "write" as const, target: "topics/test.md", detail });
    }

    // Read the raw file to verify truncation, bypassing readActivityLog which clamps the limit.
    const logPath = path.join(resolveProjectMemoryDir(root, PROJECT_ID), "activity.log.jsonl");
    const rawLines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
    // Hysteresis: file is allowed to float between MAX and MAX*1.2 before the next trim.
    const upperBound = Math.floor(ACTIVITY_LOG_MAX_LINES * 1.2);
    assert.ok(rawLines.length <= upperBound,
      `raw file has ${rawLines.length} lines, expected <= ${upperBound}`);
    // And it MUST have been truncated at least once (so old entries are actually gone).
    assert.ok(rawLines.length < target,
      `raw file has ${rawLines.length} lines, but we wrote ${target} — rolling never fired`);

    // The very first entries should have been dropped.
    const detailSet = new Set(rawLines.map((l) => {
      try { return JSON.parse(l).detail ?? ""; } catch { return ""; }
    }));
    const slice = firstWritten.slice(0, 10);
    for (const detail of slice) {
      assert.ok(!detailSet.has(detail), `old entry "${detail}" should have been rolled off`);
    }
    // The last entry written should still be present.
    assert.ok(detailSet.has(`entry-${target - 1}`), "the most recent entry should survive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("progress fields keep their multiple lines across a re-parse (no first-line truncation)", () => {
  const root = makeRoot();
  try {
    const multiLineCurrent = "Line one of progress.\nLine two with detail.\nLine three closing.";
    writeCurrentProgress(root, PROJECT_ID, {
      sessionId: "multi",
      status: "pass",
      current: multiLineCurrent,
      next: "Step A.\nStep B.",
      blockers: "",
    });
    // A second write for a DIFFERENT session forces the first entry through the
    // parse → re-serialize round-trip, where first-line truncation used to bite.
    writeCurrentProgress(root, PROJECT_ID, { sessionId: "other", current: "Unrelated." });

    const entry = readCurrentProgressEntry(root, PROJECT_ID, "multi");
    assert.equal(entry?.current, multiLineCurrent, "multi-line current must survive intact");
    assert.equal(entry?.next, "Step A.\nStep B.", "multi-line next must survive intact");

    // Sanity: the direct parser also preserves every line.
    const dir = resolveProjectMemoryDir(root, PROJECT_ID);
    const parsed = parseProgressEntries(fs.readFileSync(path.join(dir, "CURRENT.md"), "utf8"));
    assert.equal(parsed.find((e) => e.sessionId === "multi")?.current, multiLineCurrent);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("activity log gc entries are readable (op allow-list includes gc)", () => {
  const root = makeRoot();
  try {
    appendActivityLog(root, PROJECT_ID, { op: "gc" as const, target: "CURRENT.md", detail: "Pruned 1 progress entry" });
    const entries = readActivityLog(root, PROJECT_ID);
    const gc = entries.find((e) => e.op === "gc");
    assert.ok(gc, "a gc activity entry must survive the read-back filter");
    assert.equal(gc?.detail, "Pruned 1 progress entry");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

