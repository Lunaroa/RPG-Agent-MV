import type { MapOverviewPngExportStatus } from '@contract/types'

type Translate = (key: string, params?: Record<string, unknown>) => string

export function formatMapOverviewExportError(
  status: MapOverviewPngExportStatus,
  translate: Translate,
): string {
  switch (status.errorCode) {
    case 'size-limit':
      return translate('mapOverview.export.error.sizeLimit', {
        width: status.width ?? '?',
        height: status.height ?? '?',
      })
    case 'disk-space': return translate('mapOverview.export.error.diskSpace')
    case 'cache-changed': return translate('mapOverview.export.error.cacheChanged')
    case 'native-runtime': return translate('mapOverview.export.error.nativeRuntime')
    case 'invalid-scene': return translate('mapOverview.export.error.invalidScene')
    default:
      return translate('mapOverview.export.failed', {
        message: status.error || translate('mapOverview.export.failedUnknown'),
      })
  }
}
