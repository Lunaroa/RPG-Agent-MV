import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./useMapCanvasEditor.ts', import.meta.url), 'utf8');

describe('map canvas live paint wiring', () => {
  test('renders the first pencil cell synchronously and batches the release into one commit', () => {
    assert.match(source, /beginStroke\(cell\);[\s\S]{0,360}applyPreviewEdits\(rectangularBrushPathEdits\(\[cell\], cell\), true\)/);
    assert.match(source, /else applyToolAt\(cell\.x, cell\.y, true\)/);
    assert.match(source, /const edits = \[\.\.\.strokeEdits\.values\(\)\];[\s\S]{0,180}await commitEdits\(edits, rollback\)/);
  });

  test('uses affected-neighbour shared rules without collecting a whole-map diff during pointer movement', () => {
    assert.match(source, /autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION/);
    assert.match(source, /mutate: true/);
    assert.match(source, /collectChanges: false/);
    assert.match(source, /scheduleMapRender\(\)/);
    assert.match(source, /rasterMapCellLine\(lastStrokeCell \|\| cell, cell\)/);
  });

  test('rebuilds live shapes from the stroke snapshot and restores cancellation safely', () => {
    assert.match(source, /for \(const index of shapePreviewTouched\) map\.data\[index\] = strokeSnapshot\[index\]/);
    assert.match(source, /if \(map && strokeSnapshot\) map\.data = strokeSnapshot/);
    assert.match(source, /event\.key === 'Escape' && \(painting \|\| eyedropStart\)/);
    assert.match(source, /window\.addEventListener\('blur', cancelPointerPreviews\)/);
  });

  test('treats shadow as an independent pen and returns normal tools to tile painting', () => {
    assert.match(source, /function selectMapTool\(nextTool: MapTool\) \{[\s\S]{0,420}options\.paintMode\.value = 'tile';[\s\S]{0,260}options\.tool\.value = nextTool;/);
    assert.match(source, /function selectTileMode\(\) \{[\s\S]{0,260}options\.paintMode\.value = 'tile';/);
    assert.match(source, /function selectShadowMode\(\) \{[\s\S]{0,260}options\.paintMode\.value = 'shadow';/);
    assert.doesNotMatch(source, /function selectShadowMode\(\) \{[\s\S]{0,260}options\.tool\.value/);
    assert.match(source, /if \(options\.paintMode\.value === 'shadow'\) \{[\s\S]{0,220}beginShadowStroke\(shadowQuarter\);[\s\S]{0,160}shadowQuarterEdits\(\[shadowQuarter\]\)/);
    assert.match(source, /rasterShadowQuarterLine\([\s\S]{0,220}shadowQuarterEdits\(points\)/);
    assert.match(source, /if \(options\.paintMode\.value === 'shadow'\) return \[\];/);
  });

  test('renders only the hovered shadow quarter with a white high-contrast frame', () => {
    assert.match(source, /paintMode\.value === 'shadow' && shadowHoverQuarter[\s\S]{0,120}drawShadowQuarterFrame\(context, shadowHoverQuarter\)/);
    assert.match(source, /function drawShadowQuarterFrame[\s\S]{0,360}const size = tileSize\.value \/ 2/);
    assert.match(source, /strokeStyle = 'rgba\(255, 255, 255, \.99\)'/);
    assert.doesNotMatch(source, /function drawShadowQuarterFrame[\s\S]{0,500}fillRect/);
  });

  test('shows one continuous right-drag selection and one complete rectangle brush frame', () => {
    assert.match(source, /if \(eyedropStart\) \{\s*drawContinuousRectFrame\(context, normalizeInclusiveCellRect\(eyedropStart, eyedropEnd \|\| eyedropStart\)\);\s*return;/);
    assert.match(source, /if \(options\.mode\.value === 'map' && rectangularBrush\(\)[\s\S]{0,220}drawContinuousRectFrame\(context, brushRectAt\(hoverCell, activeBrushFootprint\(\)\)\)/);
    assert.doesNotMatch(source, /if \(eyedropStart\)[\s\S]{0,260}for \(const cell of cells\)/);
  });

  test('uses the same hotspot geometry for stamping and patterned shape previews', () => {
    assert.match(source, /const origin = brushOriginAt\(\{ x, y \}, activeBrushFootprint\(\)\)/);
    assert.match(source, /brushPathPatternPlacements\(pointers, anchor, footprint, map \? \{ width: map\.width, height: map\.height \} : undefined\)/);
    assert.match(source, /const placements = patternPlacements\(from, to, footprint, shape\)/);
    assert.match(source, /sourceCells\.get\(`\$\{placement\.sourceDx\},\$\{placement\.sourceDy\}`\)/);
    assert.match(source, /applyPreviewEdits\(shapePatternEdits\(dragStart, end\), immediate, true\)/);
  });

  test('cancels unfinished copy selection without replacing the previous brush', () => {
    assert.match(source, /event\.key === 'Escape' && \(painting \|\| eyedropStart\)/);
    assert.match(source, /function cancelMapRangeSelection\(render = true\) \{[\s\S]{0,220}eyedropStart = null;[\s\S]{0,120}eyedropEnd = null;/);
    assert.doesNotMatch(source, /function cancelMapRangeSelection\([\s\S]{0,260}brush = null/);
  });
});
