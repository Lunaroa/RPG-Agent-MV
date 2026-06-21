import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PRODUCT_LOCALE_CODES } from '../i18n/messages.ts';
import {
  consoleAssetsText,
  importedMapIdSuffix,
  translateAssetImportIssue,
} from './consoleAssetsPaneLocalization.ts';

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

describe('console assets pane localization', () => {
  test('keeps preview label tables complete for every product language', () => {
    for (const language of PRODUCT_LOCALE_CODES) {
      const text = consoleAssetsText(language);
      assert.equal(text.svActorPreviewLabels.length, 6);
      assert.equal(text.characterDirectionLabels.length, 4);
      assert.ok(importedMapIdSuffix(12, language).includes('12'));
    }
  });

  test('translates known asset import issues in English mode', () => {
    const issues = [
      translateAssetImportIssue('缺少资源: img/pictures/Quest.png', 'en-US'),
      translateAssetImportIssue('缺少 Skills.json', 'en-US'),
      translateAssetImportIssue('缺少插件: QuestLog', 'en-US'),
      translateAssetImportIssue('无法读取技能类型数据', 'en-US'),
      translateAssetImportIssue('公共事件不兼容:需要 #4「Intro」', 'en-US'),
      translateAssetImportIssue('缺少 audio/se/Chest.ogg', 'en-US'),
    ];

    assert.deepEqual(issues.filter((issue) => CHINESE_RE.test(issue)), []);
  });
});
