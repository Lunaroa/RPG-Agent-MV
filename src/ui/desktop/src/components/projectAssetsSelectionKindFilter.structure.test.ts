import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const componentDir = dirname(fileURLToPath(import.meta.url))

function read(relativePath: string): string {
  return readFileSync(join(componentDir, relativePath), 'utf8')
}

test('selection mode only offers categories matching the requested resource kind', () => {
  const source = read('ProjectAssetsWorkspace.vue')

  assert.match(source, /function categoryAllowedInSelectionMode\(categoryId: string\): boolean \{[\s\S]*if \(!isSelectionMode\.value\) return true[\s\S]*return projectAssetCategoryMatchesUiDesignerResourceKind\(categoryId, props\.resourceKind\)/)
  assert.match(source, /categoryId === 'img' \|\| categoryId\.startsWith\('img\/'\)\) return props\.resourceKind === 'image'/)
  assert.match(source, /categoryId === 'audio'\) return props\.resourceKind === 'audio'/)
  assert.match(source, /function selectionTreeNodes\(nodes: ProjectAssetCategoryTreeNode\[\]\)[\s\S]*if \(!isSelectionMode\.value\) return nodes[\s\S]*\.filter\(\(node\) => categoryAllowedInSelectionMode\(node\.id\)/)
})
