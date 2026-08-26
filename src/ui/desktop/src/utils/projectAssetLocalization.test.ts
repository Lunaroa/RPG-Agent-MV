import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isProjectAssetGroupCategory,
  isProjectAssetImageCategory,
  projectAssetCanPreview,
  projectAssetCategoryLabel,
  projectAssetMediaKind,
} from './projectAssetLocalization';

describe('projectAssetLocalization', () => {
  test('maps backend svActors/svEnemies ids with IMAGE_BUCKET wording', () => {
    assert.equal(projectAssetCategoryLabel('svActors', 'zh-CN'), 'SV 角色');
    assert.equal(projectAssetCategoryLabel('svActors', 'en-US'), 'SV Actors');
    assert.equal(projectAssetCategoryLabel('svEnemies', 'zh-CN'), 'SV 敌人');
    assert.equal(projectAssetCategoryLabel('svEnemies', 'en-US'), 'SV Enemies');
    assert.equal(projectAssetCategoryLabel('characters', 'zh-CN'), '行走图');
    assert.equal(projectAssetCategoryLabel('characters', 'en-US'), 'Characters');
  });

  test('labels group nodes and non-image leaves', () => {
    assert.equal(projectAssetCategoryLabel('audio', 'zh-CN'), '音频');
    assert.equal(projectAssetCategoryLabel('img', 'en-US'), 'Images');
    assert.equal(projectAssetCategoryLabel('bgm', 'en-US'), 'BGM');
    assert.equal(projectAssetCategoryLabel('fonts', 'zh-CN'), '字体');
    assert.equal(projectAssetCategoryLabel('movies', 'zh-CN'), '视频');
    assert.equal(projectAssetCategoryLabel('effects', 'zh-CN'), '特效');
    assert.equal(isProjectAssetGroupCategory('audio'), true);
    assert.equal(isProjectAssetGroupCategory('img'), true);
    assert.equal(isProjectAssetGroupCategory('bgm'), false);
  });

  test('resolves media kind including casing-sensitive image ids', () => {
    assert.equal(projectAssetMediaKind('svActors'), 'image');
    assert.equal(projectAssetMediaKind('svEnemies'), 'image');
    assert.equal(isProjectAssetImageCategory('svActors'), true);
    assert.equal(isProjectAssetImageCategory('sv_actors'), false);
    assert.equal(projectAssetMediaKind('bgm'), 'audio');
    assert.equal(projectAssetMediaKind('movies'), 'movie');
    assert.equal(projectAssetMediaKind('fonts'), 'font');
    assert.equal(projectAssetMediaKind('effects'), 'effect');
  });

  test('blocks preview for encrypted entries and effects animation', () => {
    assert.equal(projectAssetCanPreview('characters', false), true);
    assert.equal(projectAssetCanPreview('characters', true), false);
    assert.equal(projectAssetCanPreview('fonts', false), true);
    assert.equal(projectAssetCanPreview('fonts', true), false);
    assert.equal(projectAssetCanPreview('effects', false), false);
    assert.equal(projectAssetCanPreview('bgm', false), true);
  });

  test('labels MZ picture subfolders with the disk directory name', () => {
    assert.equal(projectAssetCategoryLabel('pictures/ui', 'zh-CN'), 'ui');
    assert.equal(projectAssetCategoryLabel('pictures/ui/portraits', 'en-US'), 'portraits');
    assert.equal(isProjectAssetImageCategory('pictures/ui'), true);
    assert.equal(projectAssetCategoryLabel('img/custom_ui/hud', 'zh-CN'), 'hud');
    assert.equal(isProjectAssetImageCategory('img/custom_ui/hud'), true);
    assert.equal(isProjectAssetGroupCategory('pictures/ui'), false);
    assert.equal(projectAssetMediaKind('pictures/ui'), 'image');
  });
});
