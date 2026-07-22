const MAX_BYTES = 256 * 1024 * 1024

export interface DecodedChunkEntry {
  key: string
  bytes: number
  bitmap: ImageBitmap | HTMLCanvasElement | null
}

/** Bounded LRU for decoded overview chunks (renderer-side). */
export class MapOverviewDecodedChunkCache {
  private readonly order: string[] = []
  private readonly entries = new Map<string, DecodedChunkEntry>()
  private totalBytes = 0

  constructor(private readonly maxBytes = MAX_BYTES) {}

  get(key: string): DecodedChunkEntry | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    const index = this.order.indexOf(key)
    if (index >= 0) {
      this.order.splice(index, 1)
      this.order.push(key)
    }
    return entry
  }

  set(entry: DecodedChunkEntry): void {
    this.delete(entry.key)
    this.entries.set(entry.key, entry)
    this.order.push(entry.key)
    this.totalBytes += Math.max(0, entry.bytes)
    this.evict()
  }

  delete(key: string): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.delete(key)
    const index = this.order.indexOf(key)
    if (index >= 0) this.order.splice(index, 1)
    this.totalBytes -= Math.max(0, existing.bytes)
    if (existing.bitmap && 'close' in existing.bitmap && typeof existing.bitmap.close === 'function') {
      existing.bitmap.close()
    }
  }

  unloadKeys(keys: Iterable<string>): void {
    for (const key of keys) this.delete(key)
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key)
  }

  get sizeBytes(): number {
    return this.totalBytes
  }

  private evict(): void {
    while (this.totalBytes > this.maxBytes && this.order.length) {
      const oldest = this.order[0]
      this.delete(oldest)
    }
  }
}
