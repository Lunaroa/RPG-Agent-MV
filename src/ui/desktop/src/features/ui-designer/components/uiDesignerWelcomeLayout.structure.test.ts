import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

test('welcome content keeps the legacy centered width while its contents stay left aligned', () => {
  const source = fs.readFileSync(new URL('./UiDesignerWelcome.vue', import.meta.url), 'utf8')
  const parsed = parse(source, { filename: 'UiDesignerWelcome.vue' })

  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-welcome-layout', inlineTemplate: true }))
  assert.match(source, /\.welcome-panel \{[^}]*align-items: center;[^}]*text-align: left;/)
  assert.match(source, /\.welcome-hero \{[^}]*width: min\(720px, 100%\);/)
  assert.match(source, /\.welcome-panel \.el-alert \{[^}]*width: min\(720px, 100%\);/)
  assert.match(source, /\.welcome-list \{[^}]*width: min\(720px, 100%\);[^}]*text-align: left;/)
  assert.match(source, /\.scene-card-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(180px, 1fr\)\);/)
})
