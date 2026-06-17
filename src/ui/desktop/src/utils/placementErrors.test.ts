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
    });
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
});
