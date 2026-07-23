import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MapOverviewLayoutTaskError,
  runMapOverviewLayoutWorker,
  type MapOverviewLayoutWorkerLike,
} from './mapOverviewLayoutWorkerClient'
import type {
  MapOverviewLayoutWorkerRequest,
  MapOverviewLayoutWorkerResponse,
} from './mapOverviewLayoutWorkerProtocol'

class FakeWorker implements MapOverviewLayoutWorkerLike {
  onmessage: ((event: MessageEvent<MapOverviewLayoutWorkerResponse>) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: MapOverviewLayoutWorkerRequest[] = []
  terminate = vi.fn()

  postMessage(message: MapOverviewLayoutWorkerRequest): void {
    this.posted.push(message)
  }

  respond(response: MapOverviewLayoutWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<MapOverviewLayoutWorkerResponse>)
  }

  respondWithUnreadableMessage(): void {
    this.onmessageerror?.({ data: null } as MessageEvent<unknown>)
  }
}

const request: MapOverviewLayoutWorkerRequest = {
  requestId: 'layout-1',
  layoutId: 'grid',
  nodes: [],
  edges: [],
  parameters: { columns: null, nodeSpacing: 24 },
}

afterEach(() => {
  vi.useRealTimers()
})
describe('map overview layout worker client', () => {
  it('resolves only the matching request and terminates the worker', async () => {
    const worker = new FakeWorker()
    const run = runMapOverviewLayoutWorker(request, { workerFactory: () => worker })

    worker.respond({ type: 'complete', requestId: 'stale', positions: { stale: { x: 1, y: 2 } } })
    worker.respond({ type: 'complete', requestId: request.requestId, positions: { '1': { x: 3, y: 4 } } })

    await expect(run.promise).resolves.toEqual({ '1': { x: 3, y: 4 } })
    expect(worker.posted).toEqual([request])
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('hard-cancels the worker and rejects as AbortError', async () => {
    const worker = new FakeWorker()
    const run = runMapOverviewLayoutWorker(request, { workerFactory: () => worker })

    run.stop()

    await expect(run.promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'cancelled',
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates a worker that exceeds the configured deadline', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const run = runMapOverviewLayoutWorker(request, {
      workerFactory: () => worker,
      timeoutMs: 50,
    })
    const assertion = expect(run.promise).rejects.toMatchObject({ code: 'timeout' })

    await vi.advanceTimersByTimeAsync(50)

    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('does not replace worker startup failures with a main-thread layout', async () => {
    const run = runMapOverviewLayoutWorker(request, {
      workerFactory: () => { throw new Error('worker unavailable') },
    })

    await expect(run.promise).rejects.toEqual(expect.objectContaining({
      code: 'worker-start',
      message: 'worker unavailable',
    } satisfies Partial<MapOverviewLayoutTaskError>))
  })

  it('terminates when a worker response cannot be decoded', async () => {
    const worker = new FakeWorker()
    const run = runMapOverviewLayoutWorker(request, { workerFactory: () => worker })

    worker.respondWithUnreadableMessage()

    await expect(run.promise).rejects.toMatchObject({ code: 'worker-error' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
