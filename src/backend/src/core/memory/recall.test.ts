import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeTopic } from "./memory-store.ts";
import {
  buildRecallManifest,
  loadRecalledBodies,
  parseSelectedSlugs,
  RECALL_MAX,
  selectRelevantTopics,
} from "./recall.ts";

const PROJECT_ID = "DemoGame";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-rpg-recall-"));
}

function seedTopics(root: string, n: number): void {
  for (let i = 0; i < n; i++) {
    writeTopic(root, PROJECT_ID, {
      name: `Topic ${i}`,
      description: `Description for topic ${i}`,
      type: "convention",
      body: `BODY_${i}`,
    });
  }
}

test("buildRecallManifest carries only headers (slug/name/description/type), never bodies", () => {
  const root = makeRoot();
  try {
    seedTopics(root, 3);
    const manifest = buildRecallManifest(root, PROJECT_ID);
    assert.equal(manifest.length, 3);
    for (const entry of manifest) {
      assert.ok(entry.slug && entry.name && entry.type);
      assert.ok(!("body" in entry));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parseSelectedSlugs validates against the manifest, drops unknowns, dedupes, caps", () => {
  const valid = new Set(["a", "b", "c", "d", "e", "f"]);
  // unknown 'zzz' dropped, duplicate 'a' deduped
  assert.deepEqual(parseSelectedSlugs('["a","zzz","b","a"]', valid), ["a", "b"]);
  // wrapped in prose + code fence still extracts the array
  assert.deepEqual(parseSelectedSlugs('Sure!\n```json\n["c","d"]\n```', valid), ["c", "d"]);
  // object form {slug}
  assert.deepEqual(parseSelectedSlugs('[{"slug":"e"}]', valid), ["e"]);
  // capped at RECALL_MAX
  const many = parseSelectedSlugs(JSON.stringify(["a", "b", "c", "d", "e", "f"]), valid);
  assert.equal(many.length, RECALL_MAX);
  // garbage ⇒ []
  assert.deepEqual(parseSelectedSlugs("not json at all", valid), []);
  assert.deepEqual(parseSelectedSlugs("", valid), []);
});

test("selectRelevantTopics: off when no model or empty manifest", async () => {
  const root = makeRoot();
  try {
    seedTopics(root, 2);
    const manifest = buildRecallManifest(root, PROJECT_ID);
    assert.deepEqual(
      await selectRelevantTopics({ workflowRoot: root, manifest, taskIntent: "x", recallModel: null }),
      [],
    );
    assert.deepEqual(
      await selectRelevantTopics({
        workflowRoot: root,
        manifest: [],
        taskIntent: "x",
        recallModel: { providerId: "p", modelId: "m" },
      }),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("selectRelevantTopics: uses injected completion, validates output", async () => {
  const root = makeRoot();
  try {
    seedTopics(root, 4);
    const manifest = buildRecallManifest(root, PROJECT_ID);
    const selected = await selectRelevantTopics({
      workflowRoot: root,
      manifest,
      taskIntent: "work on topic 1 and 3",
      recallModel: { providerId: "p", modelId: "m" },
      complete: async () => '["topic-1","unknown","topic-3"]',
    });
    assert.deepEqual(selected, ["topic-1", "topic-3"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("selectRelevantTopics: model error fails soft to [] (index-only, no fabrication)", async () => {
  const root = makeRoot();
  try {
    seedTopics(root, 2);
    const manifest = buildRecallManifest(root, PROJECT_ID);
    const selected = await selectRelevantTopics({
      workflowRoot: root,
      manifest,
      taskIntent: "x",
      recallModel: { providerId: "p", modelId: "m" },
      complete: async () => {
        throw new Error("boom");
      },
    });
    assert.deepEqual(selected, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("selectRelevantTopics: alreadySurfaced topics are excluded before the side-query", async () => {
  const root = makeRoot();
  try {
    seedTopics(root, 4); // topic-0..topic-3
    const manifest = buildRecallManifest(root, PROJECT_ID);
    let offered: string[] = [];
    const selected = await selectRelevantTopics({
      workflowRoot: root,
      manifest,
      taskIntent: "anything",
      recallModel: { providerId: "p", modelId: "m" },
      alreadySurfaced: ["topic-1", "topic-3"],
      complete: async (prompt) => {
        // Capture which slugs the model was actually offered in the manifest.
        offered = ["topic-0", "topic-1", "topic-2", "topic-3"].filter((s) => prompt.includes(s));
        // Model tries to re-pick an already-surfaced one (topic-1) plus a fresh one (topic-2).
        return '["topic-1","topic-2"]';
      },
    });
    // Surfaced topics are never even shown to the model...
    assert.deepEqual(offered, ["topic-0", "topic-2"]);
    // ...and the echoed-but-surfaced topic-1 is rejected by validation ⇒ only topic-2 survives.
    assert.deepEqual(selected, ["topic-2"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("selectRelevantTopics: when every topic is already surfaced, recall is empty (no query)", async () => {
  const root = makeRoot();
  try {
    seedTopics(root, 2); // topic-0, topic-1
    const manifest = buildRecallManifest(root, PROJECT_ID);
    let called = false;
    const selected = await selectRelevantTopics({
      workflowRoot: root,
      manifest,
      taskIntent: "x",
      recallModel: { providerId: "p", modelId: "m" },
      alreadySurfaced: ["topic-0", "topic-1"],
      complete: async () => {
        called = true;
        return '["topic-0"]';
      },
    });
    assert.deepEqual(selected, []);
    assert.equal(called, false); // empty filtered manifest short-circuits before the model call
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadRecalledBodies returns bodies in selection order, skipping missing", () => {
  const root = makeRoot();
  try {
    seedTopics(root, 3);
    const bodies = loadRecalledBodies(root, PROJECT_ID, ["topic-2", "nope", "topic-0"]);
    assert.deepEqual(bodies.map((b) => b.slug), ["topic-2", "topic-0"]);
    assert.match(bodies[0].body, /BODY_2/);
    assert.match(bodies[1].body, /BODY_0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
