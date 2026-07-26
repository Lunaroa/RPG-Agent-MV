import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

const filename = new URL('./DatabaseView.vue', import.meta.url);
const source = readFileSync(filename, 'utf8');

describe('DatabaseView single-document layout', () => {
  test('compiles the database view', () => {
    const parsed = parse(source, { filename: filename.pathname });
    assert.deepEqual(parsed.errors, []);
    const id = 'database-document-layout';
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

  test('uses four virtual document pages while keeping the System storage document shared', () => {
    assert.match(
      source,
      /\.\.\.DATABASE_DOCUMENT_PAGES/,
    );
    assert.match(
      source,
      /const DOCUMENT_DATABASE_GROUPS = new Set<string>\(DATABASE_DOCUMENT_PAGES\)/,
    );
    assert.match(
      source,
      /databaseDocumentStorageGroup\(group\)/,
    );
    assert.match(
      source,
      /isSharedSystemDocumentPage\(previousGroup\)[\s\S]*?isSharedSystemDocumentPage\(key\)[\s\S]*?pmDetail\.value\.entry\.group === 'System'/,
    );
  });

  test('removes counts and the entry-list column only for the four document pages', () => {
    assert.match(source, /'is-document-group': isDocumentDatabaseGroup/);
    assert.match(
      source,
      /<main v-if="!isDocumentDatabaseGroup" class="console-panel pm-entry-list">/,
    );
    assert.match(source, /count: isDatabaseDocumentPage\(key\) \? null/);
    assert.match(source, /<b v-if="opt\.count !== null">\{\{ opt\.count \}\}<\/b>/);
    assert.match(
      source,
      /\.pm-split\.is-document-group\s*\{\s*grid-template-columns:\s*172px minmax\(0, 1fr\)/,
    );
    assert.match(
      source,
      /@media \(max-width: 1320px\)[\s\S]*?\.pm-split\.is-document-group\s*\{\s*grid-template-columns:\s*150px minmax\(0, 1fr\)/,
    );
  });

  test('keeps document details open and lets the active category retry loading', () => {
    assert.match(
      source,
      /v-if="\(pmDetail \|\| detailError\) && !isDocumentDatabaseGroup"/,
    );
    assert.match(
      source,
      /if \(\s*DOCUMENT_DATABASE_GROUPS\.has\(key\)\s*&& !pmDetail\.value\s*&& !detailBusy\.value/,
    );
    assert.match(source, /if \(first\) void openManaged\('database', first\.id, storageGroup\)/);
  });

  test('passes the virtual page to the specialized editor and keeps normal groups three-column', () => {
    assert.match(source, /:document-page="documentDatabasePage \|\| undefined"/);
    assert.match(
      source,
      /\.pm-split\s*\{\s*grid-template-columns:\s*172px 236px minmax\(0, 1fr\)/,
    );
    assert.match(source, /v-if="!isDocumentDatabaseGroup"/);
  });
});
