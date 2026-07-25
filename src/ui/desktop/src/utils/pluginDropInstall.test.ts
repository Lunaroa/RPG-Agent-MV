import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isExternalFileDrag, planDroppedPluginFiles } from './pluginDropInstall.ts';

describe('pluginDropInstall', () => {
  test('accepts only resolvable .js files and rejects folders and other types', () => {
    const plan = planDroppedPluginFiles([
      { name: 'Foo.js', isDirectory: false, absolutePath: 'C:/plugins/Foo.js' },
      { name: 'Bar.JS', isDirectory: false, absolutePath: 'C:/plugins/Bar.JS' },
      { name: 'notes.txt', isDirectory: false, absolutePath: 'C:/plugins/notes.txt' },
      { name: 'pack', isDirectory: true, absolutePath: null },
      { name: 'Missing.js', isDirectory: false, absolutePath: null },
    ]);
    assert.deepEqual(plan.sourceFiles, ['C:/plugins/Foo.js', 'C:/plugins/Bar.JS']);
    assert.deepEqual(plan.rejections, [
      { name: 'notes.txt', reason: 'not-js' },
      { name: 'pack', reason: 'directory' },
      { name: 'Missing.js', reason: 'path-unresolved' },
    ]);
  });

  test('detects OS file drags from dataTransfer types', () => {
    assert.equal(isExternalFileDrag({ dataTransfer: { types: ['Files'] } as DataTransfer }), true);
    assert.equal(isExternalFileDrag({ dataTransfer: { types: ['text/plain'] } as DataTransfer }), false);
    assert.equal(isExternalFileDrag({ dataTransfer: null }), false);
  });
});
