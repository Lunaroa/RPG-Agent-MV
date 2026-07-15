/**
 * Run: node --test src/utils/placementErrors.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatPlacementError,
  toPlacementError,
} from './placementErrors.ts';

describe('placementErrors', () => {
  test('formats missing implementation guidance', () => {
    const message = formatPlacementError(new Error('缺少完整实现'), {
      contractId: 'inn.greeting',
      eventName: '酒馆招呼',
    }, 'zh-CN');
    assert.match(message, /无法放置「酒馆招呼」/);
    assert.match(message, /registry\.register/);
  });

  test('wraps other placement failures without version-management prompt', () => {
    const wrapped = toPlacementError(new Error('MAP 1 中不存在事件 99'), {
      contractId: 'missing.event',
      eventName: '丢失事件',
    });
    assert.ok(wrapped instanceof Error);
    assert.match(wrapped.message, /MAP 1 中不存在事件 99/);
  });

  test('formats placement failures in English mode', () => {
    const missing = formatPlacementError(new Error('缺少完整实现'), {
      contractId: 'inn.greeting',
      eventName: 'Inn greeting',
    }, 'en-US');
    const wrapped = toPlacementError(new Error('MAP 1 is missing event 99'), {
      contractId: 'missing.event',
      eventName: 'Missing event',
    }, 'en-US');

    assert.match(missing, /Cannot place "Inn greeting"/);
    assert.match(missing, /registry\.register/);
    assert.equal(wrapped.message, 'Placement failed: MAP 1 is missing event 99');
  });
});
