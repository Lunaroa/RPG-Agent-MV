/**
 * Lazy audio-duration probing for the project-asset explorer.
 * Durations load metadata-only through a detached <audio> element, are cached
 * per URL for the app lifetime, and run through a small concurrency gate so a
 * long list never floods the asset protocol.
 */

const durationCache = new Map<string, number>()
const pendingLoads = new Map<string, Promise<number>>()

const MAX_CONCURRENT_LOADS = 4
let activeLoads = 0
const queuedStarts: Array<() => void> = []

function acquireLoadSlot(): Promise<void> {
  if (activeLoads < MAX_CONCURRENT_LOADS) {
    activeLoads += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    queuedStarts.push(() => {
      activeLoads += 1
      resolve()
    })
  })
}

function releaseLoadSlot(): void {
  activeLoads -= 1
  const next = queuedStarts.shift()
  if (next) next()
}

function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const element = document.createElement('audio')
    element.preload = 'metadata'
    let settled = false
    const settle = (value: number) => {
      if (settled) return
      settled = true
      element.onloadedmetadata = null
      element.onerror = null
      element.removeAttribute('src')
      element.load()
      resolve(value)
    }
    element.onloadedmetadata = () => {
      const seconds = element.duration
      settle(Number.isFinite(seconds) && seconds > 0 ? seconds : Number.NaN)
    }
    element.onerror = () => settle(Number.NaN)
    element.src = url
  })
}

/** Cached duration in seconds; NaN = probed but unreadable; undefined = not probed yet. */
export function getCachedProjectAssetAudioDuration(url: string): number | undefined {
  return durationCache.get(url)
}

/** Probe (or reuse) the duration for one URL. Never rejects; failures cache as NaN. */
export function loadProjectAssetAudioDuration(url: string): Promise<number> {
  const cached = durationCache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = pendingLoads.get(url)
  if (pending) return pending
  const load = (async () => {
    await acquireLoadSlot()
    try {
      const seconds = await probeAudioDuration(url)
      durationCache.set(url, seconds)
      return seconds
    } finally {
      releaseLoadSlot()
      pendingLoads.delete(url)
    }
  })()
  pendingLoads.set(url, load)
  return load
}
