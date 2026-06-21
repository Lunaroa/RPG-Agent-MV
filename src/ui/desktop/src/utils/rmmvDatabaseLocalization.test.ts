import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PRODUCT_LOCALE_CODES } from '../i18n/messages.ts';
import {
  FIELD_LABELS_BY_LOCALE,
  GROUP_LABELS_BY_LOCALE,
  MV_TERMS_MESSAGE_LABELS_BY_LOCALE,
  PARAM_OPTIONS,
  TRAIT_CODES,
  databaseFieldLabel,
  databaseGroupLabel,
  databaseTermMessageLabel,
  localizeDatabaseOptions,
} from './rmmvDatabaseLocalization.ts';

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

describe('rmmv database localization', () => {
  test('keeps key database label tables complete for every product language', () => {
    for (const language of PRODUCT_LOCALE_CODES) {
      assert.ok(GROUP_LABELS_BY_LOCALE[language].Actors);
      assert.ok(FIELD_LABELS_BY_LOCALE[language].name);
      assert.ok(MV_TERMS_MESSAGE_LABELS_BY_LOCALE[language].victory);
    }
  });

  test('keeps English database labels and options free of Chinese', () => {
    const labels = [
      databaseGroupLabel('Actors', 'en-US'),
      databaseFieldLabel('name', 'en-US'),
      databaseTermMessageLabel('victory', 'en-US'),
      ...localizeDatabaseOptions(PARAM_OPTIONS, 'en-US').map((option) => option.label),
      ...localizeDatabaseOptions(TRAIT_CODES, 'en-US').map((option) => option.label),
    ];

    assert.deepEqual(labels.filter((label) => CHINESE_RE.test(label)), []);
  });
});
