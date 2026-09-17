import assert from 'node:assert/strict';
import test from 'node:test';

import { GameBuildProcessCanceledError, runGameBuildProcess } from './game-build-process-service.ts';

test('captures a bounded build process result', async () => {
  const result = await runGameBuildProcess(process.execPath, ['-e', "process.stdout.write('ready')"], {
    maxBuffer: 1024,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.equal(result.stderr, '');
});

test('terminates a running build process when cancellation is requested', async () => {
  let canceled = false;
  const timer = setTimeout(() => { canceled = true; }, 50);
  try {
    await assert.rejects(
      runGameBuildProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        maxBuffer: 1024,
        isCanceled: () => canceled,
      }),
      GameBuildProcessCanceledError,
    );
  } finally {
    clearTimeout(timer);
  }
});
