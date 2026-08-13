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
const events = read('UiDesignerEvents.vue')
const buttonStates = read('UiButtonStatesEditor.vue')
const i18n = read(join('..', 'i18n.ts'))

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
    compileVue('UiDesignerEvents.vue', events)
    compileVue('UiButtonStatesEditor.vue', buttonStates)
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
    assert.match(workspace, /function selectionTreeNodes\(nodes:[\s\S]*return nodes/)
    assert.doesNotMatch(workspace, /base\.filter\(\(entry\) => projectAssetCategoryMatchesUiDesignerResourceKind/)
    assert.match(workspace, /selectedResourcePath[\s\S]*projectAssetCategoryMatchesUiDesignerResourceKind/)
    assert.match(workspace, /emit\('select', selectedResourcePath\.value, dimensions\)/)
    assert.match(workspace, /if \(isSelectionMode\.value\) \{[\s\S]*applyFileSelection\(selectProjectAssetExclusive\(item\.entry\.id\)\)[\s\S]*await confirmResourceSelection\(\)/)
    assert.match(inspector, /designer\.setSpriteResource\(node\.id, selection\.path/)
    assert.match(inspector, /videoResource/)
    assert.match(inspector, /videoPosterOptional/)
    assert.match(inspector, /particleImageOptional/)
    assert.match(inspector, /trackImageOptional/)
    assert.match(inspector, /fillImageOptional/)
  })

  test('groups a one-column Inspector and wires every nested image resource through the workspace', () => {
    assert.match(inspector, /grid-template-columns: minmax\(0, 1fr\)/)
    assert.match(inspector, /PURPOSE_ORDER/)
    assert.match(inspector, /resourceCategory: 'image'/)
    assert.match(inspector, /UiButtonStatesEditor[\s\S]*:pick-resource=/)
    assert.match(inspector, /UiButtonStatesEditor[\s\S]*:resources=/)
    assert.match(inspector, /UiFrameListEditor[\s\S]*:pick-resources=/)
    assert.match(inspector, /UiDesignerEvents[\s\S]*:pick-audio-resource=/)
    assert.match(events, /uiDesignerSeNameFromResourcePath/)
    assert.doesNotMatch(events, /v-else-if="action\.type === 'playSe'"[^>]*@update:model-value/)
    assert.match(buttonStates, /class="state-thumbnail"/)
    assert.match(buttonStates, /thumbnailUrl[\s\S]*previewUrl/)
  })

  test('renders the fixed six Inspector groups with advanced settings collapsed by default', () => {
    compileVue('UiDesignerInspector.vue', inspector)
    assert.match(inspector, /\['identity', 'contentResources', 'geometry', 'appearance', 'behavior', 'advanced'\]/)
    assert.match(inspector, /<el-collapse v-model="expandedPurposes"/)
    assert.match(inspector, /<el-collapse-item v-for="group in fieldGroups"/)
    assert.match(inspector, /PURPOSE_ORDER\.filter\(\(purpose\) => purpose !== 'advanced'\)/)
    assert.match(inspector, /group\.purpose === 'identity'[\s\S]*:model-value="nodeNameDraft"/)
    assert.match(inspector, /draftCoordinator\.register\(commitNodeName/)
    assert.match(inspector, /@update:model-value="previewNodeName"/)
    assert.match(inspector, /group\.purpose === 'contentResources' && selectedNode\.type === 'button'/)
    assert.match(inspector, /group\.purpose === 'contentResources' && selectedNode\.type === 'frameAnimation'/)
    assert.doesNotMatch(inspector, /group\.purpose === 'resources'/)
    assert.match(i18n, /inspectorGroupIdentity: '标识'/)
    assert.match(i18n, /inspectorGroupGeometry: '几何'/)
    assert.match(i18n, /inspectorGroupContentResources: '内容与资源'/)
    assert.match(i18n, /inspectorGroupBehavior: '交互行为'/)
    assert.match(i18n, /inspectorGroupAdvanced: '节点专属高级项'/)
  })
})
