import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const paneSource = readFileSync(new URL('./ConsolePluginsPane.vue', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./PluginParameterDialog.vue', import.meta.url), 'utf8');
const valueDialogSource = readFileSync(new URL('./PluginParameterValueDialog.vue', import.meta.url), 'utf8');
const collectionEditorSource = readFileSync(
  new URL('./PluginParameterCollectionEditor.vue', import.meta.url),
  'utf8',
);
const parameterModelSource = readFileSync(new URL('./plugin-parameter-model.ts', import.meta.url), 'utf8');
const parameterTreeModelSource = readFileSync(
  new URL('./plugin-parameter-tree-model.ts', import.meta.url),
  'utf8',
);
const collectionModelSource = readFileSync(
  new URL('./plugin-parameter-collection-model.ts', import.meta.url),
  'utf8',
);
const parameterInputSource = readFileSync(
  new URL('../editor/PluginParameterInput.vue', import.meta.url),
  'utf8',
);
const tilesetPickerSource = readFileSync(
  new URL('../editor/PluginParameterTilesetPickerDialog.vue', import.meta.url),
  'utf8',
);
const filePickerSource = readFileSync(
  new URL('../editor/PluginParameterFilePickerDialog.vue', import.meta.url),
  'utf8',
);
const audioPreviewSource = readFileSync(
  new URL('../editor/PluginFileAudioPreview.vue', import.meta.url),
  'utf8',
);
const systemNamedEntrySelectorSource = readFileSync(
  new URL('../editor/SystemNamedEntrySelectorDialog.vue', import.meta.url),
  'utf8',
);
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
    assert.match(
      paneSource,
      /v-if="selectedPlugin && hasConfigurableParameters\(selectedPlugin\)"/,
    );
    assert.match(paneSource, /@click="openParameterDialog\(selectedPlugin\)"/);
    assert.match(
      paneSource,
      /function hasConfigurableParameters[\s\S]+parameterSchema\?\.fields\.length/,
    );
    assert.match(
      paneSource,
      /!hasConfigurableParameters\(plugin\)/,
    );
    assert.match(paneSource, /@dblclick\.stop/);
    assert.match(paneSource, /event\.altKey && event\.key === 'ArrowUp'/);
    assert.match(paneSource, /event\.altKey && event\.key === 'ArrowDown'/);
    assert.match(paneSource, /navigatePluginList\(configuredRowKey\(plugin\.index\), -1\)/);
    assert.match(paneSource, /navigatePluginList\(configuredRowKey\(plugin\.index\), 1\)/);
    assert.match(paneSource, /navigatePluginList\(fileKey\(file\.relativePath\), -1\)/);
    assert.match(paneSource, /navigatePluginList\(fileKey\(file\.relativePath\), 1\)/);
    assert.equal((paneSource.match(/event\.target !== event\.currentTarget/g) || []).length, 2);
    assert.match(paneSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
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
    assert.equal((deleteDialogSource.match(/<el-button/g) || []).length, 3);
    assert.match(deleteDialogSource, /<el-button type="danger" :disabled="busy" @click="\$emit\('deleteFile'\)">/);
    assert.doesNotMatch(deleteDialogSource, /<button|button\.danger/);
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
    assert.match(
      paneSource,
      /\.help-panel pre \{[\s\S]+font: 13px\/1\.8 "Microsoft YaHei", "Microsoft YaHei UI", "微软雅黑", var\(--app-font-sans\)/,
    );
    assert.match(paneSource, /\.help-panel pre \{[\s\S]+background: color-mix\(/);
    assert.match(paneSource, /\.help-panel pre \{[\s\S]+font-variant-ligatures: none/);
    assert.match(paneSource, /plugins\.stagingSourceUntouched/);
    assert.doesNotMatch(paneSource, /v-html|marked\(/);
  });

  test('uses an original-style guarded parameter table and a typed value editor', () => {
    assert.match(dialogSource, /v-model="visible"/);
    assert.match(dialogSource, /:before-close="confirmClose"/);
    assert.match(dialogSource, /:close-on-click-modal="!busy"/);
    assert.match(dialogSource, /unsavedParametersConfirm/);
    assert.match(dialogSource, /:disabled="busy \|\| !parametersDirty"/);
    assert.match(dialogSource, /parameterNameColumn/);
    assert.match(dialogSource, /parameterTypeColumn/);
    assert.match(dialogSource, /parameterValueColumn/);
    assert.match(dialogSource, /parameterTypeLabel\(row\)/);
    assert.match(dialogSource, /class="parameter-type-text"/);
    assert.match(dialogSource, /pluginParameterTypeLabelIsList|parameterTypeDisplay/);
    assert.match(dialogSource, /parameterTypeListTag/);
    assert.match(dialogSource, /parameter-struct-tag/);
    assert.doesNotMatch(dialogSource, /isSpecialPluginParameterType/);
    assert.match(dialogSource, /isTaggedPluginParameterValue\(row\.field\)/);
    assert.match(dialogSource, /class="parameter-value-tag"/);
    assert.match(dialogSource, /class-name="parameter-value-column"/);
    assert.match(dialogSource, /PluginParameterValueDecor/);
    assert.match(dialogSource, /parameter-select-value/);
    assert.match(dialogSource, /resolvePluginParameterSelectPresentation/);
    assert.match(
      dialogSource,
      /tr:hover > td\.parameter-value-column[\s\S]+tr\.current-row > td\.parameter-value-column/,
    );
    assert.match(dialogSource, /<el-table/);
    assert.match(dialogSource, /@header-dragend="onMainHeaderDragEnd"/);
    assert.match(dialogSource, /pluginParameterMainColumns/);
    assert.match(dialogSource, /normalizePluginParameterMainColumns/);
    assert.match(dialogSource, /mainColumnWidths/);
    assert.match(dialogSource, /column-key="name"/);
    assert.match(dialogSource, /column-key="type"/);
    assert.match(dialogSource, /resizable/);
    assert.match(dialogSource, /<el-switch[\s\S]+disabled[\s\S]+class="parameter-boolean-switch"/);
    assert.match(dialogSource, /isBooleanParameterEnabled/);
    assert.match(dialogSource, /buildPluginParameterTree/);
    assert.match(dialogSource, /flattenPluginParameterTree/);
    assert.match(dialogSource, /parameterTreeSearchPlaceholder/);
    assert.match(dialogSource, /class="parameter-search"/);
    assert.doesNotMatch(dialogSource, /parameter-section-header/);
    assert.match(dialogSource, /width="min\(1160px, calc\(100vw - 48px\)\)"/);
    assert.match(dialogSource, /\.parameter-table-wrap \{[\s\S]+overflow: hidden/);
    assert.match(dialogSource, /event\.key === 'ArrowRight'/);
    assert.match(dialogSource, /event\.key === 'ArrowLeft'/);
    assert.match(dialogSource, /@row-dblclick="\(row: VisiblePluginParameterTreeRow\) => openParameterEditor\(row\.key\)"/);
    assert.match(dialogSource, /function onParameterTableKeydown/);
    assert.doesNotMatch(dialogSource, /parameter-row-edit/);
    assert.match(dialogSource, /<el-tag[\s\S]+class="parameter-key-tag"[\s\S]+\{\{ row\.key \}\}/);
    assert.match(
      dialogSource,
      /\.parameter-key-tag \{[\s\S]+animation: none[\s\S]+transition: none/,
    );
    assert.match(dialogSource, /<div v-if="selectedRow" class="parameter-detail" aria-live="polite">[\s\S]+selectedRow\.description/);
    assert.match(dialogSource, /selectedRow\.readonlyReason/);
    assert.doesNotMatch(dialogSource, /selectedRow\.fullValue/);
    assert.doesNotMatch(dialogSource, /plugin-information|parameterBasicSettings|class="plugin-help"/);
    assert.match(dialogSource, /<el-button :disabled="busy" @click="confirmClose\(\)">/);
    assert.match(dialogSource, /<el-button[\s\S]+type="primary"[\s\S]+:loading="busy"[\s\S]+@click="save"/);
    assert.match(dialogSource, /<PluginParameterValueDialog/);
    assert.match(valueDialogSource, /defineOptions\(\{ name: 'PluginParameterValueDialog' \}\)/);
    assert.doesNotMatch(valueDialogSource, /class="parameter-meta"/);
    assert.match(valueDialogSource, /formatParameterDialogTitle/);
    assert.match(valueDialogSource, /plugins\.parameterTitleWithKey/);
    assert.match(valueDialogSource, /plugins\.parameterTitleWithScope/);
    assert.match(valueDialogSource, /<PluginParameterInput[\s\S]+v-else/);
    assert.match(valueDialogSource, /<el-tabs[\s\S]+type="card"/);
    assert.match(valueDialogSource, /activeTab\.value = 'editor'/);
    assert.match(valueDialogSource, /name="editor"/);
    assert.match(valueDialogSource, /name="text"/);
    assert.match(valueDialogSource, /editorTabLabel/);
    assert.match(valueDialogSource, /plugins\.parameterTextTab/);
    assert.match(valueDialogSource, /class="parameter-raw-input"[\s\S]+type="textarea"/);
    assert.match(valueDialogSource, /parsePluginParameterRawStrict/);
    assert.match(valueDialogSource, /serializePluginParameterRaw/);
    assert.match(valueDialogSource, /:before-close="confirmClose"/);
    assert.match(valueDialogSource, /:close-on-click-modal="true"/);
    assert.match(valueDialogSource, /pendingAppend/);
    assert.match(valueDialogSource, /allow-unchanged-commit/);
    assert.match(valueDialogSource, /<PluginParameterCollectionEditor/);
    assert.match(
      valueDialogSource,
      /<PluginParameterValueDialog[\s\S]+v-if="childDialogOpen && childEditor"[\s\S]+v-model="childDialogOpen"/,
    );
    assert.match(valueDialogSource, /createDefaultPluginParameterValue\(item\)/);
    assert.match(
      valueDialogSource,
      /:disabled="Boolean\(validationIssue\) \|\| \(!changed && !allowUnchangedCommit\)"/,
    );
    assert.match(collectionEditorSource, /buildPluginParameterCollectionColumns/);
    assert.match(collectionEditorSource, /buildPluginParameterTree/);
    assert.match(collectionEditorSource, /flattenPluginParameterTree/);
    assert.match(collectionEditorSource, /<el-table/);
    assert.match(collectionEditorSource, /@header-dragend="onMainHeaderDragEnd"/);
    assert.match(collectionEditorSource, /@header-dragend="onCollectionHeaderDragEnd"/);
    assert.match(collectionEditorSource, /pluginParameterMainColumns/);
    assert.match(collectionEditorSource, /pluginParameterCollectionColumns/);
    assert.match(collectionEditorSource, /normalizePluginParameterMainColumns/);
    assert.match(collectionEditorSource, /normalizePluginParameterCollectionColumns/);
    assert.match(collectionEditorSource, /mainColumnWidths/);
    assert.match(collectionEditorSource, /column-key="name"/);
    assert.match(collectionEditorSource, /column-key="type"/);
    assert.match(collectionEditorSource, /class="parameter-type-text"/);
    assert.match(collectionEditorSource, /pluginParameterTypeLabelIsList|structTypeDisplay/);
    assert.match(collectionEditorSource, /parameterTypeListTag/);
    assert.match(collectionEditorSource, /parameter-struct-tag/);
    assert.match(collectionEditorSource, /resizable/);
    assert.match(collectionEditorSource, /parameterTypeColumn/);
    assert.match(collectionEditorSource, /class="array-toolbar"/);
    assert.match(collectionEditorSource, /plugins\.parameterSelectedCount/);
    assert.match(collectionEditorSource, /plugins\.parameterCopySelected/);
    assert.match(collectionEditorSource, /plugins\.parameterDeleteSelected/);
    assert.match(collectionEditorSource, /toggleVisibleSelection/);
    assert.match(collectionEditorSource, /ElMessageBox\.confirm/);
    assert.match(collectionEditorSource, /clipboard\.writeText/);
    assert.match(collectionEditorSource, /@row-dblclick="\(row\) => editArrayItem\(row\.index\)"/);
    assert.match(collectionEditorSource, /event\.key === 'Enter'/);
    assert.match(collectionEditorSource, /event\.altKey && \(event\.key === 'ArrowUp'/);
    assert.match(collectionEditorSource, /class="drag-handle"/);
    assert.equal((collectionEditorSource.match(/<circle /g) || []).length, 6);
    assert.match(collectionEditorSource, /@pointerdown="startPointerDrag/);
    assert.match(collectionEditorSource, /column\.field\.kind === 'boolean'/);
    assert.match(collectionEditorSource, /arrayItem\?\.kind === 'boolean'/);
    assert.match(collectionEditorSource, /<el-switch[\s\S]+disabled[\s\S]+class="parameter-boolean-switch"/);
    assert.match(collectionEditorSource, /isTaggedPluginParameterValue/);
    assert.match(collectionEditorSource, /class="parameter-value-tag"/);
    assert.match(collectionEditorSource, /class-name="parameter-value-column"/);
    assert.match(collectionEditorSource, /PluginParameterValueDecor/);
    assert.match(collectionEditorSource, /parameter-select-value/);
    assert.doesNotMatch(collectionEditorSource, /isSpecialPluginParameterType/);
    assert.doesNotMatch(collectionEditorSource, /updateArrayBoolean|updateStructRowBoolean/);
    assert.match(parameterModelSource, /unwrapNotePluginParameterValue|wrapNotePluginParameterValue/);
    assert.match(parameterModelSource, /isNotePluginParameterField/);
    assert.match(parameterModelSource, /isTaggedPluginParameterValue/);
    assert.match(
      parameterModelSource,
      /field\.kind === 'location'[\s\S]+field\.kind === 'struct'/,
    );
    assert.match(
      dialogSource,
      /\.parameter-value-tag \{[\s\S]+border-color:[\s\S]+animation: none/,
    );
    assert.match(
      collectionEditorSource,
      /\.parameter-value-tag \{[\s\S]+border-color:[\s\S]+animation: none/,
    );
    assert.match(valueDialogSource, /is-compound/);
    assert.match(valueDialogSource, /min-height: 88px/);
    assert.match(valueDialogSource, /parameter-description[\s\S]+parameter-mode-tabs/);
    assert.match(valueDialogSource, /ActorWalkingSheetThumb/);
    assert.match(valueDialogSource, /showActorPreview/);
    assert.match(systemNamedEntrySelectorSource, /z-index: v-bind\(subDialogZ\)/);
    assert.match(systemNamedEntrySelectorSource, /LAYER_Z\.subDialog/);
    assert.match(tilesetPickerSource, /z-index: v-bind\(subDialogZ\)/);
    assert.match(tilesetPickerSource, /LAYER_Z\.subDialog/);
    assert.match(valueDialogSource, /overflow: visible/);
    assert.match(valueDialogSource, /\.el-tabs__content[\s\S]+padding: 4px/);
    assert.match(parameterInputSource, /listRelativeDirectory/);
    assert.match(parameterInputSource, /directoryNotFound|pluginFilePicker\.directoryNotFound/);
    assert.doesNotMatch(parameterInputSource, /unsupportedDirectory/);
    assert.match(parameterInputSource, /systemNamedEntryKind/);
    assert.match(parameterInputSource, /:size="48"/);
    assert.match(parameterInputSource, /plugin-parameter-actor-popper|plugin-parameter-media-popper/);
    assert.match(parameterInputSource, /IconSetThumb/);
    assert.match(parameterInputSource, /databaseOptionHasMedia/);
    assert.match(systemNamedEntrySelectorSource, /systemNamedEntry\.changeMaximum/);
    assert.match(systemNamedEntrySelectorSource, /projectManagement\.updateEntry/);
    assert.match(systemNamedEntrySelectorSource, /projectManagement\.resizeDatabase/);
    assert.doesNotMatch(collectionEditorSource, /class="parameter-row-edit"/);
    assert.doesNotMatch(collectionEditorSource, /actions-column|collection-actions/);
    assert.match(collectionEditorSource, /overflow: hidden/);
    assert.match(collectionEditorSource, /class="parameter-el-table/);
    assert.match(collectionModelSource, /parsePluginParameterRawStrict/);
    assert.match(collectionModelSource, /PLUGIN_PARAMETER_CLIPBOARD_LIMIT = 32 \* 1024/);
    assert.match(collectionModelSource, /removePluginParameterArrayItems/);
    assert.match(collectionModelSource, /movePluginParameterArrayItem/);
    assert.match(parameterModelSource, /return displayPluginParameterValue\(value\)\.trim\(\)/);
    assert.doesNotMatch(
      `${valueDialogSource}\n${collectionEditorSource}`,
      /class="compound-input"|class="array-item"/,
    );
    assert.doesNotMatch(dialogSource, /parameter-json|parametersJson|unknownParamsJson|<textarea/);
    assert.match(dialogSource, /parameterReadonlyReason|parameterMissingFileReadonly/);
    assert.match(parameterModelSource, /clonePluginParameterValue/);
    assert.match(parameterTreeModelSource, /findParentCycles/);
    assert.match(parameterTreeModelSource, /includeAncestors/);
    assert.match(parameterTreeModelSource, /includeDescendants/);
    assert.match(parameterInputSource, /ActorWalkingFrameThumb/);
    assert.match(parameterInputSource, /isActorDatabase/);
    assert.match(parameterInputSource, /<el-switch/);
    assert.match(parameterInputSource, /allow-create/);
    assert.match(parameterInputSource, /field\.kind === 'file'/);
    assert.match(parameterInputSource, /PluginParameterFilePickerDialog/);
    assert.match(filePickerSource, /PluginFileAudioPreview/);
    assert.doesNotMatch(filePickerSource, /<audio[\s\S]+controls/);
    assert.match(audioPreviewSource, /formatPluginAudioClock/);
    assert.match(audioPreviewSource, /createPluginAudioPlaybackBundle/);
    assert.match(audioPreviewSource, /<el-slider/);
    assert.match(audioPreviewSource, /vertical/);
    assert.match(audioPreviewSource, /<el-popover/);
    assert.match(audioPreviewSource, /placement="top"/);
    assert.match(audioPreviewSource, /:z-index="volumeZ"|LAYER_Z\.contextMenu/);
    assert.match(audioPreviewSource, /teleported/);
    assert.doesNotMatch(audioPreviewSource, /transform: rotate\(-90deg\)/);
    assert.doesNotMatch(audioPreviewSource, /orient="vertical"/);
    assert.match(parameterInputSource, /PluginParameterTilesetPickerDialog/);
    assert.match(parameterInputSource, /isTilesetDatabase/);
    assert.match(valueDialogSource, /showTilesetPreview|resolvePluginTilesetPreviewUrl/);
    assert.match(parameterInputSource, /resolvePluginParameterFileAssets/);
    assert.doesNotMatch(parameterInputSource, /fileSelectOptions/);
    assert.match(parameterInputSource, /field\.kind === 'location'/);
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
