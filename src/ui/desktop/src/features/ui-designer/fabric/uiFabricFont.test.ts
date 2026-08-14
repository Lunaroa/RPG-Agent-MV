import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUiFabricFontLoader, uiFabricFontFamily } from './uiFabricFont'

test('project fonts use a stable family and are installed once per resource URL', async () => {
  assert.equal(uiFabricFontFamily('fonts/Heading Font.woff2'), uiFabricFontFamily('FONTS\\Heading Font.woff2'))
  assert.notEqual(uiFabricFontFamily('fonts/Heading Font.woff2'), uiFabricFontFamily('fonts/Body Font.woff2'))

  const installed: Array<{ family: string, url: string }> = []
  const load = createUiFabricFontLoader({
    install: async (family, url) => { installed.push({ family, url }) },
  })
  const first = await load('fonts/Heading Font.woff2', 'rpg-agent-preview://resource/font-a')
  const second = await load('fonts/Heading Font.woff2', 'rpg-agent-preview://resource/font-a')

  assert.equal(first, second)
  assert.deepEqual(installed, [{ family: first, url: 'rpg-agent-preview://resource/font-a' }])
})
