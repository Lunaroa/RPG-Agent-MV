import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { listEditorMapNotes, setEditorMapNote } from './map-service.ts';

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgagent-map-notes-'));
const sidecarPath = path.join(projectRoot, 'rpgagent-map-notes.json');

after(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('editor map notes sidecar', () => {
  test('returns an empty note map when the sidecar file does not exist', () => {
    assert.deepEqual(listEditorMapNotes(projectRoot), { project: projectRoot, maps: {} });
  });

  test('writes notes into a project-root sidecar keyed by map id', () => {
    const result = setEditorMapNote(projectRoot, 3, 'boss arena pacing draft');
    assert.deepEqual(result.maps, { '3': { note: 'boss arena pacing draft' } });
    const stored = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    assert.deepEqual(stored, { maps: { '3': { note: 'boss arena pacing draft' } } });
    assert.deepEqual(listEditorMapNotes(projectRoot).maps, result.maps);
  });

  test('clearing the last note removes the sidecar file entirely', () => {
    setEditorMapNote(projectRoot, 3, '   ');
    assert.equal(fs.existsSync(sidecarPath), false);
    assert.deepEqual(listEditorMapNotes(projectRoot).maps, {});
  });

  test('rejects invalid map ids instead of writing junk keys', () => {
    assert.throws(() => setEditorMapNote(projectRoot, 0, 'nope'), /valid map id/);
    assert.throws(() => setEditorMapNote(projectRoot, Number.NaN, 'nope'), /valid map id/);
  });

  test('surfaces a corrupt sidecar instead of silently replacing it', () => {
    fs.writeFileSync(sidecarPath, '{ not json', 'utf8');
    assert.throws(() => listEditorMapNotes(projectRoot));
    assert.throws(() => setEditorMapNote(projectRoot, 1, 'x'));
    fs.rmSync(sidecarPath);
  });
});
