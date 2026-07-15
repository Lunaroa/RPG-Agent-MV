/**
 * Run: node --experimental-strip-types --test src/config/known-issues-i18n.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { translateKnownIssue, translateKnownIssues } from './known-issues-i18n.ts';

describe('translateKnownIssue', () => {
  it('translates known auto-import disclaimer', () => {
    assert.match(
      translateKnownIssue(
        'Auto-imported from a local RPG Maker MV installation; EULA/license has not been reviewed for redistribution.',
        'zh-CN',
      ),
      /本机 RPG Maker MV/,
    );
  });

  it('passes through unknown issues', () => {
    assert.equal(translateKnownIssue('Custom warning'), 'Custom warning');
  });

  it('keeps source English issues in English mode', () => {
    assert.equal(
      translateKnownIssue(
        'Auto-imported from a local RPG Maker MV installation; EULA/license has not been reviewed for redistribution.',
        'en-US',
      ),
      'Auto-imported from a local RPG Maker MV installation; EULA/license has not been reviewed for redistribution.',
    );
  });
});

describe('translateKnownIssues', () => {
  it('maps every issue in order', () => {
    const out = translateKnownIssues([
      'Offline render does not show events, player, plugins, weather, screen tint, animations, or runtime effects.',
      'unknown',
    ], 'zh-CN');
    assert.match(out[0], /离线预览/);
    assert.equal(out[1], 'unknown');
  });

  it('maps every issue in English mode without Chinese translation', () => {
    const out = translateKnownIssues([
      'Offline render does not show events, player, plugins, weather, screen tint, animations, or runtime effects.',
    ], 'en-US');
    assert.match(out[0], /Offline render/);
  });
});
