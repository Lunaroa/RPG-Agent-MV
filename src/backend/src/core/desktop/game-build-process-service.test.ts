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

test('tool installation streams Unicode output and writes license input', async () => {
  const output: string[] = [];
  const result = await runGameBuildProcess(process.execPath, ['-e', 'process.stdin.setEncoding("utf8");process.stdin.on("data", value => process.stdout.write("测试:" + value))'], {
    maxBuffer: 1024, input: 'yes\n', onOutput: chunk => output.push(chunk), timeoutMs: 2000,
  });
  assert.equal(result.status, 0);
  assert.equal(output.join(''), '测试:yes\n');
});

test('tool installation times out a stuck external process', async () => {
  await assert.rejects(runGameBuildProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    maxBuffer: 1024, timeoutMs: 100,
  }), /timed out/);
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
