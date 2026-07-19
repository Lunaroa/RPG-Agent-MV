import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { PRODUCT_WINDOW_TITLE, projectWindowTitle } from './projectWindowTitle.ts';

describe('desktop project window title', () => {
  test('uses the product title when no project is selected', () => {
    assert.equal(projectWindowTitle(null), PRODUCT_WINDOW_TITLE);
    assert.equal(projectWindowTitle(undefined), PRODUCT_WINDOW_TITLE);
    assert.equal(projectWindowTitle('   '), PRODUCT_WINDOW_TITLE);
  });

  test('combines the selected project name with the product title', () => {
    assert.equal(projectWindowTitle('Sample Project'), 'Sample Project - RPG Agent MV');
    assert.equal(projectWindowTitle('  Example Game  '), 'Example Game - RPG Agent MV');
  });

  test('wires the current project identity to the document title', () => {
    const appSource = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8');
    assert.match(appSource, /watch\(\s*\(\) => projectStore\.currentProjectInfo\?\.name/);
    assert.match(appSource, /document\.title = projectWindowTitle\(projectName\)/);
  });
});
