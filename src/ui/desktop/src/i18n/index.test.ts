/**
 * Run: node --experimental-strip-types --test src/i18n/index.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRODUCT_LANGUAGE_OPTIONS,
  listMessageKeys,
  normalizeProductLanguage,
  translate,
} from './messages.ts';

describe('normalizeProductLanguage', () => {
  it('keeps supported English language', () => {
    assert.equal(normalizeProductLanguage('en-US'), 'en-US');
  });

  it('defaults unset preferences to English (boxed default)', () => {
    assert.equal(normalizeProductLanguage(undefined), 'en-US');
    assert.equal(normalizeProductLanguage(null), 'en-US');
    assert.equal(normalizeProductLanguage(''), 'en-US');
  });

  it('falls back unrecognized (dirty) codes to English', () => {
    assert.equal(normalizeProductLanguage('fr-FR'), 'en-US');
  });
});

describe('translate', () => {
  it('returns Chinese and English labels for the same key', () => {
    assert.equal(translate('app.nav.settings', 'zh-CN'), '设置');
    assert.equal(translate('app.nav.settings', 'en-US'), 'Settings');
  });

  it('interpolates message parameters', () => {
    assert.equal(
      translate('topbar.openDocsFailed', 'en-US', { message: 'missing' }),
      'Failed to open documentation: missing',
    );
  });

  it('interpolates release workflow errors instead of exposing placeholders', () => {
    assert.equal(
      translate('gameVersion.error.indexTest', 'zh-CN', { message: '连接被拒绝' }),
      '更新清单测试失败：连接被拒绝',
    );
    assert.equal(
      translate('gamePackaging.error.publish', 'en-US', { message: 'missing metadata' }),
      'The release could not be published: missing metadata',
    );
    assert.equal(
      translate('gameVersion.indexTestAvailable', 'zh-CN', { version: '1.2.3-beta.1' }),
      '服务器当前发布版本：1.2.3-beta.1',
    );
  });
});

describe('PRODUCT_LANGUAGE_OPTIONS', () => {
  it('exposes the fixed product language choices', () => {
    assert.deepEqual(
      PRODUCT_LANGUAGE_OPTIONS.map((option) => option.value),
      ['zh-CN', 'en-US'],
    );
  });
});

describe('translation catalog', () => {
  it('keeps zh-CN and en-US keys in sync', () => {
    const zhKeys = [...listMessageKeys('zh-CN')].sort();
    const enKeys = [...listMessageKeys('en-US')].sort();
    assert.deepEqual(enKeys, zhKeys);
  });

  it('does not fall back to Chinese when an English key exists', () => {
    for (const key of listMessageKeys('en-US')) {
      const en = translate(key, 'en-US');
      const zh = translate(key, 'zh-CN');
      assert.notEqual(en, key, `missing en-US translation for ${key}`);
      if (zh !== en) {
        assert.doesNotMatch(en, /[\u4e00-\u9fff]/, `en-US translation for ${key} still contains Chinese`);
      }
    }
  });
});
