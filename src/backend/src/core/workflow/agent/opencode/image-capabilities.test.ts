import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import type { ProviderRecord } from '../../../llm/provider-registry.ts';
import { mapOpencodeProviderList } from './catalog.ts';
import { buildOpencodeRuntimeConfig } from './config.ts';

const workflowRoot = path.resolve(import.meta.dirname, '../../../../../../..');

function configuredModel(config: Record<string, unknown>): Record<string, unknown> {
  const provider = (config.provider as Record<string, Record<string, unknown>>).custom;
  return (provider.models as Record<string, Record<string, unknown>>).vision;
}

function provider(inputModalities?: string[]): ProviderRecord {
  return {
    label: 'Custom',
    protocol: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    credentialValue: 'test-key',
    models: [{ id: 'vision', label: 'Vision', ...(inputModalities ? { inputModalities } : {}) }],
  };
}

test('catalog preserves explicit model input capabilities, including known text-only', () => {
  const mapped = mapOpencodeProviderList({
    all: [{
      id: 'custom',
      models: {
        vision: { capabilities: { input: { text: true, image: true } } },
        text: { capabilities: { input: { text: true, image: false } } },
        unknown: {},
      },
    }],
  });
  assert.deepEqual(mapped[0]?.models.find((model) => model.id === 'vision')?.inputModalities, ['text', 'image']);
  assert.deepEqual(mapped[0]?.models.find((model) => model.id === 'text')?.inputModalities, ['text']);
  assert.equal(mapped[0]?.models.find((model) => model.id === 'unknown')?.inputModalities, undefined);
});

test('unknown custom model gets image modality only for an image request', () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot,
    providerId: 'custom',
    modelId: 'vision',
    provider: provider(),
    imageInputRequired: true,
  });
  assert.deepEqual(configuredModel(config).modalities, { input: ['text', 'image'], output: ['text'] });
});

test('known model modalities are preserved instead of guessed from its name', () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot,
    providerId: 'custom',
    modelId: 'vision',
    provider: provider(['text']),
    imageInputRequired: false,
  });
  assert.deepEqual(configuredModel(config).modalities, { input: ['text'], output: ['text'] });
});
