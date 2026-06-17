import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CONTROLLED_EDITING_MATRIX,
  DESKTOP_EVENT_EDITOR_ACTOR,
  patchControlledEditingOperation,
  patchRequiresAgentGuard,
  requiresControlledEditing,
  requiresControlledEditingForPatch,
  requiresStorySync,
  resolveEditingActor,
  type EditingActor,
  type EditingOperation,
} from './controlled-editing-policy.ts';

const ACTORS: EditingActor[] = ['desktopEditor', 'agent'];

const OPERATIONS: EditingOperation[] = [
  'placement',
  'create',
  'duplicate',
  'update',
  'remove',
  'patchDryRun',
  'patchApply',
  'patchApplyEventCommandOps',
];

/** Documented behavior matrix — keep in sync with CONTROLLED_EDITING_MATRIX. */
const ROLLBACK_ONLY = { controlled: false, storySync: false } as const;

const EXPECTED_MATRIX: Record<EditingActor, Record<EditingOperation, { controlled: boolean; storySync: boolean }>> = {
  desktopEditor: {
    placement: ROLLBACK_ONLY,
    create: ROLLBACK_ONLY,
    duplicate: ROLLBACK_ONLY,
    update: ROLLBACK_ONLY,
    remove: ROLLBACK_ONLY,
    patchDryRun: ROLLBACK_ONLY,
    patchApply: ROLLBACK_ONLY,
    patchApplyEventCommandOps: ROLLBACK_ONLY,
  },
  agent: {
    placement: ROLLBACK_ONLY,
    create: ROLLBACK_ONLY,
    duplicate: ROLLBACK_ONLY,
    update: ROLLBACK_ONLY,
    remove: ROLLBACK_ONLY,
    patchDryRun: ROLLBACK_ONLY,
    patchApply: ROLLBACK_ONLY,
    patchApplyEventCommandOps: ROLLBACK_ONLY,
  },
};

describe('controlled-editing-policy matrix', () => {
  for (const actor of ACTORS) {
    for (const operation of OPERATIONS) {
      const expected = EXPECTED_MATRIX[actor][operation];
      test(`${actor} + ${operation}: controlled=${expected.controlled}, storySync=${expected.storySync}`, () => {
        assert.deepEqual(CONTROLLED_EDITING_MATRIX[actor][operation], expected);
        assert.equal(requiresControlledEditing(actor, operation), expected.controlled);
        assert.equal(requiresStorySync(actor, operation), expected.storySync);
      });
    }
  }

  test('resolveEditingActor maps desktop IPC actor', () => {
    assert.equal(resolveEditingActor(DESKTOP_EVENT_EDITOR_ACTOR), 'desktopEditor');
    assert.equal(resolveEditingActor({ actorType: 'agent', actorId: 'rmmv-mcp' }), 'agent');
    assert.equal(resolveEditingActor({ actorType: 'external' }), 'agent');
  });
});

describe('controlled-editing-policy patch routing', () => {
  test('patchRequiresAgentGuard is false for dry-run', () => {
    assert.equal(patchRequiresAgentGuard({ action: 'dry-run', dryRun: true }), false);
  });

  test('patchRequiresAgentGuard is false for default apply', () => {
    assert.equal(patchRequiresAgentGuard({ action: 'apply' }), false);
  });

  test('patchRequiresAgentGuard is false when allowMapStructural', () => {
    assert.equal(patchRequiresAgentGuard({ action: 'apply', allowMapStructural: true }), false);
  });

  test('patchRequiresAgentGuard is false for apply-event-command-ops flag', () => {
    assert.equal(patchRequiresAgentGuard({ action: 'apply', applyEventCommandOps: true }), false);
  });

  test('requiresControlledEditingForPatch matches apply modes', () => {
    assert.equal(requiresControlledEditingForPatch({ action: 'dry-run', dryRun: true }), false);
    assert.equal(requiresControlledEditingForPatch({ action: 'apply' }), false);
    assert.equal(requiresControlledEditingForPatch({ action: 'apply', allowMapStructural: true }), false);
    assert.equal(requiresControlledEditingForPatch({ applyEventCommandOps: true }), false);
  });

  test('patchControlledEditingOperation resolves patch operation kind', () => {
    assert.equal(patchControlledEditingOperation({ dryRun: true }), 'patchDryRun');
    assert.equal(patchControlledEditingOperation({ action: 'apply' }), 'patchApply');
    assert.equal(patchControlledEditingOperation({ applyEventCommandOps: true }), 'patchApplyEventCommandOps');
  });
});
