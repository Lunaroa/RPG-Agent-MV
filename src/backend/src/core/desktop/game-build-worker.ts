import { parentPort } from 'node:worker_threads';

import type { GameBuildRequest } from '../../../../contract/game-release.ts';
import { buildGame } from './game-build-service.ts';

interface StartMessage {
  type: 'start';
  workflowRoot: string;
  project: string;
  request: GameBuildRequest;
  cancelBuffer: SharedArrayBuffer;
}

if (!parentPort) throw new Error('The packaging worker requires a parent port.');

let started = false;

parentPort.on('message', (message: StartMessage) => {
  if (started) {
    parentPort!.postMessage({ type: 'error', error: 'The packaging worker already has an active build.' });
    return;
  }
  started = true;
  const cancelState = new Int32Array(message.cancelBuffer);
  void buildGame(message.workflowRoot, message.project, message.request, {
    isCanceled: () => Atomics.load(cancelState, 0) === 1,
    reportProgress: (event) => parentPort!.postMessage({ type: 'progress', event }),
  }).then(
    (result) => parentPort!.postMessage({ type: 'result', result }),
    (error) => parentPort!.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});
