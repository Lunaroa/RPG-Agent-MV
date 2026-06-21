import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getRequestProductLanguage,
  resolveLanguage,
  withProductLanguage,
} from './request-language.ts';

describe('request-language', () => {
  it('reads language inside withProductLanguage scope', () => {
    withProductLanguage('en-US', () => {
      assert.equal(getRequestProductLanguage(), 'en-US');
      assert.equal(resolveLanguage(), 'en-US');
    });
  });

  it('prefers explicit language over request context', () => {
    withProductLanguage('en-US', () => {
      assert.equal(resolveLanguage('zh-CN'), 'zh-CN');
    });
  });

  it('throws outside IPC request scope', () => {
    assert.throws(() => getRequestProductLanguage(), /outside an IPC request scope/);
  });
});
