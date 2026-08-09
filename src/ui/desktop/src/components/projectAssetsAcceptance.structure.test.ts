import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

const componentDir = dirname(fileURLToPath(import.meta.url));
const desktopSrc = join(componentDir, '..');

function read(relativePath: string): string {
  return readFileSync(join(desktopSrc, relativePath), 'utf8');
}

function compileVue(relativePath: string): string {
  const filename = join(desktopSrc, relativePath);
  const source = read(relativePath);
  const parsed = parse(source, { filename });
  assert.deepEqual(parsed.errors, []);
  const id = `project-assets-acceptance-${relativePath}`;
  if (parsed.descriptor.script || parsed.descriptor.scriptSetup) {
    compileScript(parsed.descriptor, { id });
  }
  if (parsed.descriptor.template) {
    const result = compileTemplate({
      id,
      filename,
      source: parsed.descriptor.template.content,
    });
    assert.deepEqual(result.errors, []);
  }
  for (const style of parsed.descriptor.styles) {
    const result = compileStyle({
      id,
      filename,
      source: style.content,
      scoped: style.scoped,
    });
    assert.deepEqual(result.errors, []);
  }
  return source;
}

describe('project assets acceptance structure', () => {
  test('compiles the asset view and shared audio components', () => {
    compileVue('views/ProjectAssetsView.vue');
    compileVue('components/ProjectAssetsWorkspace.vue');
    compileVue('components/AssetEffectInfoPreview.vue');
    compileVue('components/AudioWaveformSeek.vue');
    compileVue('components/ProjectAssetsAudioBar.vue');
    compileVue('components/editor/PluginFileAudioPreview.vue');
  });

  test('uses base entry categories for nested-file mutations', () => {
    const source = read('components/ProjectAssetsWorkspace.vue');
    assert.match(source, /category:\s*entryCategoryId\(entry\)/);
    assert.doesNotMatch(source, /category:\s*isFavoritesSelection\.value\s*\?/);
  });

  test('keeps audio on the bottom player and removes asset-page staging controls', () => {
    const source = read('components/ProjectAssetsWorkspace.vue');
    assert.match(source, /singleSelectedFile && !isAudioEntry\(singleSelectedFile\)/);
    assert.match(source, /playAudioEntries\(\[item\.entry\]\)/);
    assert.doesNotMatch(source, /data-ui-id="project-assets-staging-bar"/);
    assert.doesNotMatch(source, /applyProjectStaging/);
    assert.doesNotMatch(source, /discardProjectStaging/);
  });

  test('shows open, favorite marker, notes, pressed preview state, and clamped context menus', () => {
    const source = read('components/ProjectAssetsWorkspace.vue');
    assert.match(source, /project-assets-ctx-open/);
    assert.match(source, /projectAssets\.openFile/);
    assert.match(source, /project-assets-tree-favorite/);
    assert.match(source, /project-assets-preview-panel-note/);
    assert.match(source, /:aria-pressed="previewPanelVisible"/);
    assert.match(source, /window\.innerWidth - rect\.width - margin/);
    assert.match(source, /window\.innerHeight - rect\.height - margin/);
  });

  test('plays unencrypted effect assets through the in-panel particle preview frame', () => {
    const source = read('components/ProjectAssetsWorkspace.vue');
    const effectPreview = read('components/AssetEffectInfoPreview.vue');
    assert.match(source, /buildProjectAssetEffectPreview\(entry\.name\)/);
    assert.match(source, /projectAssets\.previewEffect/);
    assert.doesNotMatch(source, /mode:\s*'particle_preview'/);
    assert.match(effectPreview, /<ParticleAnimationPreviewFrame/);
    assert.match(effectPreview, /:disabled="actionBusy"/);
    assert.match(effectPreview, /:aria-busy="actionBusy"/);
  });

  test('waveform exposes slider semantics, pointer dragging, and keyboard seeking', () => {
    const source = read('components/AudioWaveformSeek.vue');
    assert.match(source, /role="slider"/);
    assert.match(source, /@pointermove="onPointerMove"/);
    assert.match(source, /ArrowLeft/);
    assert.match(source, /ArrowRight/);
    assert.match(source, /Home/);
    assert.match(source, /End/);
  });
});

