import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const pickerSource = readFileSync(new URL('./PluginParameterFilePickerDialog.vue', import.meta.url), 'utf8');
const treeSource = readFileSync(new URL('./PluginFileTreeNodes.vue', import.meta.url), 'utf8');

describe('plugin file picker audio behavior', () => {
  test('keeps the audio default local and reuses shared duration probing', () => {
    assert.match(pickerSource, /isPluginFileAudioDirectory\(props\.directory\)[\s\S]+\?\s*'list'/);
    assert.match(pickerSource, /shouldPersistPluginFileBrowserViewMode\(props\.directory\)/);
    assert.match(pickerSource, /getCachedProjectAssetAudioDuration/);
    assert.match(pickerSource, /loadProjectAssetAudioDuration/);
    assert.match(pickerSource, /formatPluginAudioClock/);
    assert.match(pickerSource, /new IntersectionObserver/);
    assert.match(pickerSource, /data-audio-duration-url/);
    assert.match(pickerSource, /currentPath\.value,[\s\S]+expandedFolderIds\.value[\s\S]+rebindAudioDurationObserver/);
    assert.match(treeSource, /fileDurationLabels/);
    assert.match(treeSource, /tree-duration/);
  });

  test('does not render duration metadata for folders or the none row', () => {
    assert.match(treeSource, /v-if="fileDurationLabels\?\.has\(node\.asset\.url\)"/);
    assert.match(treeSource, /<button[\s\S]+v-else[\s\S]+tree-duration/);
  });
});
