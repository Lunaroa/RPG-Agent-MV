import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatUserFacingError, formatUserFacingErrorMessage } from './user-facing-error.ts';

describe('formatUserFacingError', () => {
  test('strips Electron IPC remote method prefix', () => {
    const result = formatUserFacingError(
      new Error("Error invoking remote method 'storyPages:sync': Error: Project directory does not exist: /tmp/missing"),
      'version',
      'en-US',
    );
    assert.equal(result.message, 'Project directory does not exist: /tmp/missing');
  });

  test('passes through localized backend errors without regex remapping', () => {
    assert.equal(
      formatUserFacingErrorMessage(new Error('Invalid map ID'), 'general', 'en-US'),
      'Invalid map ID',
    );
    assert.equal(
      formatUserFacingErrorMessage(new Error('地图 ID 无效'), 'general', 'zh-CN'),
      '地图 ID 无效',
    );
  });

  test('maps controlled editing disabled code', () => {
    assert.equal(
      formatUserFacingErrorMessage(new Error('[CONTROLLED_EDITING_DISABLED] blocked'), 'version', 'en-US'),
      'Enable version management first',
    );
  });

  test('sanitizes developer git terms from user-visible message', () => {
    const result = formatUserFacingError(new Error('Git command failed: fatal: No configured push default.'), 'version', 'en-US');
    assert.equal(result.message, 'Git command failed: fatal: No configured push default.');
    assert.match(result.detail || '', /push/i);
  });

  test('defaults to English when language is omitted', () => {
    assert.equal(
      formatUserFacingErrorMessage(new Error('boom')),
      'boom',
    );
  });
});
