import { parentPort } from 'node:worker_threads';

import { closeDatabase, configureDatabase, getConfiguredDatabasePath } from '../db/pool.ts';
import {
  buildMapOverviewChunk,
  type MapOverviewChunkWorkerRequest,
  type MapOverviewChunkWorkerResponse,
} from './map-overview-service.ts';

if (!parentPort) throw new Error('Map overview chunk worker requires a parent port.');

parentPort.on('message', (request: MapOverviewChunkWorkerRequest) => {
  try {
    if (getConfiguredDatabasePath() !== request.databasePath) {
      closeDatabase();
      configureDatabase({ path: request.databasePath });
    }
    const chunk = buildMapOverviewChunk(
      request.workflowRoot,
      request.project,
      request.mapId,
      request.contentVersion,
      request.chunkX,
      request.chunkY,
      request.level,
    );
    parentPort!.postMessage({ requestId: request.requestId, ok: true, chunk } satisfies MapOverviewChunkWorkerResponse);
  } catch (error) {
    parentPort!.postMessage({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MapOverviewChunkWorkerResponse);
  } finally {
    closeDatabase();
  }
});

process.once('exit', () => closeDatabase());
