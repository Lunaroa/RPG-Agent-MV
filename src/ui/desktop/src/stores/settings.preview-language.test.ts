import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

describe('settings dispatch preview source guard', () => {
  test('passes current product language to session preview', () => {
    assert.match(
      source,
      /sessions\.preview\(\{[\s\S]*?productLanguage: normalizeProductLanguage\(ui\.value\.language\),[\s\S]*?\}\)/,
    );
    assert.match(
      source,
      /intent: translate\('settings\.intent\.previewDispatch', normalizeProductLanguage\(ui\.value\.language\)\),/,
    );
  });
});
