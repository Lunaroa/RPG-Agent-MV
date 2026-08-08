import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  normalizeDatabaseSection,
  productPluginDisabledRedirect,
  resolveAppRailItem,
} from './projectManagementRoute'

const routerSource = readFileSync(
  fileURLToPath(new URL('../router/index.ts', import.meta.url)),
  'utf8',
)
const appSource = readFileSync(
  fileURLToPath(new URL('../App.vue', import.meta.url)),
  'utf8',
)
const marketplaceSource = readFileSync(
  fileURLToPath(new URL('../views/PluginMarketplaceView.vue', import.meta.url)),
  'utf8',
)

describe('database route state', () => {
  it('normalizes supported sections and rejects arbitrary values', () => {
    expect(normalizeDatabaseSection('database')).toBe('database')
    expect(normalizeDatabaseSection('commonEvents')).toBe('commonEvents')
    expect(normalizeDatabaseSection('switches')).toBe('switches')
    expect(normalizeDatabaseSection('variables')).toBe('variables')
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
    expect(resolveAppRailItem('/plugin-marketplace', {})).toBe('plugin-marketplace')
    expect(resolveAppRailItem('/ui-designer', {})).toBe('ui-designer')
  })

  it('redirects disabled product plugin deep links with an explicit reason', () => {
    expect(productPluginDisabledRedirect('ui-designer', '/ui-designer')).toEqual({
      path: '/plugin-marketplace',
      query: {
        reason: 'disabled',
        plugin: 'ui-designer',
        from: '/ui-designer',
      },
    })
  })

  it('redirects the legacy story-graph route to the database page', () => {
    expect(routerSource).toMatch(/path:\s*['"]\/story-graph['"]/)
    expect(routerSource).toMatch(/path:\s*['"]\/story-graph['"][\s\S]*?redirect:\s*['"]\/database['"]/)
    expect(routerSource).not.toMatch(/path:\s*['"]\/story-graph['"][\s\S]*?redirect:\s*['"]\/console/)
  })

  it('declares the standalone product plugin routes', () => {
    expect(routerSource).toMatch(/path:\s*['"]\/plugin-marketplace['"]/)
    expect(routerSource).toMatch(/path:\s*['"]\/ui-designer['"][\s\S]*?component:\s*UiDesignerView/)
    expect(routerSource).toMatch(/productPluginDisabledRedirect\('ui-designer'/)
    expect(appSource).toMatch(/KeepAlive[^>]*exclude=\"\['UiDesignerView'\]\"/)
  })

  it('keeps the marketplace deep-link and hidden-control selectors constrained', () => {
    expect(marketplaceSource).toMatch(/parsed\.pathname !== '\/ui-designer'/)
    expect(marketplaceSource).toMatch(/plugin-marketplace-enable-\$\{plugin\.id\}/)
    expect(marketplaceSource).toMatch(/plugin-marketplace-open-\$\{plugin\.id\}/)
    expect(marketplaceSource).toMatch(/plugin-marketplace-retry/)
  })
})
