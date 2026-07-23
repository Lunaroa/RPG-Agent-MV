import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const paneSource = readFileSync(new URL('./ConsolePluginsPane.vue', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./PluginParameterDialog.vue', import.meta.url), 'utf8');
const valueDialogSource = readFileSync(new URL('./PluginParameterValueDialog.vue', import.meta.url), 'utf8');
const parameterModelSource = readFileSync(new URL('./plugin-parameter-model.ts', import.meta.url), 'utf8');
const deleteDialogSource = readFileSync(new URL('./PluginDeleteDialog.vue', import.meta.url), 'utf8');
const engineTagsSource = readFileSync(new URL('./PluginEngineTags.vue', import.meta.url), 'utf8');
const statusBarSource = readFileSync(new URL('../layout/StatusBar.vue', import.meta.url), 'utf8');

describe('plugin manager structure', () => {
  test('uses one searchable list with configured and unconfigured groups', () => {
    assert.match(paneSource, /plugins\.configuredGroup/);
    assert.match(paneSource, /plugins\.unconfiguredFiles/);
    assert.match(paneSource, /<el-switch/);
    assert.match(paneSource, /class="drag-handle"/);
    assert.match(paneSource, /class="drag-handle-dots"/);
    assert.equal((paneSource.match(/<circle /g) || []).length, 6);
    assert.match(paneSource, /plugins\.addToConfiguration/);
    assert.match(paneSource, /clearSearchToReorder/);
    assert.match(paneSource, /min-height: 44px/);
    assert.match(paneSource, /border-bottom: 1px solid var\(--console-border/);
    assert.match(paneSource, /grid-template-columns: 22px minmax\(0, 1fr\) 36px/);
    assert.match(paneSource, /<PluginEngineTags :targets="plugin\.header\.target"/);
    assert.match(paneSource, /<PluginEngineTags :targets="selectedHeader\.target"/);
    assert.match(engineTagsSource, /class="plugin-engine-tag"/);
    assert.match(engineTagsSource, /plugin-engine-tag\.mv/);
    assert.match(engineTagsSource, /plugin-engine-tag\.mz/);
    assert.doesNotMatch(paneSource, /plugin-badges|summary-card|technical-details/);
  });

  test('keeps selection, parameter editing, and ordering as distinct interactions', () => {
    assert.match(paneSource, /@click="selectPlugin\(plugin\)"/);
    assert.match(paneSource, /@dblclick="openParameterDialog\(plugin\)"/);
    assert.match(paneSource, /@click="openParameterDialog\(selectedPlugin\)"/);
    assert.match(paneSource, /@dblclick\.stop/);
    assert.match(paneSource, /event\.altKey && event\.key === 'ArrowUp'/);
    assert.match(paneSource, /event\.altKey && event\.key === 'ArrowDown'/);
    assert.match(paneSource, /draggedIndex\.value = plugin\.index/);
    assert.match(paneSource, /pluginApi\.reorder\(indexes,/);
    assert.match(paneSource, /<PluginParameterDialog/);
    assert.match(paneSource, /v-model="parameterDialogOpen"/);
    assert.match(paneSource, /parameterDialogPluginName\.value = plugin\.name/);
    assert.match(paneSource, /const plugin = parameterDialogPlugin\.value/);
    assert.doesNotMatch(paneSource, /plugins\.moveUp|plugins\.moveDown/);
  });

  test('offers explicit cancel, remove-configuration, and delete-file choices', () => {
    assert.match(paneSource, /<PluginDeleteDialog/);
    assert.match(deleteDialogSource, /editor\.mapProperties\.cancel/);
    assert.match(deleteDialogSource, /plugins\.removeConfigOnly/);
    assert.match(deleteDialogSource, /plugins\.deleteFileAndConfig/);
    assert.match(deleteDialogSource, /removeConfigOnlyDescription/);
    assert.match(deleteDialogSource, /deleteFileAndConfigDescription/);
    assert.match(deleteDialogSource, /deleteStagingNotice/);
    assert.match(paneSource, /class="primary-action"/);
    assert.match(paneSource, /class="danger-action"/);
  });

  test('renders metadata and help as plain text and stages source changes', () => {
    assert.match(paneSource, /<el-descriptions :column="1" size="small" border>/);
    assert.match(paneSource, /<el-descriptions-item/);
    assert.match(paneSource, /selectedHeader\.target/);
    assert.match(paneSource, /plugins\.incompatibleTarget/);
    assert.match(paneSource, /compatibility-label/);
    assert.match(paneSource, /selectedHeader\.author/);
    assert.match(paneSource, /selectedHeader\.base/);
    assert.match(paneSource, /selectedHeader\.orderAfter/);
    assert.match(paneSource, /<el-tabs[\s\S]+type="card"/);
    assert.match(paneSource, /v-for="tab in selectedHelpTabs"/);
    assert.match(paneSource, /pluginHelpLanguageKey/);
    assert.match(paneSource, /plugins\.locatePlugin/);
    assert.match(paneSource, /navigateToPluginReference/);
    assert.match(paneSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
    assert.match(paneSource, /class="metadata-reference"/);
    assert.match(paneSource, /<pre v-if="tab\.content">/);
    assert.match(paneSource, /plugins\.stagingSourceUntouched/);
    assert.doesNotMatch(paneSource, /v-html|marked\(/);
  });

  test('uses an original-style guarded parameter table and a typed value editor', () => {
    assert.match(dialogSource, /v-model="visible"/);
    assert.match(dialogSource, /:before-close="confirmClose"/);
    assert.match(dialogSource, /unsavedParametersConfirm/);
    assert.match(dialogSource, /:disabled="busy \|\| !parametersDirty"/);
    assert.match(dialogSource, /parameterBasicSettings/);
    assert.match(dialogSource, /parameterNameColumn/);
    assert.match(dialogSource, /parameterValueColumn/);
    assert.match(dialogSource, /<PluginParameterValueDialog/);
    assert.match(valueDialogSource, /<PluginParameterInput/);
    assert.doesNotMatch(dialogSource, /parameter-json|parametersJson|unknownParamsJson|<textarea/);
    assert.match(dialogSource, /parameterReadonlyReason|parameterMissingFileReadonly/);
    assert.match(parameterModelSource, /clonePluginParameterValue/);
    assert.doesNotMatch(
      `${dialogSource}\n${valueDialogSource}\n${parameterModelSource}`,
      /structuredClone/,
    );
  });

  test('sets plugin count context and hides zoom only on the plugin page', () => {
    assert.match(paneSource, /workbenchUi\.sbContextText = t\('plugins\.statusCount'/);
    assert.match(paneSource, /workbenchUi\.sbHideZoom = true/);
    assert.match(paneSource, /onBeforeUnmount\([\s\S]+workbenchUi\.sbContextText = ''/);
    assert.match(paneSource, /onBeforeUnmount\([\s\S]+workbenchUi\.sbHideZoom = false/);
    assert.match(statusBarSource, /ui\.sbContextText/);
    assert.match(statusBarSource, /v-if="!ui\.sbHideZoom"/);
  });

  test('shows a dedicated load failure instead of an empty plugin list and zero count', () => {
    assert.match(paneSource, /v-else-if="loadFailed" class="state load-failed"/);
    assert.match(paneSource, /plugins\.loadFailed/);
    assert.match(paneSource, /plugins\.retryLoad/);
    assert.match(paneSource, /if \(!config\.value\) \{\s*workbenchUi\.sbContextText = '';/s);
    assert.match(paneSource, /loadFailed\.value = true/);
  });
});
