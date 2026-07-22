import { describe, expect, it } from 'vitest'

import type { MapOverviewPngExportStatus } from '@contract/types'
import { formatMapOverviewExportError } from './mapOverviewExportError'

describe('map overview export errors', () => {
  it('uses stable localized error categories instead of native messages', () => {
    const status = makeStatus({ errorCode: 'native-runtime', error: 'ERR_DLOPEN_FAILED: internal details' })
    const message = formatMapOverviewExportError(status, (key) => key)
    expect(message).toBe('mapOverview.export.error.nativeRuntime')
    expect(message).not.toContain('ERR_DLOPEN_FAILED')
  })

  it('keeps actual dimensions in the localized size-limit message', () => {
    const status = makeStatus({ errorCode: 'size-limit', width: 33_000, height: 20_000 })
    expect(formatMapOverviewExportError(status, (key, params) => `${key}:${params?.width}x${params?.height}`))
      .toBe('mapOverview.export.error.sizeLimit:33000x20000')
  })
})

function makeStatus(patch: Partial<MapOverviewPngExportStatus>): MapOverviewPngExportStatus {
  return {
    requestId: 'request-1',
    project: 'sample',
    phase: 'failed',
    width: null,
    height: null,
    completed: 0,
    total: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    outputPath: null,
    error: null,
    errorCode: 'export-failed',
    canceled: false,
    ...patch,
  }
}
