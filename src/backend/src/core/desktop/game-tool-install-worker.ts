import { parentPort } from 'node:worker_threads';
import { installAndroidToolchain } from './game-android-toolchain-service.ts';
import { installMediaTools } from './game-media-tools-service.ts';
import { GameBuildProcessCanceledError } from './game-build-process-service.ts';
import type { GameToolInstallContext } from './game-tool-install-context.ts';

if (!parentPort) throw new Error('Tool installation requires a worker parent.');
parentPort.once('message', async ({ workflowRoot, kind, request, cancelBuffer }) => {
  const canceled = new Int32Array(cancelBuffer);
  let lastProgress = 0;
  let previousStep = '';
  const context: GameToolInstallContext = {
    isCanceled: () => Atomics.load(canceled, 0) === 1,
    reportProgress: event => {
      if (Atomics.load(canceled, 0) === 1) throw new GameBuildProcessCanceledError();
      const step = `${event.stage}:${event.component || ''}`;
      if (step !== previousStep || Date.now() - lastProgress >= 200 || (event.total && event.received === event.total)) {
        lastProgress = Date.now();
        previousStep = step;
        parentPort!.postMessage({ type: 'progress', event });
      }
    },
  };
  try {
    let result: unknown;
    if (kind === 'android') result = await installAndroidToolchain(workflowRoot, request, context);
    else { await installMediaTools(workflowRoot, request.acceptLicense, context); result = { configured: true }; }
    parentPort!.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort!.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
});
