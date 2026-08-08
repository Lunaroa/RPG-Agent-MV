import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupProductPluginIpcHandlers,
  registerProductPluginIpcHandlers,
} from './product-plugin-ipc-bindings.ts'

test('product-plugin IPC keeps defaults disabled and persists only through workspace settings', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipcMain = {
    handle(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler) },
    removeHandler(name: string) { handlers.delete(name) },
  }
  let settings: Record<string, unknown> = {}
  registerProductPluginIpcHandlers(ipcMain, {
    readSettings: () => settings,
    patchSettings: (patch) => {
      settings = { ...settings, productPlugins: { ...(settings.productPlugins as Record<string, boolean> || {}), ...patch.productPlugins } }
      return settings
    },
  })

  const listed = await handlers.get('product-plugin:list')!()
  assert.equal(listed.snapshot.find((entry: { id: string }) => entry.id === 'ui-designer')?.enabled, false)
  const enabled = await handlers.get('product-plugin:set-enabled')!(null, { id: 'ui-designer', enabled: true })
  assert.equal(enabled.ok, true)
  assert.equal(enabled.settings['ui-designer'], true)
  const restarted = await handlers.get('product-plugin:snapshot')!()
  assert.equal(restarted.snapshot.find((entry: { id: string }) => entry.id === 'ui-designer')?.enabled, true)
  const unknown = await handlers.get('product-plugin:set-enabled')!(null, { id: 'not-installed', enabled: true })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'unknown-plugin')

  cleanupProductPluginIpcHandlers(ipcMain)
  assert.equal(handlers.size, 0)
})

test('product-plugin IPC returns structured persistence errors without changing state', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipcMain = { handle(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler) } }
  let reads = 0
  registerProductPluginIpcHandlers(ipcMain, {
    readSettings: () => { reads += 1; throw new Error('database unavailable') },
    patchSettings: () => { throw new Error('database unavailable') },
  })
  const listed = await handlers.get('product-plugin:list')!()
  assert.equal(listed.error.code, 'persistence-failed')
  const setResult = await handlers.get('product-plugin:set-enabled')!(null, { id: 'ui-designer', enabled: true })
  assert.equal(setResult.ok, false)
  assert.equal(setResult.error.code, 'persistence-failed')
  assert.ok(reads > 0)
})
