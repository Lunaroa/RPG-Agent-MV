import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  canvasClientDeltaToLogical,
  canvasClientToLogicalPoint,
  clampScreenCoordinate,
  pictureBlendOperation,
  screenPictureDrawState,
  type ScreenPicturePreview,
} from './pictureCoordinatePreview';

const preview: ScreenPicturePreview = {
  assetName: 'SamplePicture',
  assetUrl: 'asset://pictures/SamplePicture.png',
  origin: 1,
  scaleX: 150,
  scaleY: -50,
  opacity: 128,
  blendMode: 2,
};

describe('show-picture coordinate preview', () => {
  test('converts CSS-scaled canvas coordinates and clamps screen anchors', () => {
    assert.deepEqual(canvasClientToLogicalPoint(120, 80, { left: 20, top: 20, width: 408, height: 312 }, 816, 624), {
      x: 200,
      y: 120,
    });
    assert.deepEqual(canvasClientDeltaToLogical(10, -12, { width: 408, height: 312 }, 816, 624), {
      x: 20,
      y: -24,
    });
    assert.equal(clampScreenCoordinate(-12000), -9999);
    assert.equal(clampScreenCoordinate(12000), 9999);
    assert.equal(clampScreenCoordinate(12.9), 12);
  });

  test('uses RM origin, scale, opacity, and blend semantics', () => {
    assert.deepEqual(screenPictureDrawState(preview, 320, 240), {
      originX: -160,
      originY: -120,
      scaleX: 1.5,
      scaleY: -0.5,
      alpha: 128 / 255,
      operation: 'multiply',
    });
    assert.equal(pictureBlendOperation(0), 'source-over');
    assert.equal(pictureBlendOperation(1), 'lighter');
    assert.equal(pictureBlendOperation(3), 'screen');
  });

  test('keeps preview integration exclusive to Show Picture', () => {
    const fieldsSource = readFileSync(new URL('../components/editor/EventCommandFields.vue', import.meta.url), 'utf8');
    assert.match(fieldsSource, /props\.command\.code !== 231/);
    assert.match(fieldsSource, /picture:\s*screenPicturePreview\(\)/);
    assert.doesNotMatch(fieldsSource, /props\.command\.code === 232[^\n]+screenPicturePreview/);
  });

  test('coalesces picture dragging through one RAF and caches the screen grid', () => {
    const pickerSource = readFileSync(new URL('../components/editor/CoordinatePickerDialog.vue', import.meta.url), 'utf8');
    assert.match(pickerSource, /latestClientX/);
    assert.match(pickerSource, /latestClientY/);
    assert.match(pickerSource, /if \(pictureDragFrame !== null\) return/);
    assert.match(pickerSource, /pictureDragFrame = requestAnimationFrame\(flushPictureDrag\)/);
    assert.match(pickerSource, /cancelAnimationFrame\(pictureDragFrame\)/);
    assert.match(pickerSource, /screenGridCanvas/);
    assert.match(pickerSource, /picturePreview\.value/);
    assert.match(pickerSource, /if \(mode\.value === 'map'\)/);
    assert.match(pickerSource, /if \(!picturePreview\.value\) return/);
    assert.doesNotMatch(pickerSource, /function onStagePointerMove[\s\S]*?loadScreenPicture\(\)/);
  });
});
