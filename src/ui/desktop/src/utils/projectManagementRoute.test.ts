import { describe, expect, it } from 'vitest'

import { normalizeProjectManagementSection, resolveAppRailItem } from './projectManagementRoute'

describe('project management route state', () => {
  it('normalizes supported sections and rejects arbitrary values', () => {
    expect(normalizeProjectManagementSection('database')).toBe('database')
    expect(normalizeProjectManagementSection('commonEvents')).toBe('commonEvents')
    expect(normalizeProjectManagementSection('unknown')).toBe('overview')
    expect(normalizeProjectManagementSection(['database'])).toBe('overview')
  })

  it('keeps the database and console rail states mutually exclusive', () => {
    expect(resolveAppRailItem('/console', { page: 'story', section: 'database' })).toBe('database')
    expect(resolveAppRailItem('/console', { page: 'story', section: 'maps' })).toBe('console')
    expect(resolveAppRailItem('/console', { page: 'settings', section: 'database' })).toBe('console')
    expect(resolveAppRailItem('/map-overview', {})).toBe('map-overview')
  })
})
