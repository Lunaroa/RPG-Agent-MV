import type {
  MapOverviewPngExportScene,
  MapOverviewPngExportStatus,
} from '@contract/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { maps } from '../api/client'

export const useMapOverviewExportStore = defineStore('mapOverviewExport', () => {
  const status = ref<MapOverviewPngExportStatus | null>(null)
  const initialized = ref(false)
  const elapsedSeconds = ref(0)
  let removeListener: (() => void) | null = null
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  const running = computed(() => Boolean(status.value && ['preflight', 'rendering', 'encoding'].includes(status.value.phase)))

  async function initialize(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    removeListener = maps.onOverviewPngExportProgress((next) => {
      if (status.value && status.value.requestId !== next.requestId && running.value) return
      status.value = next
      updateElapsed()
    })
    status.value = await maps.overviewPngExportStatus()
    updateElapsed()
    elapsedTimer = setInterval(updateElapsed, 1_000)
  }

  async function start(scene: MapOverviewPngExportScene): Promise<boolean> {
    await initialize()
    const result = await maps.startOverviewPngExport(scene)
    if (result.canceled || !result.status) return false
    status.value = result.status
    updateElapsed()
    return true
  }

  async function cancel(): Promise<void> {
    if (!status.value || !running.value) return
    status.value = await maps.cancelOverviewPngExport(status.value.requestId)
    updateElapsed()
  }

  async function reveal(): Promise<void> {
    if (!status.value || status.value.phase !== 'completed') return
    await maps.revealOverviewPngExport(status.value.requestId)
  }

  function dispose(): void {
    removeListener?.()
    removeListener = null
    initialized.value = false
    if (elapsedTimer) clearInterval(elapsedTimer)
    elapsedTimer = null
  }

  function updateElapsed(): void {
    const startedAt = status.value?.startedAt ? Date.parse(status.value.startedAt) : Number.NaN
    elapsedSeconds.value = Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 1_000))
      : 0
  }

  return { status, initialized, running, elapsedSeconds, initialize, start, cancel, reveal, dispose }
})
