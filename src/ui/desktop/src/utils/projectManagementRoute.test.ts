import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { normalizeDatabaseSection, resolveAppRailItem } from './projectManagementRoute'

const routerSource = readFileSync(
  fileURLToPath(new URL('../router/index.ts', import.meta.url)),
  'utf8',
)

describe('database route state', () => {
  it('normalizes supported sections and rejects arbitrary values', () => {
    expect(normalizeDatabaseSection('database')).toBe('database')
    expect(normalizeDatabaseSection('commonEvents')).toBe('commonEvents')
    expect(normalizeDatabaseSection('switches')).toBe('switches')
    expect(normalizeDatabaseSection('unknown')).toBe('database')
    expect(normalizeDatabaseSection(['database'])).toBe('database')
  })

  it('highlights the database rail item on the standalone database route', () => {
    expect(resolveAppRailItem('/database', {})).toBe('database')
    expect(resolveAppRailItem('/database', { section: 'switches' })).toBe('database')
    expect(resolveAppRailItem('/console', { page: 'settings' })).toBe('console')
    expect(resolveAppRailItem('/console', { page: 'story', section: 'database' })).toBe('console')
    expect(resolveAppRailItem('/project-assets', {})).toBe('project-assets')
    expect(resolveAppRailItem('/map-overview', {})).toBe('map-overview')
  })

  it('redirects the legacy story-graph route to the database page', () => {
    expect(routerSource).toMatch(/path:\s*['"]\/story-graph['"]/)
    expect(routerSource).toMatch(/path:\s*['"]\/story-graph['"][\s\S]*?redirect:\s*['"]\/database['"]/)
    expect(routerSource).not.toMatch(/path:\s*['"]\/story-graph['"][\s\S]*?redirect:\s*['"]\/console/)
  })
})
