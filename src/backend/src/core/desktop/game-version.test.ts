import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GameVersionFormatError,
  compareGameVersions,
  normalizeGameVersion,
  parseGameVersion,
} from './game-version.ts';

test('normalizes accepted game versions without changing leading zeroes or suffix case', () => {
  assert.equal(normalizeGameVersion('1.2.3'), '1.2.3');
  assert.equal(normalizeGameVersion('01.002.3 -Beta.02'), '01.002.3-Beta.02');
  assert.deepEqual(parseGameVersion('0.0.0-rc1'), {
    major: '0', minor: '0', patch: '0', suffix: 'rc1', normalized: '0.0.0-rc1',
  });
});

test('rejects unsupported game-version syntax', () => {
  for (const value of [
    '', 'v1.2.3', '1.2', '1.2.3+build', '1.2.3- beta', '1.2.3-beta_1',
    '1.2.3-测试', '1.2.3-', '1.2.3-beta.', '1.2.3 beta', ' 1.2.3', '1.2.3 ',
    '1.2.3\t-beta', '1.2.3\n-beta',
  ]) {
    assert.throws(() => normalizeGameVersion(value), GameVersionFormatError, value);
  }
});

test('compares arbitrarily long numeric cores and ignores suffixes', () => {
  assert.equal(compareGameVersions('1.2.3-alpha', '1.2.3'), 0);
  assert.equal(compareGameVersions('01.0002.0003', '1.2.3-rc'), 0);
  assert.equal(compareGameVersions('999999999999999999999.0.0', '1000000000000000000000.0.0'), -1);
  assert.equal(compareGameVersions('2.0.0', '1.999999999999999999999.999'), 1);
});
