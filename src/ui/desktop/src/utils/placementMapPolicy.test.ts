/**
 * Run: node --experimental-strip-types --test src/utils/placementMapPolicy.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  canActivatePlacementOnMap,
  formatSuggestedMapHint,
  isSuggestedMapMismatch,
} from './placementMapPolicy.ts';

describe('placementMapPolicy', () => {
  test('canActivatePlacementOnMap requires a positive map id', () => {
    assert.equal(canActivatePlacementOnMap(6), true);
    assert.equal(canActivatePlacementOnMap(null), false);
    assert.equal(canActivatePlacementOnMap(0), false);
  });

  test('isSuggestedMapMismatch is informational only', () => {
    assert.equal(isSuggestedMapMismatch(6, 16), true);
    assert.equal(isSuggestedMapMismatch(6, 6), false);
    assert.equal(isSuggestedMapMismatch(null, 6), false);
    assert.equal(isSuggestedMapMismatch(6, null), false);
  });

  test('formatSuggestedMapHint uses MAP### label', () => {
    assert.equal(formatSuggestedMapHint(6), '建议 MAP006');
  });
});

describe('EditorView cross-map placement guard', () => {
  const source = readFileSync(
    new URL('../views/EditorView.vue', import.meta.url),
    'utf8',
  );

  test('does not block placement when suggested map differs from current map', () => {
    assert.doesNotMatch(source, /请先切换到地图/);
    assert.doesNotMatch(
      source,
      /selected\.targetMapId\s*&&\s*selectedMapId\.value\s*!==\s*selected\.targetMapId/,
    );
  });
});
