/**
 * Run: node --test src/composables/usePlacementAtCell.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./usePlacementAtCell.ts', import.meta.url), 'utf8');

describe('placeContractAtCell source guard', () => {
  test('passes the selected project when creating a placement event', () => {
    assert.match(source, /const project = projectStore\.currentProject;/);
    assert.match(
      source,
      /if \(!project\) throw new Error\(translate\('placement\.atCell\.selectProjectFirst', language\)\)/,
    );
    assert.match(
      source,
      /eventsApi\.createFromPlacement\([\s\S]*?\}, project\)/,
    );
    assert.doesNotMatch(source, /ensureVersionManagementForPlacement/);
    assert.doesNotMatch(source, /ElMessageBox/);
  });

  test('localizes placement cell hints', () => {
    assert.match(
      source,
      /placementCellHint\(cell: \{ x: number; y: number \} \| null, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE\)/,
    );
    assert.match(source, /return translate\('placement\.atCell\.hoverFirst', language\)/);
    assert.match(source, /return translate\('placement\.atCell\.createAt', language, \{ x: cell\.x, y: cell\.y \}\)/);
  });
});
