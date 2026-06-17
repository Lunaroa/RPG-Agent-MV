import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatUserFacingError, formatUserFacingErrorMessage } from './user-facing-error.ts';

describe('formatUserFacingError', () => {
  test('strips Electron IPC remote method prefix', () => {
    const result = formatUserFacingError(
      new Error("Error invoking remote method 'storyPages:sync': Error: 项目目录不存在：/tmp/missing"),
      'version',
    );
    assert.equal(result.message, '项目目录不存在，请重新选择项目');
  });

  test('maps git dependency errors without remote wording', () => {
    const result = formatUserFacingError(new Error('缺少 Git 依赖：未找到 git 命令。请先安装 Git 后重试。'), 'version');
    assert.equal(result.message, '需要安装 Git 才能使用版本管理');
    assert.doesNotMatch(result.message, /remote/i);
  });

  test('sanitizes developer git terms from user-visible message', () => {
    const result = formatUserFacingError(new Error('Git 执行失败：fatal: No configured push default.'), 'version');
    assert.equal(result.message, '保存版本失败，请重试');
    assert.match(result.detail || '', /push/i);
  });

  test('formatUserFacingErrorMessage returns message only', () => {
    assert.equal(
      formatUserFacingErrorMessage(new Error('Git 执行失败：boom'), 'version'),
      '保存版本失败，请重试',
    );
  });
});
