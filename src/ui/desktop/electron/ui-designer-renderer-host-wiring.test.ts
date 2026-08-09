import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('renderer host plugin policy is read-only and cannot invoke project config migration', () => {
  const source = fs.readFileSync(new URL('./ipc-handlers.ts', import.meta.url), 'utf8')
  assert.match(source, /registerMapPreviewRoot\(key, resourceRoot, resolveRendererHostDisabledPlugins\(sourceProject\)\)/)
  const resolver = source.slice(source.indexOf('function resolveRendererHostDisabledPlugins'), source.indexOf('function publishMapPreviewRuntimeCommand'))
  assert.ok(resolver.length > 0)
  assert.doesNotMatch(resolver, /patchProjectConfig|patchWorkspaceSettings/)
})

test('renderer host shutdown failure retains evidence without blocking later Electron cleanup', () => {
  const source = fs.readFileSync(new URL('./ipc-handlers.ts', import.meta.url), 'utf8')
  const cleanup = source.slice(source.indexOf('export function cleanupIpcHandlers'), source.indexOf('export function cleanupMapIpcHandlers'))
  const hostShutdown = cleanup.indexOf('uiDesignerRendererHostService.shutdownSync()')
  const retainedError = cleanup.indexOf('retained the temporary project')
  const laterCleanup = cleanup.indexOf('interactivePlaytestService.shutdownSync()')
  assert.ok(hostShutdown >= 0 && retainedError > hostShutdown && laterCleanup > retainedError)
  assert.match(cleanup, /try \{[\s\S]*uiDesignerRendererHostService\.shutdownSync\(\)[\s\S]*\} catch \(error\)/)
})
