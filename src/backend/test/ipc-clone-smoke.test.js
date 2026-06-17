import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeProvider } from '../src/core/llm/provider-registry.ts';

function assertStructuredCloneable(label, value) {
  try {
    structuredClone(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

describe('settings IPC payloads are structured-cloneable', () => {
  test('serializeProvider strips non-plain model metadata', () => {
    const serialized = serializeProvider('demo', {
      label: 'Demo',
      protocol: 'openai-compatible',
      baseUrl: 'https://example.com',
      credentialValue: '',
      hiddenModelIds: ['m1'],
      models: [
        {
          id: 'm1',
          label: 'M1',
          metadata: { nested: { ok: true } },
        },
      ],
    });
    assert.deepEqual(serialized.models, [{ id: 'm1', label: 'M1' }]);
    assert.deepEqual(serialized.hiddenModelIds, ['m1']);
    assertStructuredCloneable('serialized provider', serialized);

    const legacy = serializeProvider('legacy', {
      label: 'Legacy',
      protocol: 'openai-compatible',
      baseUrl: 'https://example.com',
      credentialValue: '',
      models: [{ id: 'm1', label: 'M1' }],
    });
    assert.deepEqual(legacy.hiddenModelIds, []);
  });

});
