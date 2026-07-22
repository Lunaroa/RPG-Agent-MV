import type {
  MapOverviewLayoutWorkerRequest,
  MapOverviewLayoutWorkerResponse,
} from './mapOverviewLayoutWorkerProtocol'
import type { MapOverviewLayoutPositions } from './mapOverviewLayoutModel'

export const MAP_OVERVIEW_LAYOUT_TIMEOUT_MS = 30_000

export type MapOverviewLayoutTaskErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'worker-start'
  | 'worker-error'

export class MapOverviewLayoutTaskError extends Error {
  readonly code: MapOverviewLayoutTaskErrorCode

  constructor(
    code: MapOverviewLayoutTaskErrorCode,
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = code === 'cancelled' ? 'AbortError' : 'MapOverviewLayoutTaskError'
  }
}

export interface MapOverviewLayoutWorkerLike {
  onmessage: ((event: MessageEvent<MapOverviewLayoutWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (message: MapOverviewLayoutWorkerRequest) => void
  terminate: () => void
}

export interface MapOverviewLayoutWorkerRun {
  promise: Promise<MapOverviewLayoutPositions>
  stop: () => void
}

export function createMapOverviewLayoutWorker(): MapOverviewLayoutWorkerLike {
  return new Worker(
    new URL('../workers/mapOverviewLayout.worker.ts', import.meta.url),
    { type: 'module', name: 'map-overview-layout' },
  ) as unknown as MapOverviewLayoutWorkerLike
}

export function runMapOverviewLayoutWorker(
  request: MapOverviewLayoutWorkerRequest,
  options: {
    timeoutMs?: number
    workerFactory?: () => MapOverviewLayoutWorkerLike
  } = {},
): MapOverviewLayoutWorkerRun {
  const timeoutMs = options.timeoutMs ?? MAP_OVERVIEW_LAYOUT_TIMEOUT_MS
  const workerFactory = options.workerFactory ?? createMapOverviewLayoutWorker
  let worker: MapOverviewLayoutWorkerLike | null = null
  let settled = false
  let rejectPromise: ((error: unknown) => void) | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null

  const cleanup = (): void => {
    if (timeout) clearTimeout(timeout)
    timeout = null
    worker?.terminate()
    worker = null
  }
  const fail = (error: unknown): void => {
    if (settled) return
    settled = true
    cleanup()
    rejectPromise?.(error)
  }

  const promise = new Promise<MapOverviewLayoutPositions>((resolve, reject) => {
    rejectPromise = reject
    try {
      worker = workerFactory()
    } catch (error) {
      settled = true
      reject(new MapOverviewLayoutTaskError(
        'worker-start',
        error instanceof Error ? error.message : 'Map overview layout worker could not start.',
      ))
      return
    }

    worker.onmessage = (event) => {
      const response = event.data
      if (settled || response.requestId !== request.requestId) return
      if (response.type === 'error') {
        fail(new MapOverviewLayoutTaskError('worker-error', response.message))
        return
      }
      settled = true
      cleanup()
      resolve(response.positions)
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      fail(new MapOverviewLayoutTaskError(
        'worker-error',
        event.message || 'Map overview layout worker failed.',
      ))
    }
    timeout = setTimeout(() => {
      fail(new MapOverviewLayoutTaskError(
        'timeout',
        `Map overview layout exceeded ${Math.round(timeoutMs / 1000)} seconds.`,
      ))
    }, timeoutMs)
    try {
      worker.postMessage(request)
    } catch (error) {
      fail(new MapOverviewLayoutTaskError(
        'worker-start',
        error instanceof Error ? error.message : 'Map overview layout worker could not receive its request.',
      ))
    }
  })

  return {
    promise,
    stop: () => fail(new MapOverviewLayoutTaskError('cancelled', 'Map overview layout was cancelled.')),
  }
}
