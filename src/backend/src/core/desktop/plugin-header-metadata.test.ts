import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseDefaultPluginHeaderMetadata } from './plugin-header-metadata.ts';

describe('plugin header metadata', () => {
  test('keeps default metadata while exposing one help section per language header', () => {
    const metadata = parseDefaultPluginHeaderMetadata(`/*:ja
 * @plugindesc Localized description.
 * @help
 * Japanese help.
 */
/*:
 * @target MV
 * @plugindesc Default description.
 * @help
 * Default help.
 *
 * Second line.
 * @param sample
 * @type string
 */
/*:en
 * @help
 * English help.
 */
/*:zh-CN
 * @help
 * Chinese help.
 */
/*:jp
 * @plugindesc Header without help.
 */
`, 'www/js/plugins/Documentation.js');

    assert.deepEqual(metadata.target, ['MV']);
    assert.equal(metadata.plugindesc, 'Default description.');
    assert.equal(metadata.help, 'Default help.\n\nSecond line.');
    assert.deepEqual(metadata.helpSections, [
      { language: '', content: 'Default help.\n\nSecond line.' },
      { language: 'ja', content: 'Japanese help.' },
      { language: 'en', content: 'English help.' },
      { language: 'zh-CN', content: 'Chinese help.' },
      { language: 'jp', content: '' },
    ]);
  });

  test('deduplicates language markers case-insensitively and ignores malformed headers', () => {
    const metadata = parseDefaultPluginHeaderMetadata(`/*:EN
 * @help
 * First English help.
 */
/*:en
 * @help
 * Duplicate English help.
 */
/*:not a locale
 * @help
 * Invalid marker.
 */
`, 'js/plugins/LocalizedOnly.js');

    assert.equal(metadata.plugindesc, '');
    assert.equal(metadata.help, '');
    assert.deepEqual(metadata.helpSections, [
      { language: 'EN', content: 'First English help.' },
    ]);
  });
});
