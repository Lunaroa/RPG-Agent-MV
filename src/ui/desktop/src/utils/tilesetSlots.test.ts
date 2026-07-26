import { describe, expect, it } from 'vitest'

import {
  MV_TILESET_SLOT_COUNT,
  canAppendTilesetSlot,
  tilesetSlotCount,
  tilesetSlotLabel,
} from './tilesetSlots'

describe('tileset image slots', () => {
  it('labels stock sheets, F-Z, then continues with numbered F sheets', () => {
    expect(tilesetSlotLabel(0)).toBe('A1')
    expect(tilesetSlotLabel(4)).toBe('A5')
    expect(tilesetSlotLabel(5)).toBe('B')
    expect(tilesetSlotLabel(8)).toBe('E')
    expect(tilesetSlotLabel(9)).toBe('F')
    expect(tilesetSlotLabel(29)).toBe('Z')
    expect(tilesetSlotLabel(30)).toBe('F1')
    expect(tilesetSlotLabel(31)).toBe('F2')
    expect(tilesetSlotLabel(999)).toBe('F970')
    expect(tilesetSlotLabel(-1)).toBe('')
  })

  it('always renders at least the nine stock slots without clipping extended data', () => {
    expect(tilesetSlotCount(0)).toBe(MV_TILESET_SLOT_COUNT)
    expect(tilesetSlotCount(9)).toBe(MV_TILESET_SLOT_COUNT)
    expect(tilesetSlotCount(12)).toBe(12)
    expect(tilesetSlotCount(999)).toBe(999)
    expect(tilesetSlotCount(Number.NaN)).toBe(MV_TILESET_SLOT_COUNT)
  })

  it('allows appending only when the project-level extension switch is enabled', () => {
    expect(canAppendTilesetSlot(9, false)).toBe(false)
    expect(canAppendTilesetSlot(9, true)).toBe(true)
    expect(canAppendTilesetSlot(999, true)).toBe(true)
  })
})
