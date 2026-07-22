import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Electron main imports workspaceSettings → mapOverviewLayouts.
 * That shared module must stay free of @antv runtime imports or main.js crashes on tslib/ESM interop.
 */
describe('mapOverviewLayouts main-process boundary', () => {
  it('does not import @antv/g6 or @antv/layout at runtime', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.join(here, 'mapOverviewLayouts.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"]@antv\/g6['"]/)
    expect(source).not.toMatch(/from\s+['"]@antv\/layout['"]/)
    expect(source).not.toMatch(/require\(['"]@antv\//)
  })

  it('keeps G6 execute behind a renderer-only module', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const executeSource = fs.readFileSync(path.join(here, 'mapOverviewLayoutExecute.ts'), 'utf8')
    expect(executeSource).toMatch(/from\s+['"]@antv\/g6['"]/)
    expect(executeSource).toMatch(/executeMapOverviewGraphLayout/)
  })
})
