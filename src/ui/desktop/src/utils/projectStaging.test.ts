import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProjectStagingSummary } from './projectStaging.ts';

describe('project staging summary', () => {
  it('keeps only valid Agent operation summaries and their string file paths', () => {
    const summary = parseProjectStagingSummary({
      staged: true,
      operations: [
        { operationId: 'db:one', files: ['www/data/Actors.json', 7] },
        { operationId: '', files: [] },
        { operationId: 'db:missing-files' },
      ],
    });

    assert.deepEqual(summary, {
      staged: true,
      operations: [{ operationId: 'db:one', files: ['www/data/Actors.json'] }],
    });
    assert.deepEqual(summary.operations.map((operation) => operation.operationId), ['db:one']);
  });

  it('returns an empty safe summary for malformed input', () => {
    assert.deepEqual(parseProjectStagingSummary(null), { staged: false, operations: [] });
    assert.deepEqual(parseProjectStagingSummary({ operations: 'invalid' }), { staged: false, operations: [] });
  });
});
