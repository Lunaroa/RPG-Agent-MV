import { describe, expect, it } from 'vitest'

import { DATABASE_RM_LAYOUTS, RM_LAYOUT_HIDDEN_PATHS } from './databaseRmLayouts'

const ENTRY_GROUPS = ['Items', 'Skills', 'Weapons', 'Armors', 'Enemies', 'States', 'Classes'] as const

describe('stock RM database layouts', () => {
  it('covers all seven entry-type groups', () => {
    for (const group of ENTRY_GROUPS) {
      expect(DATABASE_RM_LAYOUTS[group]?.length, group).toBeGreaterThan(0)
    }
    expect(DATABASE_RM_LAYOUTS.Actors).toBeUndefined()
  })

  it('never references the same field path twice within a group', () => {
    for (const group of ENTRY_GROUPS) {
      const seen = new Set<string>()
      for (const panel of DATABASE_RM_LAYOUTS[group] || []) {
        for (const row of panel.rows) {
          for (const path of row) {
            expect(seen.has(path), `${group}:${path}`).toBe(false)
            seen.add(path)
          }
        }
      }
    }
  })

  it('keeps traits/damage and note in the side column like the stock editor', () => {
    for (const group of ENTRY_GROUPS) {
      const sidePaths = (DATABASE_RM_LAYOUTS[group] || [])
        .filter((panel) => panel.column === 'side')
        .flatMap((panel) => panel.rows.flat())
      expect(sidePaths, group).toContain('note')
      expect(sidePaths.some((path) => path === 'traits' || path === 'damage'), group).toBe(true)
    }
  })

  it('uses db-scoped i18n keys for titled panels and hides the id field', () => {
    for (const group of ENTRY_GROUPS) {
      for (const panel of DATABASE_RM_LAYOUTS[group] || []) {
        if (panel.titleKey) expect(panel.titleKey.startsWith('db.'), `${group}:${panel.titleKey}`).toBe(true)
        expect(panel.rows.flat()).not.toContain('id')
      }
    }
    expect(RM_LAYOUT_HIDDEN_PATHS.has('id')).toBe(true)
  })
})
