import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const viewSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ProjectAssetsWorkspace.vue'),
  'utf8',
);

describe('projectAssetsView phase1 structure', () => {
  test('uses checkerboard thumbs, details mode, path bar, and el-image viewer', () => {
    assert.match(viewSource, /background-size:\s*12px 12px/);
    assert.match(viewSource, /projectAssets\.viewDetails/);
    assert.match(viewSource, /project-assets-path-bar/);
    assert.match(viewSource, /ElImageViewer/);
    assert.match(viewSource, /openFolderContextMenu/);
    assert.match(viewSource, /renameSubfolder/);
    assert.doesNotMatch(viewSource, /hoverPreview/);
    assert.match(viewSource, /THUMB_ARM_BATCH\s*=\s*6/);
  });

  test('extension tags strip the leading dot so color classes can match', () => {
    assert.match(viewSource, /raw\.replace\(\/\^\\\.\/, ''\)\.toLowerCase\(\)/);
  });

  test('details rows count as grid cells for pointer/contextmenu routing', () => {
    assert.match(viewSource, /\.project-assets-cell, \.project-assets-details-row/);
  });

  test('watcher refresh preserves view state and marquee accounts for inset + folders', () => {
    assert.match(viewSource, /refreshSilently/);
    assert.match(viewSource, /preserveViewState: true/);
    assert.match(viewSource, /originX: GRID_INSET/);
    assert.match(viewSource, /leadingItemCount: gridItems\.value\.length - orderedFileIds\.value\.length/);
  });

  test('copy path targets the absolute directory', () => {
    assert.match(viewSource, /displayAbsoluteDirectory/);
  });

  test('favorites virtual node aggregates files and folders', () => {
    assert.match(viewSource, /FAVORITES_NODE_ID = '__favorites__'/);
    assert.match(viewSource, /loadFavoritesListing/);
    assert.match(viewSource, /favoriteListingNodes/);
    assert.match(viewSource, /entryCategoryId/);
    assert.match(viewSource, /ensureFolderPreview\(categoryId: string\)[\s\S]*categoryId === FAVORITES_NODE_ID[\s\S]*folderPreviews\.value\.set\(categoryId, \[\]\)/);
  });

  test('folder delete asks again when nested assets are still referenced', () => {
    assert.match(viewSource, /removeSubfolder\(folderId, false/);
    assert.match(viewSource, /projectAssets\.folderDeleteForceConfirm/);
  });

  test('marquee applies selection live while dragging', () => {
    assert.match(viewSource, /function applyMarqueeSelection/);
    assert.match(viewSource, /applyMarqueeSelection\(marquee\.value\)/);
    assert.match(viewSource, /applyMarqueeSelection\(draft\)/);
  });

  test('metadata tooltip is a pointer-anchored fixed card, not el-tooltip', () => {
    assert.doesNotMatch(viewSource, /el-tooltip/);
    assert.match(viewSource, /onItemMouseEnter/);
    assert.match(viewSource, /clearMetaTooltip/);
    assert.match(viewSource, /class="project-assets-meta-tooltip"/);
    assert.match(viewSource, /position: fixed;\s*\n\s*z-index: 60;/);
  });
});
