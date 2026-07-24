import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PluginFileAssetOption } from './pluginParameterFileAssets';
import {
  ancestorPluginFileFolderPaths,
  buildPluginFileTree,
  folderPathOfAssetName,
  listPluginFileGalleryEntries,
  movePluginFileGalleryNavIndex,
  PLUGIN_FILE_GALLERY_NONE_ID,
  resolvePluginFileGalleryColumnCount,
  resolvePluginFileGalleryFocusId,
} from './pluginParameterFileBrowser';

function asset(name: string, url = `rmmv-asset://${name}`): PluginFileAssetOption {
  return { name, fileName: `${name}.png`, url };
}

describe('pluginParameterFileBrowser', () => {
  test('builds a nested tree from relative asset paths', () => {
    const tree = buildPluginFileTree([
      asset('Actor1'),
      asset('ui/Badge'),
      asset('ui/Frame'),
      asset('busts/aedxy/normal'),
    ]);

    assert.deepEqual(
      tree.map((node) => ({ kind: node.kind, id: node.id, label: node.label })),
      [
        { kind: 'folder', id: 'busts', label: 'busts' },
        { kind: 'folder', id: 'ui', label: 'ui' },
        { kind: 'file', id: 'Actor1', label: 'Actor1' },
      ],
    );

    const busts = tree[0];
    assert.equal(busts?.kind, 'folder');
    if (busts?.kind !== 'folder') return;
    assert.equal(busts.children[0]?.kind, 'folder');
    assert.equal(busts.children[0]?.id, 'busts/aedxy');
  });

  test('lists gallery entries for the current folder with parent and nested folders', () => {
    const assets = [
      asset('Actor1'),
      asset('ui/Badge'),
      asset('ui/Frame'),
      asset('busts/aedxy/normal'),
    ];

    const root = listPluginFileGalleryEntries(assets, '');
    assert.deepEqual(
      root.map((entry) => ({ kind: entry.kind, id: entry.id, label: entry.label })),
      [
        { kind: 'folder', id: 'busts', label: 'busts' },
        { kind: 'folder', id: 'ui', label: 'ui' },
        { kind: 'file', id: 'Actor1', label: 'Actor1' },
      ],
    );
    const uiFolder = root.find((entry) => entry.kind === 'folder' && entry.id === 'ui');
    assert.equal(uiFolder?.kind, 'folder');
    if (uiFolder?.kind === 'folder') {
      assert.deepEqual(uiFolder.previewUrls, [
        'rmmv-asset://ui/Badge',
        'rmmv-asset://ui/Frame',
      ]);
    }

    const ui = listPluginFileGalleryEntries(assets, 'ui', { parentLabel: '..' });
    assert.deepEqual(
      ui.map((entry) => ({ kind: entry.kind, id: entry.id, label: entry.label })),
      [
        { kind: 'parent', id: '..', label: '..' },
        { kind: 'file', id: 'ui/Badge', label: 'Badge' },
        { kind: 'file', id: 'ui/Frame', label: 'Frame' },
      ],
    );
  });

  test('includes empty folders from an explicit folder list', () => {
    const root = listPluginFileGalleryEntries([asset('Actor1')], '', {
      folders: ['empty_box', 'ui'],
    });
    assert.deepEqual(
      root.filter((entry) => entry.kind === 'folder').map((entry) => entry.id),
      ['empty_box', 'ui'],
    );
    const tree = buildPluginFileTree([asset('Actor1')], ['empty_box']);
    assert.equal(tree.some((node) => node.kind === 'folder' && node.id === 'empty_box'), true);
  });

  test('resolves folder ancestors for opening an existing nested selection', () => {
    assert.equal(folderPathOfAssetName('ui/Badge'), 'ui');
    assert.deepEqual(ancestorPluginFileFolderPaths('busts/aedxy/normal'), [
      'busts',
      'busts/aedxy',
    ]);
  });

  test('moves gallery focus by grid columns for arrow keys', () => {
    assert.equal(movePluginFileGalleryNavIndex(6, 'ArrowUp', 5, 20), 1);
    assert.equal(movePluginFileGalleryNavIndex(1, 'ArrowDown', 5, 20), 6);
    assert.equal(movePluginFileGalleryNavIndex(0, 'ArrowLeft', 5, 20), 0);
    assert.equal(movePluginFileGalleryNavIndex(19, 'ArrowRight', 5, 20), 19);
    assert.equal(resolvePluginFileGalleryColumnCount(1400), 5);
    assert.equal(resolvePluginFileGalleryColumnCount(1200), 4);
    assert.equal(resolvePluginFileGalleryColumnCount(1000), 3);
    assert.equal(resolvePluginFileGalleryFocusId('', []), PLUGIN_FILE_GALLERY_NONE_ID);
  });
});
