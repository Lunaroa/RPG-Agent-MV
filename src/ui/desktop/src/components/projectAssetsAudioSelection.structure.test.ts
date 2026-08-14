import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(join(import.meta.dirname, 'ProjectAssetsWorkspace.vue'), 'utf8')

test('selecting an audio asset auditions only the newly selected entry', () => {
  assert.match(source, /function auditionAudioSelection\([\s\S]*nextSelection\.selectedIds\.includes\(entry\.id\)/)
  assert.match(source, /if \(!isAudioEntry\(entry\) \|\| !entry\.url\) return[\s\S]*playAudioEntries\(\[entry\]\)/)
  assert.match(source, /function onCellClick[\s\S]*auditionAudioSelection\(item\.entry, next\)/)
  assert.match(source, /function selectGridItemAt[\s\S]*auditionAudioSelection\(item\.entry, next\)/)
  assert.doesNotMatch(source, /auditionAudioSelection\([\s\S]*selectedAudioEntries\.value/)
})
