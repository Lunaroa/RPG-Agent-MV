import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

const filename = new URL('./DatabaseEntryDetailEditor.vue', import.meta.url);
const source = readFileSync(filename, 'utf8');

describe('database entry detail usability', () => {
  test('compiles the specialized database editor', () => {
    const parsed = parse(source, { filename: filename.pathname });
    assert.deepEqual(parsed.errors, []);
    const id = 'database-entry-detail-usability';
    compileScript(parsed.descriptor, { id });
    if (parsed.descriptor.template) {
      const result = compileTemplate({
        id,
        filename: filename.pathname,
        source: parsed.descriptor.template.content,
      });
      assert.deepEqual(result.errors, []);
    }
    for (const style of parsed.descriptor.styles) {
      const result = compileStyle({
        id,
        filename: filename.pathname,
        source: style.content,
        scoped: style.scoped,
      });
      assert.deepEqual(result.errors, []);
    }
  });

  test('keeps larger actor previews and removes the reference section', () => {
    assert.match(source, /ref="facePreviewCanvas" width="96" height="96"/);
    assert.match(source, /ref="characterPreviewCanvas" width="96" height="96"/);
    assert.match(source, /ref="battlerPreviewCanvas" width="128" height="96"/);
    assert.doesNotMatch(source, /reference-list|reference-row|db\.references|db\.referenceCount/);
  });

  test('uses the selected battle asset bucket and constrains the enemy layout', () => {
    assert.match(source, /findEnemyBattlerAsset\(imageAssets\(enemyImageAsset\.value\), battlerName\)/);
    assert.match(source, /enemyBattlerPreviewError/);
    assert.match(source, /rm-columns-enemy/);
    // Stock RM enemy tab: image + rewards pinned left via the canvas column,
    // params/traits/drops center, actions + note right.
    assert.match(source, /column\.key === 'canvas'/);
    assert.doesNotMatch(source, /enemy-basic-row|enemy-param-editor/);
  });
});
