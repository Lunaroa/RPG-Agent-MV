import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isProjectAssetUserPictureSubfolder,
  normalizeProjectAssetFolderLeafName,
} from './projectAssetFolderPolicy.ts';

describe('projectAssetFolderPolicy', () => {
  it('treats only pictures/* subpaths as user folders', () => {
    assert.equal(isProjectAssetUserPictureSubfolder('pictures'), false);
    assert.equal(isProjectAssetUserPictureSubfolder('characters'), false);
    assert.equal(isProjectAssetUserPictureSubfolder('pictures/busts'), true);
    assert.equal(isProjectAssetUserPictureSubfolder('pictures/busts/als_1'), true);
  });

  it('normalizes a single folder leaf name', () => {
    assert.equal(normalizeProjectAssetFolderLeafName('  busts  '), 'busts');
    assert.throws(() => normalizeProjectAssetFolderLeafName('a/b'), /Invalid folder name/);
    assert.throws(() => normalizeProjectAssetFolderLeafName('..'), /Invalid folder name/);
  });
});
