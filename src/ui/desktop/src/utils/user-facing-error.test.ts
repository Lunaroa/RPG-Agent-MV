import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendIpcStructuredError } from '../../../../contract/desktop-errors.ts';
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

  test('localizes structured RMMV map preflight details after IPC serialization', () => {
    const details = {
      kind: 'rmmv-map-preflight',
      transactionStarted: false,
      sourceFilesChanged: false,
      missingMaps: [{ mapId: 2, relativePath: 'www/data/Map002.json', reason: 'missing' }],
    };
    const error = new Error(appendIpcStructuredError(
      "Error invoking remote method 'staging:applyProject': [STAGING_RMMV_MAP_PREFLIGHT] backend detail",
      'STAGING_RMMV_MAP_PREFLIGHT',
      details,
    ));

    const en = formatUserFacingError(error, 'general', 'en-US');
    assert.equal(en.code, 'rmmv-map-preflight');
    assert.equal(en.message, 'Apply was blocked because staged changes require readable RMMV map files.');
    assert.match(en.detail || '', /Map 2 \(www\/data\/Map002\.json\): the file is missing/);
    assert.match(en.detail || '', /No transaction was started and source project files were not changed/);
    assert.match(en.detail || '', /Restore or repair.*retry.*discard/i);
    assert.doesNotMatch(`${en.message}\n${en.detail || ''}`, /remote method|STAGING_RMMV_MAP_PREFLIGHT|backend detail/i);

    const zh = formatUserFacingError(error, 'general', 'zh-CN');
    assert.equal(zh.code, 'rmmv-map-preflight');
    assert.equal(zh.message, '由于暂存修改依赖可读取的 RMMV 地图文件，已阻止应用。');
    assert.match(zh.detail || '', /地图 2（www\/data\/Map002\.json）：文件缺失/);
    assert.match(zh.detail || '', /事务未开始，源工程文件未修改/);
    assert.match(zh.detail || '', /恢复或修复.*重试.*丢弃/);
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

  test('maps plan directory permission errors without exposing native details', () => {
    const result = formatUserFacingError(
      new Error("Error invoking remote method 'sessions:create': Error: [SESSION_PLAN_DIRECTORY_NOT_WRITABLE] .opencode/plans/conversations"),
      'general',
      'zh-CN',
    );
    assert.equal(result.code, 'session-plan-directory-not-writable');
    assert.equal(result.message, '无法创建对话计划目录，请检查项目写入权限');
    assert.equal(result.detail, '.opencode/plans/conversations');
    assert.doesNotMatch(result.message, /EPERM|mkdir/i);
  });

  test('distinguishes a plan directory path conflict', () => {
    const result = formatUserFacingError(
      new Error('[SESSION_PLAN_DIRECTORY_PATH_CONFLICT] .opencode'),
      'general',
      'en-US',
    );
    assert.equal(result.code, 'session-plan-directory-path-conflict');
    assert.equal(result.detail, '.opencode');
    assert.equal(result.message, 'A file conflicts with the conversation plan directory');
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
