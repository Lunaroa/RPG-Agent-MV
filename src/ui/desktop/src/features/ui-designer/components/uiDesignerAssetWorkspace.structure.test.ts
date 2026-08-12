import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const componentDir = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(componentDir, name), 'utf8')
const workspace = read(join('../../../components', 'ProjectAssetsWorkspace.vue'))
const inspector = read('UiDesignerInspector.vue')

function compileVue(filename: string, source: string): void {
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors, [])
  compileScript(parsed.descriptor, { id: `ui-designer-assets-${filename}` })
  if (parsed.descriptor.template) {
    const result = compileTemplate({ id: `ui-designer-assets-${filename}`, filename, source: parsed.descriptor.template.content })
    assert.deepEqual(result.errors, [])
  }
}

describe('UI Designer shared project asset workspace', () => {
  test('uses the complete manager in selection mode without the retired lightweight picker', () => {
    compileVue('ProjectAssetsWorkspace.vue', workspace)
    compileVue('UiDesignerInspector.vue', inspector)
    assert.match(inspector, /ProjectAssetsWorkspace/)
    assert.match(inspector, /mode="select"/)
    assert.match(workspace, /projectAssets\.importLocalFiles/)
    assert.match(workspace, /projectAssets\.rename/)
    assert.match(workspace, /projectAssets\.remove/)
    assert.match(workspace, /showReferencesForSelection/)
    assert.match(workspace, /toggleFavorite/)
    assert.match(workspace, /openPreviewForEntry/)
    assert.match(workspace, /LatestAsyncCoordinator/)
    assert.match(workspace, /boundedAsyncMap\(nodes, 4/)
    assert.match(workspace, /folderPreviewGeneration === generation && projectStore\.currentProject === project/)
    assert.match(workspace, /mutated: \[manifest: ProjectAssetChangeManifest\]/)
    assert.match(inspector, /@mutated="designer\.notifyResourceMutation"/)
    assert.doesNotMatch(inspector, /UiDesignerResourcePicker/)
  })

  test('groups a one-column Inspector and wires every nested image resource through the workspace', () => {
    assert.match(inspector, /grid-template-columns: minmax\(0, 1fr\)/)
    assert.match(inspector, /PURPOSE_ORDER/)
    assert.match(inspector, /resourceCategory: 'image'/)
    assert.match(inspector, /UiButtonStatesEditor[\s\S]*:pick-resource=/)
    assert.match(inspector, /UiFrameListEditor[\s\S]*:pick-resources=/)
  })
})
