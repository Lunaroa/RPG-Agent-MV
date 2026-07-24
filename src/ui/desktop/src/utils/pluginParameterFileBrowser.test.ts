import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PluginFileAssetOption } from './pluginParameterFileAssets';
import {
  ancestorPluginFileFolderPaths,
  buildPluginFileTree,
  folderPathOfAssetName,
  listPluginFileGalleryEntries,
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

  test('resolves folder ancestors for opening an existing nested selection', () => {
    assert.equal(folderPathOfAssetName('ui/Badge'), 'ui');
    assert.deepEqual(ancestorPluginFileFolderPaths('busts/aedxy/normal'), [
      'busts',
      'busts/aedxy',
    ]);
  });
});
