import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withProductLanguage } from '../i18n/request-language.ts';
import { resolveMapLibraryPackage } from './map-library-package.ts';

describe('resolveMapLibraryPackage', () => {
  it('uses importBatch sourceSlug and human-readable project label', () => {
    const pkg = withProductLanguage('zh-CN', () => resolveMapLibraryPackage({
      assetId: 'map-1',
      importBatch: {
        sourceSlug: 'dlc-fsm-autumn-woods-and-41e7d34a',
        sourceProject:
          'C:/path/to/dlc-sample',
      },
      source: {
        name: 'Local RPG Maker MV Build: dlc/sample-pack',
      },
    }));
    assert.equal(pkg.packageId, 'dlc-fsm-autumn-woods-and-41e7d34a');
    assert.equal(pkg.packageLabel, 'FSM·秋日森林与乡村 / 示例项目');
  });

  it('derives package id from localPath when importBatch is missing', () => {
    const pkg = withProductLanguage('zh-CN', () => resolveMapLibraryPackage({
      assetId: 'map-2',
      source: {
        localPath:
          'data/assets/map-visual-library/batch-1/my-pack-slug/my-pack-slug-map001-abc',
      },
    }));
    assert.equal(pkg.packageId, 'my-pack-slug');
  });
});
