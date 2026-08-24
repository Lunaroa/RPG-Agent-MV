import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const directory = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string) => fs.readFileSync(path.join(directory, name), 'utf8')

function compile(name: string) {
  const source = read(name)
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  compileScript(parsed.descriptor, { id: `phase2b-${name}` })
  if (parsed.descriptor.template) {
    const result = compileTemplate({ id: `phase2b-${name}`, filename: name, source: parsed.descriptor.template.content })
    assert.deepEqual(result.errors, [])
  }
  return source
}

describe('UI Designer Inspector transaction drafts', () => {
  test('previews high-frequency fields live and commits only at a transaction boundary', () => {
    const field = compile('UiPropertyField.vue')
    assert.match(field, /@update:model-value="updateDraft\(\$event[^)]*\)"/)
    assert.match(field, /@active-change="updateDraft\(\$event \?\? '#ffffff'\)"/)
    assert.match(field, /@change="commitValue"/)
    assert.match(field, /@blur="commitValue"/)
    assert.match(field, /@keydown\.enter="handleTextEnter"/)
    assert.match(field, /if \(props\.multiline && !event\.ctrlKey && !event\.metaKey\) return/)
    assert.match(field, /pending: \(\) => valueDraftPending \|\| pendingCode !== undefined/)
    assert.match(field, /emit\('preview', value, props\.sceneId, props\.nodeId\)/)
    assert.match(field, /emit\('commit', props\.sceneId, props\.nodeId\)/)
    assert.match(field, /emit\('cancel', props\.sceneId, props\.nodeId\)/)
    const inspector = compile('UiDesignerInspector.vue')
    assert.match(inspector, /designer\.previewNodeProperty\(targetId, key, presentationPropertyValue\(targetId, key, value\)\)/)
    assert.match(inspector, /designer\.commitNodePropertyPreview\(targetId, key\)/)
    assert.match(inspector, /designer\.cancelNodePropertyPreview\(targetId, key\)/)
    assert.match(inspector, /const draftRect = unwrap\(designer\.draftRects\)\[node\.id\]/)
    assert.match(inspector, /const draftPosition = unwrap\(designer\.draftPositions\)\[node\.id\]/)
    assert.match(inspector, /const draftRotation = unwrap\(designer\.draftRotations\)\[node\.id\]/)
    assert.match(inspector, /\{ key: 'rotate', kind: 'number' \}/)
    assert.doesNotMatch(inspector, /key: 'rotate'[^}]*min: -180[^}]*max: 180/)
  })

  test('keeps scene name local until blur or Enter', () => {
    const toolbar = compile('UiDesignerToolbar.vue')
    assert.match(toolbar, /:model-value="sceneNameDraft"/)
    assert.match(toolbar, /@update:model-value="previewSceneName"/)
    assert.match(toolbar, /@blur="commitSceneName"/)
    assert.match(toolbar, /@keydown\.enter\.prevent="commitSceneName"/)
    assert.doesNotMatch(toolbar, /@update:model-value="designer\.setSceneMeta/)
  })
})
