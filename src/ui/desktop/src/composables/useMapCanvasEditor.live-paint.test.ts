import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./useMapCanvasEditor.ts', import.meta.url), 'utf8');

describe('map canvas live paint wiring', () => {
  test('renders the first pencil cell synchronously and batches the release into one commit', () => {
    assert.match(source, /beginStroke\(cell\);[\s\S]{0,220}applyToolAt\(cell\.x, cell\.y, event, true\)/);
    assert.match(source, /const edits = \[\.\.\.strokeEdits\.values\(\)\];[\s\S]{0,180}await commitEdits\(edits, rollback\)/);
  });

  test('uses affected-neighbour shared rules without collecting a whole-map diff during pointer movement', () => {
    assert.match(source, /applyRmmvMapBrushEdits\(map, accepted, \{[\s\S]*autotileResolution: 'affected'/);
    assert.match(source, /mutate: true/);
    assert.match(source, /collectChanges: false/);
    assert.match(source, /scheduleMapRender\(\)/);
    assert.match(source, /rasterLineCells\(lastStrokeCell \|\| cell, cell\)/);
  });

  test('rebuilds live shapes from the stroke snapshot and restores cancellation safely', () => {
    assert.match(source, /for \(const index of shapePreviewTouched\) map\.data\[index\] = strokeSnapshot\[index\]/);
    assert.match(source, /if \(map && strokeSnapshot\) map\.data = strokeSnapshot/);
    assert.match(source, /event\.key === 'Escape' && painting/);
    assert.match(source, /window\.addEventListener\('blur', cancelStrokePreview\)/);
  });
});
