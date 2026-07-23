import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

const leftDockSource = readFileSync(new URL('../layout/LeftDock.vue', import.meta.url), 'utf8');
const pickerSource = readFileSync(new URL('./EventImagePickerDialog.vue', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('./CharacterAssetBrowser.vue', import.meta.url), 'utf8');

describe('map tree search and character asset browser', () => {
  test('keeps map selection available while filtered tree dragging and persistence are disabled', () => {
    assert.match(leftDockSource, /v-model="mapTreeSearchQuery"/);
    assert.match(leftDockSource, /:data="visibleMapTree"/);
    assert.match(leftDockSource, /:draggable="mapTreeDraggable && !mapTreeSearchActive"/);
    assert.match(leftDockSource, /if \(!mapTreeSearchActive\.value\) emit\('node-expand', data\)/);
    assert.match(leftDockSource, /if \(!mapTreeSearchActive\.value\) emit\('node-collapse', data\)/);
    assert.match(leftDockSource, /@node-click="handleTreeNodeClick"/);
  });

  test('uses one shared browser for list and lazy gallery selection without replacing precise canvas picking', () => {
    assert.match(pickerSource, /<CharacterAssetBrowser/);
    assert.match(pickerSource, /@update:view-mode="setCharacterViewMode"/);
    assert.match(pickerSource, /ref="characterCanvas"[\s\S]+width="560"[\s\S]+height="430"/);
    assert.match(browserSource, /:aria-pressed="viewMode === 'list'"/);
    assert.match(browserSource, /:aria-pressed="viewMode === 'gallery'"/);
    assert.match(browserSource, /loading="lazy"/);
    assert.match(browserSource, /decoding="async"/);
    assert.match(browserSource, /@error="markImageFailed\(asset\.url\)"/);
  });

  test('keeps one fixed picker surface while the dialog width follows list, gallery, or tile content', () => {
    assert.match(pickerSource, /--picker-height:\s*460px/);
    assert.match(pickerSource, /--picker-right-width:\s*600px/);
    assert.match(pickerSource, /\.character-list-dialog\s*\{\s*--dialog-width:\s*820px;\s*--browser-width:\s*220px;/);
    assert.match(pickerSource, /\.character-gallery-dialog\s*\{\s*--dialog-width:\s*1320px;\s*--browser-width:\s*720px;/);
    assert.match(pickerSource, /class="tile-canvas-scroll"/);
  });

  test('shows five gallery columns on wide windows and one truncated label per card', () => {
    assert.match(browserSource, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
    assert.match(browserSource, /repeat\(4,minmax\(0,1fr\)\)/);
    assert.match(browserSource, /repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(browserSource, /repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(browserSource, /:title="asset\.fileName"/);
    assert.match(browserSource, /<span class="character-copy"><strong>\{\{ asset\.name \}\}<\/strong><\/span>/);
    assert.doesNotMatch(browserSource, /<small>\{\{ asset\.fileName \}\}<\/small>/);
    assert.match(browserSource, /\.character-copy strong\{[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
  });

  test('only confirms double clicks after the current canvas hit is valid', () => {
    assert.match(pickerSource, /@dblclick\.prevent="void confirmCharacterCell\(\$event\)"/);
    assert.match(pickerSource, /@dblclick\.prevent="confirmTileCell"/);
    assert.match(pickerSource, /async function pickCharacterCell\(event: MouseEvent\): Promise<boolean>/);
    assert.match(pickerSource, /function pickTileCell\(event: MouseEvent\): boolean/);
    assert.match(pickerSource, /if \(await pickCharacterCell\(event\)\) commit\(\)/);
    assert.match(pickerSource, /if \(pickTileCell\(event\)\) commit\(\)/);
    assert.match(pickerSource, /eventImgPicker\.pickHint/);
  });

  test('all changed Vue surfaces compile', () => {
    assertSfcCompiles('LeftDock.vue', leftDockSource);
    assertSfcCompiles('EventImagePickerDialog.vue', pickerSource);
    assertSfcCompiles('CharacterAssetBrowser.vue', browserSource);
  });
});

function assertSfcCompiles(filename: string, source: string): void {
  const parsed = parse(source, { filename });
  assert.deepEqual(parsed.errors, []);
  compileScript(parsed.descriptor, { id: filename });
  assert.ok(parsed.descriptor.template);
  const template = compileTemplate({
    id: filename,
    filename,
    source: parsed.descriptor.template.content,
  });
  assert.deepEqual(template.errors, []);
  for (const [index, style] of parsed.descriptor.styles.entries()) {
    const compiledStyle = compileStyle({
      id: `${filename}-${index}`,
      filename,
      source: style.content,
      scoped: style.scoped,
    });
    assert.deepEqual(compiledStyle.errors, []);
  }
}
