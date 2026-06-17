import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StoryAnchorDao } from './dao/story-anchor-dao.ts';
import { StoryOutlineDao } from './dao/story-outline-dao.ts';
import { migrate } from './migrate.ts';
import { closeDatabase, configureDatabase, getDatabase, type WorkflowDatabase } from './pool.ts';

function withFreshDatabase(name: string, run: (db: WorkflowDatabase) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  configureDatabase({ path: path.join(root, 'test.db') });
  try {
    migrate();
    run(getDatabase());
  } finally {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function tableExists(db: WorkflowDatabase, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

test('fresh database directly uses the current story schema and query indexes', () => {
  withFreshDatabase('rmmv-story-schema', (db) => {
    migrate();
    assert.equal(
      (db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number }).version,
      10,
    );
    assert.equal(tableExists(db, 'story_tasks'), false);
    assert.equal(tableExists(db, 'story_task_contracts'), false);
    assert.equal(tableExists(db, 'story_outline'), true);
    assert.equal(tableExists(db, 'story_outline_meta'), false);
    assert.equal(tableExists(db, 'story_outline_scenes'), false);

    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    ).all() as Array<{ name: string }>).map((row) => row.name);
    assert.ok(!indexes.includes('idx_event_contracts_contract_id'));
    assert.ok(indexes.includes('idx_story_anchors_baseline_natural'));
    assert.ok(indexes.includes('idx_story_anchors_mod_rid'));

    for (const [sql, args] of [
      ['SELECT * FROM map_selections WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', ['P']],
      ['SELECT * FROM staging_manifests WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1', ['P']],
      ['SELECT * FROM event_contracts WHERE project_id = ? ORDER BY rid', ['P']],
      ['SELECT * FROM event_contracts WHERE status = ? ORDER BY rid', ['draft']],
      ['SELECT * FROM story_event_anchors WHERE project_id = ? ORDER BY map_id, event_id, anchor_id', ['P']],
      ['SELECT * FROM story_pages WHERE project_id = ? AND anchor_id = ? ORDER BY order_hint, page_node_id', ['P', 'a1']],
    ] as Array<[string, string[]]>) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>;
      assert.ok(!plan.some((row) => row.detail.includes('USE TEMP B-TREE')), sql);
    }
  });
});

test('story outline stores markdown', () => {
  withFreshDatabase('rmmv-story-detail', () => {
    StoryOutlineDao.upsert('P', {
      title: 'Manual title',
      body: '# Creative title\n\nA freeform outline.',
    });

    const outline = StoryOutlineDao.get('P')!.outline as Record<string, unknown>;
    assert.equal(outline.title, 'Manual title');
    assert.equal(outline.body, '# Creative title\n\nA freeform outline.');
  });
});

test('baseline and MOD anchor writes enforce separate identities in a fresh database', () => {
  withFreshDatabase('rmmv-story-anchors', (db) => {
    StoryAnchorDao.upsertBaseline({
      projectId: 'P', mapId: 1, eventId: 1, eventName: 'Old', x: 2, y: 3, baselineVersion: '1.0',
    });
    StoryAnchorDao.upsertBaseline({
      projectId: 'P', mapId: 1, eventId: 1, eventName: 'Renamed', x: 2, y: 3, baselineVersion: '1.0',
    });
    StoryAnchorDao.upsertBaseline({
      projectId: 'P', mapId: 1, eventId: 2, eventName: 'Renamed', x: 4, y: 5, baselineVersion: '1.0',
    });
    assert.deepEqual(
      db.prepare(
        'SELECT event_id, event_name FROM story_event_anchors WHERE project_id = ? AND event_rid IS NULL ORDER BY event_id',
      ).all('P'),
      [{ event_id: 1, event_name: 'Renamed' }, { event_id: 2, event_name: 'Renamed' }],
    );

    StoryAnchorDao.upsertMod({
      projectId: 'P', anchorId: 'm1', mapId: 1, eventId: 10, eventRid: 88, eventName: 'A', x: 1, y: 2,
    });
    StoryAnchorDao.upsertMod({
      projectId: 'P', anchorId: 'm2', mapId: 2, eventId: 20, eventRid: 88, eventName: 'B', x: 3, y: 4,
    });
    assert.deepEqual(
      db.prepare(
        'SELECT anchor_id, map_id, event_name FROM story_event_anchors WHERE project_id = ? AND event_rid = ?',
      ).all('P', 88),
      [{ anchor_id: 'm1', map_id: 2, event_name: 'B' }],
    );

    assert.throws(
      () => StoryAnchorDao.upsertBaseline({
        projectId: 'P', mapId: 1, eventName: 'Bad', x: 1, y: 1, baselineVersion: '1.0',
      } as never),
      /eventId/,
    );
  });
});
