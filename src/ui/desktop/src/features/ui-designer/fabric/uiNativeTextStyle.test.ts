import assert from 'node:assert/strict'
import test from 'node:test'
import type { UiProjectResourceCatalog } from '@contract/ui-designer'
import { nativeTextSignature, resolveNativeTextProfile } from './fabricNodeFactory'

const catalog = (overrides: Partial<UiProjectResourceCatalog>): UiProjectResourceCatalog => ({
  projectPath: 'project',
  engine: 'unknown',
  resources: [],
  ...overrides,
})

test('the native text profile follows the catalog engine and main font face', async () => {
  const mv = catalog({ engine: 'MV', mainFontFace: 'SimHei, Heiti TC, sans-serif', mainFontSize: 28 })
  const mvProfile = await resolveNativeTextProfile(mv)
  assert.equal(mvProfile.fontFamily, 'SimHei, Heiti TC, sans-serif')
  assert.deepEqual(mvProfile.outline, { color: 'rgba(0, 0, 0, 0.5)', width: 4 })

  const mz = catalog({ engine: 'MZ' })
  const mzProfile = await resolveNativeTextProfile(mz)
  assert.equal(mzProfile.fontFamily, 'rmmz-mainfont, sans-serif')
  assert.deepEqual(mzProfile.outline, { color: 'rgba(0, 0, 0, 0.5)', width: 3 })

  assert.deepEqual(await resolveNativeTextProfile(catalog({})), {})
})

test('the native text signature rebuilds text and button objects on engine or font changes', () => {
  const mv = catalog({ engine: 'MV', mainFontFace: 'GameFont' })
  const mz = catalog({ engine: 'MZ', mainFontFace: 'rmmz-mainfont, sans-serif' })
  assert.notEqual(nativeTextSignature(mv), nativeTextSignature(mz))
  assert.notEqual(nativeTextSignature(mz), nativeTextSignature(catalog({ engine: 'MZ', mainFontFace: 'CustomFace' })))
  assert.notEqual(nativeTextSignature(mz), nativeTextSignature(catalog({
    engine: 'MZ',
    mainFontFace: 'rmmz-mainfont, sans-serif',
    resources: [{ id: 'font:fonts/rmmz-mainfont.ttf', category: 'font', path: 'fonts/rmmz-mainfont.ttf', relativePath: 'fonts/rmmz-mainfont.ttf', previewUrl: 'rpg-agent-preview://resource/rmmz-mainfont', name: 'rmmz-mainfont.ttf', exists: true, referenced: false }],
  })))
  assert.equal(nativeTextSignature(catalog({})), '')
})
