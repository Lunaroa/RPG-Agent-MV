import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProviderRecord } from './provider-registry.ts';
import { modelImageInputCapability } from './provider-registry.ts';

function provider(models: ProviderRecord['models']): ProviderRecord {
  return {
    label: 'Test',
    protocol: 'openai-compatible',
    baseUrl: 'https://example.invalid',
    credentialValue: '',
    models,
  };
}

test('modelImageInputCapability preserves supported, unsupported, and unknown states', () => {
  const value = provider([
    { id: 'vision', label: 'Vision', inputModalities: ['text', 'image'] },
    { id: 'text', label: 'Text', inputModalities: ['text'] },
    { id: 'custom', label: 'Custom' },
  ]);
  assert.equal(modelImageInputCapability(value, 'vision'), true);
  assert.equal(modelImageInputCapability(value, 'text'), false);
  assert.equal(modelImageInputCapability(value, 'custom'), null);
  assert.equal(modelImageInputCapability(value, 'missing'), null);
});
