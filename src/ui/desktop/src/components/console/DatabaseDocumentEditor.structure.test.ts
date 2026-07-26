import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

const componentNames = [
  'DatabaseDocumentEditor.vue',
  'DatabaseSystemDocumentEditor.vue',
  'DatabaseTypesDocumentEditor.vue',
  'DatabaseTermsDocumentEditor.vue',
] as const;

function source(name: typeof componentNames[number]): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

function compileComponent(name: typeof componentNames[number]): void {
  const filename = new URL(`./${name}`, import.meta.url);
  const parsed = parse(source(name), { filename: filename.pathname });
  assert.deepEqual(parsed.errors, [], name);
  const id = `database-document-${name}`;
  compileScript(parsed.descriptor, { id });
  if (parsed.descriptor.template) {
    const result = compileTemplate({
      id,
      filename: filename.pathname,
      source: parsed.descriptor.template.content,
    });
    assert.deepEqual(result.errors, [], name);
  }
  for (const style of parsed.descriptor.styles) {
    const result = compileStyle({
      id,
      filename: filename.pathname,
      source: style.content,
      scoped: style.scoped,
    });
    assert.deepEqual(result.errors, [], name);
  }
}

describe('official-style database document editors', () => {
  test('compile independently', () => {
    for (const component of componentNames) compileComponent(component);
  });

  test('dispatches both System pages to the same editor and document value', () => {
    const dispatcher = source('DatabaseDocumentEditor.vue');
    assert.match(dispatcher, /page === 'System1' \|\| page === 'System2'/);
    assert.match(dispatcher, /:model-value="modelValue"/);
    assert.match(dispatcher, /@update:model-value="emit\('update:modelValue', \$event\)"/);
  });

  test('renders System 1 as three columns and System 2 as two columns with dense tables', () => {
    const system = source('DatabaseSystemDocumentEditor.vue');
    assert.match(system, /class="rm-system-one-grid"/);
    assert.match(system, /\.rm-system-one-grid\s*\{[\s\S]*?grid-template-columns:[^;]+[^;]+[^;]+;/);
    assert.match(system, /class="rm-system-two-grid"/);
    assert.match(system, /\.rm-system-two-grid\s*\{[\s\S]*?grid-template-columns:[^;]+[^;]+;/);
    assert.match(system, /class="rm-settings-table"/);
    assert.match(system, /v-if="hasField\('tileSize'\)"/);
    assert.match(system, /v-if="advancedFields\.length"/);
    assert.match(system, /const attackMotionRows = computed/);
    assert.match(system, /attackMotion\(entry\.id\)/);
    assert.match(system, /class="rm-inline-object"/);
    assert.match(system, /systemDocumentPageForField\(field\.path\)/);
  });

  test('renders Types as five selectable listboxes with one editor per column', () => {
    const types = source('DatabaseTypesDocumentEditor.vue');
    assert.match(types, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(types, /role="listbox"/);
    assert.match(types, /role="option"/);
    assert.match(types, /event\.key === 'ArrowUp'/);
    assert.match(types, /event\.key === 'Home'/);
    assert.match(types, /event\.key === 'End'/);
    assert.match(types, /changeMaximum\(field\)/);
    assert.match(types, /namedCount = removed\.filter/);
    assert.match(types, /if \(removed\.length\)/);
  });

  test('renders Terms as left matrices and a separately scrolling message table', () => {
    const terms = source('DatabaseTermsDocumentEditor.vue');
    assert.match(terms, /class="rm-terms-left"/);
    assert.match(terms, /class="rm-term-grid rm-term-grid--commands"/);
    assert.match(terms, /class="rm-message-scroll"/);
    assert.match(terms, /<thead>/);
    assert.match(terms, /position: sticky/);
    assert.match(terms, /\.rm-message-scroll\s*\{[\s\S]*?overflow-y: auto/);
    assert.match(terms, /sortedTermsMessageKeys\(messages\.value\)/);
  });
});
