import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseProjectAssetBrowserNodeId,
  projectAssetBrowserAllowsPictureSubfolders,
  projectAssetBrowserNodeId,
} from './project-asset-browser-nodes.ts';

describe('project-asset-browser-nodes', () => {
  test('parses category and optional subpath', () => {
    assert.deepEqual(parseProjectAssetBrowserNodeId('pictures'), {
      categoryId: 'pictures',
      subpath: '',
    });
    assert.deepEqual(parseProjectAssetBrowserNodeId('pictures/ui/foo'), {
      categoryId: 'pictures',
      subpath: 'ui/foo',
    });
    assert.equal(projectAssetBrowserNodeId('pictures', 'ui/foo'), 'pictures/ui/foo');
    assert.equal(projectAssetBrowserNodeId('pictures'), 'pictures');
  });

  test('rejects empty or escaping node ids', () => {
    assert.throws(() => parseProjectAssetBrowserNodeId(''), /non-empty/);
    assert.throws(() => parseProjectAssetBrowserNodeId('pictures/../x'), /\.\./);
  });

  test('picture subfolders are MZ-only', () => {
    assert.equal(projectAssetBrowserAllowsPictureSubfolders('rpg-maker-mz'), true);
    assert.equal(projectAssetBrowserAllowsPictureSubfolders('rpg-maker-mv'), false);
  });
});
