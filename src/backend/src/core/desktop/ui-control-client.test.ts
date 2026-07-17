import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { validateBackgroundUiControlServerInfo } from './ui-control-client.ts';

describe('background UI control client metadata', () => {
  const valid = {
    commandUrl: 'http://127.0.0.1:54321/command',
    token: 'test-token',
    pid: 1234,
    windowMode: 'background',
  };

  test('accepts a live loopback background bridge', () => {
    assert.deepEqual(validateBackgroundUiControlServerInfo(valid, () => true), valid);
  });

  test('rejects foreground, legacy, remote, and dead bridge metadata', () => {
    assert.throws(() => validateBackgroundUiControlServerInfo({ ...valid, windowMode: 'foreground' }, () => true), /non-background/);
    assert.throws(() => validateBackgroundUiControlServerInfo({ commandUrl: valid.commandUrl, token: valid.token, pid: valid.pid }, () => true), /non-background/);
    assert.throws(() => validateBackgroundUiControlServerInfo({ ...valid, commandUrl: 'https://example.invalid/command' }, () => true), /loopback HTTP/);
    assert.throws(() => validateBackgroundUiControlServerInfo(valid, () => false), /no longer running/);
  });
});
