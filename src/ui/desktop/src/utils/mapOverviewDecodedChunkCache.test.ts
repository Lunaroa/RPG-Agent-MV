import { describe, expect, it, vi } from 'vitest'

import { MapOverviewDecodedChunkCache } from './mapOverviewDecodedChunkCache'

describe('MapOverviewDecodedChunkCache', () => {
  it('evicts least-recently-used entries when the 256MB budget is exceeded', () => {
    const cache = new MapOverviewDecodedChunkCache(100)
    const closeA = vi.fn()
    const closeB = vi.fn()
    const closeC = vi.fn()

    cache.set({ key: 'a', bytes: 40, bitmap: { close: closeA } as unknown as ImageBitmap })
    cache.set({ key: 'b', bytes: 40, bitmap: { close: closeB } as unknown as ImageBitmap })
    expect(cache.sizeBytes).toBe(80)

    cache.get('a')
    cache.set({ key: 'c', bytes: 40, bitmap: { close: closeC } as unknown as ImageBitmap })

    expect(cache.get('b')).toBeNull()
    expect(closeB).toHaveBeenCalledTimes(1)
    expect(cache.get('a')).not.toBeNull()
    expect(cache.get('c')).not.toBeNull()
    expect(cache.sizeBytes).toBe(80)
    expect(closeA).not.toHaveBeenCalled()
    expect(closeC).not.toHaveBeenCalled()
  })

  it('unloadKeys closes bitmaps and frees budget', () => {
    const cache = new MapOverviewDecodedChunkCache(256 * 1024 * 1024)
    const close = vi.fn()
    cache.set({ key: 'chunk-1', bytes: 1024, bitmap: { close } as unknown as ImageBitmap })
    cache.unloadKeys(['chunk-1', 'missing'])
    expect(cache.get('chunk-1')).toBeNull()
    expect(cache.sizeBytes).toBe(0)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
