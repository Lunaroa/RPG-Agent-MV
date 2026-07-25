import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  ProjectAssetBrowseEntry,
  ProjectAssetMutationSafetyCheck,
  ProjectAssetReference,
} from '@contract/types';
import {
  DELETE_CONFIRM_MAX_REFERENCED_ITEMS,
  DELETE_CONFIRM_MAX_SOURCES_PER_ITEM,
  planProjectAssetDeleteConfirmation,
  type ProjectAssetDeleteConfirmCopy,
} from './projectAssetDeleteFlow';

const copy: ProjectAssetDeleteConfirmCopy = {
  confirmSingle: (name) => `single:${name}`,
  confirmBatchMany: (count, referenced) => `batch:${count}:${referenced}`,
  forceIntro: (referencesText) => `force-intro\n${referencesText}`,
  forceReferenceItem: (name, sources) => `${name} -> ${sources}`,
  forceOverflow: (count) => `+${count} more`,
  forceButton: 'delete anyway',
};

function makeEntry(name: string): ProjectAssetBrowseEntry {
  return {
    id: `pictures:${name}`,
    name,
    variants: [],
    bytes: 1,
    mtimeMs: 1,
    encrypted: false,
    url: '',
    thumbnailUrl: null,
  } as ProjectAssetBrowseEntry;
}

function makeReference(source: string): ProjectAssetReference {
  return { category: 'pictures', name: 'ref', file: 'Map001.json', path: 'events/1', source };
}

function makeCheck(name: string, sources: string[]): ProjectAssetMutationSafetyCheck {
  return {
    ok: true,
    action: 'delete',
    target: { category: 'pictures', name, relativePath: `img/pictures/${name}.png` },
    references: sources.map(makeReference),
    blockers: [],
  };
}

describe('planProjectAssetDeleteConfirmation', () => {
  test('no references keeps the single-step confirm and force=false', () => {
    const plan = planProjectAssetDeleteConfirmation(
      [makeEntry('hero')],
      [makeCheck('hero', [])],
      copy,
    );
    assert.equal(plan.message, 'single:hero');
    assert.equal(plan.force, false);
    assert.equal(plan.confirmButtonText, undefined);
  });

  test('batch without references uses the batch copy with zero referenced count', () => {
    const plan = planProjectAssetDeleteConfirmation(
      [makeEntry('a'), makeEntry('b')],
      [makeCheck('a', []), makeCheck('b', [])],
      copy,
    );
    assert.equal(plan.message, 'batch:2:0');
    assert.equal(plan.force, false);
  });

  test('references switch to the explicit force-delete confirmation', () => {
    const plan = planProjectAssetDeleteConfirmation(
      [makeEntry('hero')],
      [makeCheck('hero', ['Map001 events/1', 'common event 7'])],
      copy,
    );
    assert.equal(plan.force, true);
    assert.equal(plan.confirmButtonText, 'delete anyway');
    assert.ok(plan.message.startsWith('force-intro\n'));
    assert.ok(plan.message.includes('hero -> Map001 events/1, common event 7'));
  });

  test('only referenced items are listed; long source lists and long item lists are capped', () => {
    const manySources = Array.from({ length: DELETE_CONFIRM_MAX_SOURCES_PER_ITEM + 2 }, (_, i) => `src${i}`);
    const plan = planProjectAssetDeleteConfirmation(
      [makeEntry('busy'), makeEntry('clean')],
      [makeCheck('busy', manySources), makeCheck('clean', [])],
      copy,
    );
    assert.equal(plan.force, true);
    assert.ok(plan.message.includes(`busy -> ${manySources.slice(0, DELETE_CONFIRM_MAX_SOURCES_PER_ITEM).join(', ')} +2 more`));
    assert.ok(!plan.message.includes('clean ->'));

    const manyChecks = Array.from({ length: DELETE_CONFIRM_MAX_REFERENCED_ITEMS + 3 }, (_, i) => makeCheck(`item${i}`, ['s']));
    const capped = planProjectAssetDeleteConfirmation(
      manyChecks.map((check) => makeEntry(check.target.name)),
      manyChecks,
      copy,
    );
    assert.ok(capped.message.includes('+3 more'));
  });
});
