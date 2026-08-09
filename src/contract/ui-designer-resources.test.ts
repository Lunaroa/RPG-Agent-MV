import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  assertUiDesignerDocumentResourcePaths,
  normalizeUiDesignerProjectRelativeResourcePath,
  normalizeUiDesignerResourceProperty,
  projectAssetCategoryMatchesUiDesignerResourceKind,
} from './ui-designer-resources.ts';

describe('UI Designer managed resource contract', () => {
  test('normalizes project-relative paths and rejects URI, absolute, traversal, and nested unsafe paths', () => {
    const absolutePath = path.join(os.tmpdir(), 'assets', 'image.png');
    const rootedPath = path.posix.join(path.posix.sep, 'assets', 'image.png');
    const uncPath = `${path.win32.sep}${path.win32.sep}${['host.invalid', 'share', 'frame.png'].join(path.win32.sep)}`;
    assert.equal(normalizeUiDesignerProjectRelativeResourcePath('img\\pictures\\panel.png'), 'img/pictures/panel.png');
    for (const value of ['asset://preview/image', absolutePath, rootedPath, uncPath, '../assets/image.png', 'img/../image.png']) {
      assert.throws(() => normalizeUiDesignerProjectRelativeResourcePath(value));
    }
    assert.throws(() => normalizeUiDesignerResourceProperty('imageStates', {
      normal: 'img/pictures/normal.png',
      hover: 'https://example.invalid/hover.png',
      pressed: '',
      disabled: '',
    }));
    assert.throws(() => assertUiDesignerDocumentResourcePaths({
      nodes: [{ props: { frames: [{ path: uncPath }] } }],
    }));
  });

  test('maps project asset categories to every Inspector resource kind', () => {
    assert.equal(projectAssetCategoryMatchesUiDesignerResourceKind('pictures/ui', 'image'), true);
    assert.equal(projectAssetCategoryMatchesUiDesignerResourceKind('se', 'audio'), true);
    assert.equal(projectAssetCategoryMatchesUiDesignerResourceKind('movies', 'video'), true);
    assert.equal(projectAssetCategoryMatchesUiDesignerResourceKind('fonts', 'font'), true);
    assert.equal(projectAssetCategoryMatchesUiDesignerResourceKind('effects', 'image'), false);
  });
});