describe('database switch and variable acceptance structure', () => {
  test('compiles the database view and dedicated name editor', () => {
    compileVue('views/DatabaseView.vue');
    compileVue('components/console/DatabaseEntryDetailEditor.vue');
    compileVue('components/console/SystemNamedEntryDetailEditor.vue');
    compileVue('components/editor/ImageAssetPickerDialog.vue');
  });

  test('places switches and variables after common events and reuses managed staging APIs', () => {
    const source = read('views/DatabaseView.vue');
    assert.match(source, /'CommonEvents',\s*\n\s*'Switches', 'Variables',\s*\n\s*\.\.\.DATABASE_DOCUMENT_PAGES/);
    assert.match(source, /openManaged\(systemNamedKind\(\), entry\.id\)/);
    assert.match(source, /kind,\s*\n\s*group: kind === 'database' \? group : undefined/);
    assert.match(source, /SystemNamedEntryDetailEditor/);
  });

  test('keeps read-failure notification inside the viewport', () => {
    const source = read('styles/element-overrides.css');
    assert.match(source, /width:\s*min\(520px, calc\(100vw - 32px\)\)/);
    assert.match(source, /max-height:\s*min\(360px, calc\(100vh - 160px\)\)/);
    assert.match(source, /overflow-y:\s*auto/);
  });

  test('keeps the icon picker fixed to IconSet and removes System-owned duplicate lists', () => {
    const picker = read('components/editor/ImageAssetPickerDialog.vue');
    const editor = read('components/console/DatabaseEntryDetailEditor.vue');
    const documentPages = read('utils/databaseDocumentPages.ts');
    assert.match(picker, /v-if="mode !== 'icon'"/);
    assert.match(picker, /picker-grid--single/);
    // The shared filter lives in databaseDocumentPages so every System render
    // path (core fields and leftover panels) applies the same exclusion.
    assert.match(editor, /SYSTEM_FIELDS_EDITED_ELSEWHERE/);
    assert.match(documentPages, /export const SYSTEM_FIELDS_EDITED_ELSEWHERE/);
    assert.match(documentPages, /'switches', 'variables'/);
  });

  test('uses direct Types and Terms layouts without the advanced JSON editor', () => {
    const view = read('views/DatabaseView.vue');
    const editor = read('components/console/DatabaseEntryDetailEditor.vue');
    const dispatcher = read('components/console/DatabaseDocumentEditor.vue');
    const types = read('components/console/DatabaseTypesDocumentEditor.vue');
    const terms = read('components/console/DatabaseTermsDocumentEditor.vue');
    assert.match(editor, /<DatabaseDocumentEditor/);
    assert.match(dispatcher, /page === 'Types'/);
    assert.match(dispatcher, /DatabaseTermsDocumentEditor/);
    assert.match(types, /class="rm-types-grid"/);
    assert.match(terms, /class="rm-message-scroll"/);
    assert.doesNotMatch(editor, /advanced-json/);
    assert.doesNotMatch(view, /selectedDbSubField/);
  });

  test('exposes the project-level unlimited tileset list without changing palette drawing', () => {
    const editor = read('components/console/DatabaseEntryDetailEditor.vue');
    const slots = read('utils/tilesetSlots.ts');
    assert.match(editor, /workspaceStore\.readExtendedTilesets\(projectPath\)/);
    assert.match(editor, /workspaceStore\.setExtendedTilesets\(projectPath, enabled\)/);
    assert.match(editor, /appendTilesetSlot\(field\.path\)/);
    assert.match(editor, /canRemoveTilesetSlot\(field\.path, index\)/);
    assert.match(slots, /return `F\$\{extended - LETTERED_EXTENDED_SLOT_COUNT \+ 1\}`/);
    assert.doesNotMatch(slots, /EXTENDED_TILESET_SLOT_LIMIT/);
  });
});
