import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendIpcStructuredError,
  IPC_STRUCTURED_ERROR_PREFIX,
} from '../../../../contract/desktop-errors.ts';
import {
  readStagingConflictDetails,
  stagingConflictReasonLabel,
} from './staging-conflicts.ts';

test('readStagingConflictDetails parses structured ipc error with reasons array', () => {
  const details = {
    conflicts: [
      { relativePath: 'data/CommonEvents.json', reasons: ['SOURCE_HASH_CHANGED'] },
      { relativePath: 'data/Map001.json', reasons: ['SOURCE_EXISTENCE_CHANGED', 'DRAFT_MISSING'] },
    ],
  };
  const error = new Error(appendIpcStructuredError(
    '[STAGING_CONFLICT] Staging preflight found 2 conflicted file(s).',
    'STAGING_CONFLICT',
    details,
  ));
  const parsed = readStagingConflictDetails(error);
  assert.deepEqual(parsed, details);
});

test('readStagingConflictDetails parses preflight conflictReasons shape', () => {
  const error = new Error(appendIpcStructuredError(
    'Staging preflight found 1 conflicted file(s).',
    'STAGING_CONFLICT',
    {
      conflicts: [
        {
          relativePath: 'data/Actors.json',
          conflictReasons: [
            { code: 'SOURCE_HASH_CHANGED', expected: 'a', actual: 'b' },
          ],
        },
      ],
    },
  ));
  const parsed = readStagingConflictDetails(error);
  assert.deepEqual(parsed, {
    conflicts: [
      { relativePath: 'data/Actors.json', reasons: ['SOURCE_HASH_CHANGED'] },
    ],
  });
});

test('readStagingConflictDetails reads direct code/details on error object', () => {
  const error = new Error('Staging preflight found 1 conflicted file(s).') as Error & {
    code: string;
    details: unknown;
  };
  error.code = 'STAGING_CONFLICT';
  error.details = {
    conflicts: [{ relativePath: 'data/System.json', reasons: ['DRAFT_HASH_CHANGED'] }],
  };
  const parsed = readStagingConflictDetails(error);
  assert.deepEqual(parsed, {
    conflicts: [{ relativePath: 'data/System.json', reasons: ['DRAFT_HASH_CHANGED'] }],
  });
});

test('readStagingConflictDetails returns null for non-conflict errors', () => {
  assert.equal(readStagingConflictDetails(new Error('boom')), null);
  assert.equal(
    readStagingConflictDetails(new Error(`boom\n${IPC_STRUCTURED_ERROR_PREFIX}{"code":"STAGING_BUSY","details":{}}`)),
    null,
  );
  assert.equal(
    readStagingConflictDetails(new Error(appendIpcStructuredError('x', 'STAGING_CONFLICT', { conflicts: [] }))),
    null,
  );
  assert.equal(
    readStagingConflictDetails(new Error(appendIpcStructuredError('x', 'STAGING_CONFLICT', { conflicts: [{ relativePath: 'data/A.json', reasons: ['UNKNOWN_CODE'] }] }))),
    null,
  );
});

test('stagingConflictReasonLabel localizes all reason codes', () => {
  const codes = ['SOURCE_EXISTENCE_CHANGED', 'SOURCE_HASH_CHANGED', 'DRAFT_MISSING', 'DRAFT_HASH_CHANGED'] as const;
  for (const code of codes) {
    assert.ok(stagingConflictReasonLabel(code, 'zh-CN').length > 0, code);
    assert.ok(stagingConflictReasonLabel(code, 'en-US').length > 0, code);
    assert.notEqual(stagingConflictReasonLabel(code, 'zh-CN'), stagingConflictReasonLabel(code, 'en-US'), code);
  }
});
