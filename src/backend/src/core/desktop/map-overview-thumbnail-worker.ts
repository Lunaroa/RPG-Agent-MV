import { parentPort } from 'node:worker_threads';

import { closeDatabase, configureDatabase, getConfiguredDatabasePath } from '../db/pool.ts';
import {
  buildMapOverviewThumbnail,
  type MapOverviewThumbnailWorkerRequest,
  type MapOverviewThumbnailWorkerResponse,
} from './map-overview-service.ts';

if (!parentPort) throw new Error('Map overview thumbnail worker requires a parent port.');

parentPort.on('message', (request: MapOverviewThumbnailWorkerRequest) => {
  try {
    if (getConfiguredDatabasePath() !== request.databasePath) {
      closeDatabase();
      configureDatabase({ path: request.databasePath });
    }
    const thumbnail = buildMapOverviewThumbnail(
      request.workflowRoot,
      request.project,
      request.mapId,
      request.expectedVersion,
      request.quality,
    );
    parentPort!.postMessage({ requestId: request.requestId, ok: true, thumbnail } satisfies MapOverviewThumbnailWorkerResponse);
  } catch (error) {
    parentPort!.postMessage({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MapOverviewThumbnailWorkerResponse);
  } finally {
    closeDatabase();
  }
});

process.once('exit', () => closeDatabase());
