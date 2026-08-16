import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the editing textarea is pinned to the viewport so it cannot scroll the page', () => {
  const source = readFileSync(new URL('./uiLayoutTextbox.ts', import.meta.url), 'utf8')
  assert.match(source, /override initHiddenTextarea\(\)/)
  assert.match(source, /override updateTextareaPosition\(\)/)
  assert.match(source, /hiddenTextarea\.style\.position = 'fixed'/)
  assert.match(source, /window\.scrollX/)
  assert.match(source, /window\.scrollY/)
})
