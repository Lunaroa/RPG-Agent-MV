import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { bootstrapDatabase } from '../src/core/db/bootstrap.ts';
import { closeDatabase } from '../src/core/db/pool.ts';
import { resolveThinkingVariantsForModel } from '../src/core/llm/model-reasoning-registry.ts';
import * as providerRegistry from '../src/core/llm/provider-registry.ts';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('model-reasoning audit (SQLite providers)', () => {
  before(async () => {
    await bootstrapDatabase(WORKSPACE_ROOT, { importLegacyJson: false });
  });

  after(() => {
    closeDatabase();
  });

  test('every configured model resolves to a variant list', async () => {
    const providers = await providerRegistry.listProviders(WORKSPACE_ROOT);
    const missing = [];

    for (const provider of providers) {
      const providerId = provider.id;
      if (!provider.models?.length) continue;
      for (const model of provider.models) {
        const variants = resolveThinkingVariantsForModel(providerId, model.id);
        if (!variants || !variants.length) {
          missing.push(`${providerId}/${model.id}`);
        }
      }
    }

    assert.equal(
      missing.length,
      0,
      `models without registry profile (add rules): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`,
    );
  });

  test('deepseek deepseek-v4-pro is multi-tier', () => {
    const variants = resolveThinkingVariantsForModel('deepseek', 'deepseek-v4-pro');
    assert.ok(variants && variants.length > 1);
  });

  test('minimax MiniMax-M3 has thinking modes', () => {
    const variants = resolveThinkingVariantsForModel('minimax', 'MiniMax-M3');
    assert.ok(variants && variants.length > 1);
  });
});
