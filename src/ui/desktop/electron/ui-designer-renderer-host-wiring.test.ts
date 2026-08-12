import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('renderer host plugin policy is read-only and cannot invoke project config migration', () => {
  const source = fs.readFileSync(new URL('./ipc-handlers.ts', import.meta.url), 'utf8')
  assert.match(source, /registerMapPreviewRoot\([\s\S]*key,[\s\S]*resourceRoot,[\s\S]*resolveRendererHostDisabledPlugins\(sourceProject\),[\s\S]*options\?\.fallback,[\s\S]*options\?\.deniedPaths/)
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

test('Electron teardown retains failed map and particle isolation owners while continuing cleanup', () => {
  const source = fs.readFileSync(new URL('./ipc-handlers.ts', import.meta.url), 'utf8')
  const cleanup = source.slice(source.indexOf('export function cleanupIpcHandlers'), source.indexOf('export function cleanupMapIpcHandlers'))
  const mapStop = cleanup.indexOf('mapPreviewService.shutdownSync()')
  const mapOwnership = cleanup.indexOf('mapPreviewService.hasRetainedIsolationOwner()')
  const hostStop = cleanup.indexOf('uiDesignerRendererHostService.shutdownSync()')
  const particleLoop = cleanup.indexOf('for (const key of [...particlePreviewSessions.keys()])')

  assert.ok(mapStop >= 0 && mapOwnership > mapStop && hostStop > mapOwnership)
  assert.match(cleanup, /if \(!mapPreviewService\.hasRetainedIsolationOwner\(\)\) mapPreviewService = null/)
  assert.ok(particleLoop > hostStop)
  assert.match(cleanup.slice(particleLoop), /try \{ disposeParticlePreviewSession\(key\); \}[\s\S]*retained an isolated preview owner/)
})
