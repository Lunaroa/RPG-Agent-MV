import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const componentDir = dirname(fileURLToPath(import.meta.url))
const desktopSrc = join(componentDir, '..')

function read(relativePath: string): string {
  return readFileSync(join(desktopSrc, relativePath), 'utf8')
}

test('project assets expose one navigable root above every resource category', () => {
  const source = read('components/ProjectAssetsWorkspace.vue')
  const crumbs = read('utils/projectAssetPathCrumbs.ts')
  const zh = read('i18n/locales/zh-CN.ts')
  const en = read('i18n/locales/en-US.ts')

  assert.match(source, /const PROJECT_RESOURCES_ROOT_NODE_ID = '__project_resources__'/)
  assert.match(source, /id: PROJECT_RESOURCES_ROOT_NODE_ID,[\s\S]*children: \[[\s\S]*id: FAVORITES_NODE_ID,[\s\S]*\.\.\.nodes/)
  assert.match(source, /compatibleNodes\.length > 0 \? PROJECT_RESOURCES_ROOT_NODE_ID : ''/)
  assert.match(source, /buildProjectAssetPathCrumbs\(displayDirectory\.value, treeNodes\.value, \{[\s\S]*nodeId: PROJECT_RESOURCES_ROOT_NODE_ID/)
  assert.match(source, /categoryId !== PROJECT_RESOURCES_ROOT_NODE_ID[\s\S]*!isProjectAssetGroupCategory\(categoryId\)/)
  assert.match(crumbs, /root\?: \{ label: string; nodeId: string \}/)
  assert.match(zh, /'projectAssets\.projectRoot': '项目资源'/)
  assert.match(en, /'projectAssets\.projectRoot': 'Project resources'/)
})
