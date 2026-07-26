import { describe, expect, it } from 'vitest'

import {
  EXTENDED_TILESET_SLOT_LIMIT,
  MV_TILESET_SLOT_COUNT,
  UNLIMITED_TILESET_SLOTS_ENABLED,
  canAppendTilesetSlot,
  tilesetSlotCount,
  tilesetSlotLabel,
} from './tilesetSlots'

describe('tileset image slots', () => {
  it('labels the stock MV sheets A1-E and extended sheets F-Z', () => {
    expect(tilesetSlotLabel(0)).toBe('A1')
    expect(tilesetSlotLabel(4)).toBe('A5')
    expect(tilesetSlotLabel(5)).toBe('B')
    expect(tilesetSlotLabel(8)).toBe('E')
    expect(tilesetSlotLabel(9)).toBe('F')
    expect(tilesetSlotLabel(EXTENDED_TILESET_SLOT_LIMIT - 1)).toBe('Z')
    expect(tilesetSlotLabel(EXTENDED_TILESET_SLOT_LIMIT)).toBe('')
    expect(tilesetSlotLabel(-1)).toBe('')
  })

  it('always renders at least the nine stock slots and never hides plugin data', () => {
    expect(tilesetSlotCount(0)).toBe(MV_TILESET_SLOT_COUNT)
    expect(tilesetSlotCount(9)).toBe(MV_TILESET_SLOT_COUNT)
    expect(tilesetSlotCount(12)).toBe(12)
    expect(tilesetSlotCount(999)).toBe(EXTENDED_TILESET_SLOT_LIMIT)
  })

  it('keeps the extension switch off for the base release', () => {
    expect(UNLIMITED_TILESET_SLOTS_ENABLED).toBe(false)
    expect(canAppendTilesetSlot(9)).toBe(false)
    expect(canAppendTilesetSlot(9, true)).toBe(true)
    expect(canAppendTilesetSlot(EXTENDED_TILESET_SLOT_LIMIT, true)).toBe(false)
  })
})
