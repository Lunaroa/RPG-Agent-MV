import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PRODUCT_LOCALE_CODES } from '../i18n/messages.ts';
import { COMMAND_DEFINITIONS } from './eventCommandCatalogLocalization.ts';
import { eventEditorText } from './eventEditorLocalization.ts';
import { localizeCommandDefinition, localizeCommandCodeLabel } from './eventCommandLocalization.ts';

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

describe('event command localization', () => {
  test('keeps English command labels, groups, fields, and options free of Chinese', () => {
    const misses: string[] = [];

    for (const definition of COMMAND_DEFINITIONS) {
      const localized = localizeCommandDefinition(definition, 'en-US');
      collectText(misses, `command ${definition.code} label`, localized.label);
      collectText(misses, `command ${definition.code} group`, localized.group);

      for (const field of localized.fields) {
        collectText(misses, `command ${definition.code} field`, field.label);
        for (const [, optionLabel] of field.options || []) {
          collectText(misses, `command ${definition.code} option`, optionLabel);
        }
      }
    }

    assert.deepEqual(misses, []);
  });

  test('keeps editor enum tables complete for every product language', () => {
    for (const language of PRODUCT_LOCALE_CODES) {
      const text = eventEditorText(language);
      assert.ok(text.triggers.length > 0);
      assert.ok(text.priorities.length > 0);
      assert.ok(text.moveRouteOperations.length > 0);
      assert.ok(localizeCommandCodeLabel(101, language, '显示文字'));
    }
  });

  test('keeps English editor enum tables free of Chinese', () => {
    const text = eventEditorText('en-US');
    const misses: string[] = [];

    for (const [, label] of text.triggers) collectText(misses, 'trigger', label);
    for (const [, label] of text.priorities) collectText(misses, 'priority', label);
    for (const [, label] of text.moveTypes) collectText(misses, 'move type', label);
    for (const [, label] of text.moveSpeeds) collectText(misses, 'move speed', label);
    for (const [, label] of text.moveFrequencies) collectText(misses, 'move frequency', label);
    for (const [, label] of text.blendModes) collectText(misses, 'blend mode', label);
    for (const [, label] of text.moveRouteOperations) collectText(misses, 'move route operation', label);
    for (const label of Object.values(text.balloonIconLabels)) collectText(misses, 'balloon icon', label);
    for (const label of text.messageBackgroundLabels) collectText(misses, 'message background', label);
    for (const label of text.messagePositionLabels) collectText(misses, 'message position', label);

    assert.deepEqual(misses, []);
  });
});

function collectText(misses: string[], label: string, text: string): void {
  if (CHINESE_RE.test(text)) misses.push(`${label}: ${text}`);
}
