import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProjectAssetImportItemResult } from '@contract/types';
import {
  applyOverwriteBatchDecision,
  assertImportBatchResultShape,
  formatImportResultMessage,
  planDroppedImportItems,
} from './projectAssetImportFlow.ts';

const copy = {
  allImportedOne: 'Imported 1 file.',
  allImportedMany: (imported: number) => `Imported ${imported} files.`,
  mixed: (imported: number, skipped: number, failed: number) =>
    `Imported ${imported}. Skipped ${skipped}. Rejected ${failed}.`,
  skippedItem: (name: string, reason: string) => `${name}: skipped — ${reason}`,
  failedItem: (name: string, reason: string) => `${name}: ${reason}`,
  unknownReason: 'No reason provided',
};

describe('projectAssetImportFlow', () => {
  test('planDroppedImportItems keeps resolved files and rejects directories and unresolved paths', () => {
    const plan = planDroppedImportItems([
      { isDirectory: false, name: 'A.png', absolutePath: 'C:\\tmp\\A.png' },
      { isDirectory: true, name: 'MyFolder', absolutePath: 'C:\\tmp\\MyFolder' },
      { isDirectory: false, name: 'B.png', absolutePath: null },
      { isDirectory: false, name: 'C.png', absolutePath: 'C:\\tmp\\C.png' },
    ]);
    assert.deepEqual(plan.sourceFiles, ['C:\\tmp\\A.png', 'C:\\tmp\\C.png']);
    assert.deepEqual(plan.rejections, [
      { name: 'MyFolder', reason: 'directory' },
      { name: 'B.png', reason: 'path_unresolved' },
    ]);
  });

  test('applyOverwriteBatchDecision overwrite marks only conflicts', () => {
    const applied = applyOverwriteBatchDecision(
      [
        { sourceFile: '/a/Hero.png', name: 'Hero', overwrite: false },
        { sourceFile: '/a/New.png', name: 'New', overwrite: false },
      ],
      new Set(['Hero']),
      'overwrite',
    );
    assert.equal(applied.outcome, 'proceed');
    assert.deepEqual(applied.candidates, [
      { sourceFile: '/a/Hero.png', name: 'Hero', overwrite: true },
      { sourceFile: '/a/New.png', name: 'New', overwrite: false },
    ]);
    assert.deepEqual(applied.skipped, []);
  });

  test('applyOverwriteBatchDecision skip removes conflicts and lists them', () => {
    const applied = applyOverwriteBatchDecision(
      [
        { sourceFile: '/a/Hero.png', name: 'Hero', overwrite: false },
        { sourceFile: '/a/New.png', name: 'New', overwrite: false },
        { sourceFile: '/a/Actor1.png', name: 'Actor1', overwrite: false },
      ],
      new Set(['Hero', 'Actor1']),
      'skip',
    );
    assert.equal(applied.outcome, 'proceed');
    assert.deepEqual(applied.candidates, [
      { sourceFile: '/a/New.png', name: 'New', overwrite: false },
    ]);
    assert.deepEqual(applied.skipped, [
      { sourceFile: '/a/Hero.png', name: 'Hero' },
      { sourceFile: '/a/Actor1.png', name: 'Actor1' },
    ]);
  });

  test('applyOverwriteBatchDecision cancel aborts without mutating intent', () => {
    const applied = applyOverwriteBatchDecision(
      [{ sourceFile: '/a/Hero.png', name: 'Hero', overwrite: false }],
      new Set(['Hero']),
      'cancel',
    );
    assert.equal(applied.outcome, 'cancel');
    assert.equal(applied.candidates.length, 1);
    assert.equal(applied.skipped.length, 0);
  });

  test('formatImportResultMessage all-success uses singular and plural copy', () => {
    const one: ProjectAssetImportItemResult[] = [{
      sourceFile: '/a/A.png',
      targetName: 'A',
      relativePath: 'img/faces/A.png',
      status: 'imported',
    }];
    assert.equal(formatImportResultMessage(one, copy), 'Imported 1 file.');
    const many: ProjectAssetImportItemResult[] = [
      { sourceFile: '/a/A.png', targetName: 'A', relativePath: 'img/faces/A.png', status: 'imported' },
      { sourceFile: '/a/B.png', targetName: 'B', relativePath: 'img/faces/B.png', status: 'imported' },
    ];
    assert.equal(formatImportResultMessage(many, copy), 'Imported 2 files.');
  });

  test('formatImportResultMessage mixed lists skip and fail reasons without inventing defaults for present errors', () => {
    const results: ProjectAssetImportItemResult[] = [
      { sourceFile: '/a/Ok.png', targetName: 'Ok', relativePath: 'img/faces/Ok.png', status: 'imported' },
      {
        sourceFile: '/a/Hero.png',
        targetName: 'Hero',
        relativePath: null,
        status: 'skipped',
        error: 'Same name; skipped by your choice',
      },
      {
        sourceFile: '/a/notes.txt',
        targetName: 'notes.txt',
        relativePath: null,
        status: 'failed',
        error: 'Faces does not support .txt files (allowed: .png)',
      },
    ];
    const text = formatImportResultMessage(results, copy);
    assert.match(text, /^Imported 1\. Skipped 1\. Rejected 1\./);
    assert.match(text, /Hero: skipped — Same name; skipped by your choice/);
    assert.match(text, /notes\.txt: Faces does not support \.txt files/);
    assert.doesNotMatch(text, /overwriteConfirm|是否/);
  });

  test('assertImportBatchResultShape fail-fast on missing or wrong-length results', () => {
    assert.throws(() => assertImportBatchResultShape(null, 1), /missing results/);
    assert.throws(() => assertImportBatchResultShape({ results: {} }, 1), /must be an array/);
    assert.throws(() => assertImportBatchResultShape({ results: [] }, 2), /count mismatch/);
    assert.doesNotThrow(() => assertImportBatchResultShape({
      results: [{
        sourceFile: '/a.png',
        targetName: 'a',
        relativePath: null,
        status: 'failed',
        error: 'x',
      }],
    }, 1));
  });
});
