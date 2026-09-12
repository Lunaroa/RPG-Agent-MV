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

test('ordinary text keeps manual lines while button text uses the explicit single-line mode', () => {
  const source = readFileSync(new URL('./uiLayoutTextbox.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(this\.singleLine\) return \[this\.graphemeSplit\(normalizeUiSingleLineText/)
  assert.match(source, /return lines\.map\(\(line\) => this\.graphemeSplit\(line\)\)/)
  assert.match(source, /for \(let index = 0; index < this\._textLines\.length; index \+= 1\)/)
})
