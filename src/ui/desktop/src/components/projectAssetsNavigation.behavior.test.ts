import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { LatestAsyncCoordinator } from '../utils/latestAsyncCoordinator'

// Execute the component's actual listing and navigation declarations with controlled I/O.
function workspaceFunctions(names: string[], bindings: Record<string, unknown>) {
  const source = parse(fs.readFileSync(new URL('./ProjectAssetsWorkspace.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
  const ast = ts.createSourceFile('workspace.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = ast.statements.filter((statement) => {
    if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text ?? '')
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => names.includes(declaration.name.getText(ast)))
  })
  assert.equal(declarations.length, names.length)
  const body = transformSync(declarations.map((statement) => statement.getText(ast)).join('\n'), { loader: 'ts', format: 'cjs' }).code
  return new Function(...Object.keys(bindings), `${body}\nreturn { ${names.join(',')} };`)(...Object.values(bindings)) as Record<string, any>
}

function navigationHarness(browse: (id: string) => Promise<unknown>) {
  const bindings = {
    projectStore: { currentProject: 'demo-project' },
    FAVORITES_NODE_ID: '__favorites__', FAVORITES_GROUP_PREFIX: '__favorites__:', PROJECT_RESOURCES_ROOT_NODE_ID: '__project_resources__',
    selectedCategoryId: ref(''), categoryEntries: ref<unknown[]>([]), categoryError: ref(''), categoryDirectory: ref(''), categoryLoading: ref(false),
    thumbnailBucket: ref(256), selectedFolderId: ref(null), scrollTop: ref(0), gridHost: ref(null), searchQuery: ref(''),
    failedThumbnails: ref(new Set()), armedThumbnailIds: ref(new Set()), imageDimensionCache: ref(new Map()), thumbnailArmGeneration: 0,
    listingCoordinator: new LatestAsyncCoordinator(), browseOptions: ref({}), projectAssets: { browseCategory: browse },
    selection: ref({}), pruneProjectAssetSelection: (value: unknown) => value,
    isSelectionMode: ref(false), props: {}, isProjectAssetGroupCategory: () => false,
    clearFileSelection: () => undefined, clearAllSelection: () => undefined, syncTreeCurrentKey: () => undefined,
    t: (key: string) => key, formatError: String,
    favorites: ref(new Set(['img/pictures:favorite.png'])), favoriteListingNodes: () => ['img/pictures'],
    boundedAsyncMap: (items: string[], _limit: number, mapper: (id: string) => Promise<unknown>) => Promise.all(items.map(mapper)),
  }
  const functions = workspaceFunctions(['loadCategory', 'loadFavoritesListing', 'selectCategory', 'onTreeNodeClick'], bindings)
  return { ...bindings, ...functions }
}

test('rapid folder navigation starts the latest read without waiting for a slow obsolete folder', async () => {
  let rejectOld!: (error: Error) => void
  const calls: string[] = []
  const oldRead = new Promise((_resolve, reject) => { rejectOld = reject })
  const workspace = navigationHarness(async (id) => {
    calls.push(id)
    return id === 'img/old' ? oldRead : { entries: [{ id: 'img/new:file.png' }], directory: 'img/new' }
  })
  const old = workspace.loadCategory('img/old')
  const latest = workspace.loadCategory('img/new')
  assert.deepEqual(calls, ['img/old', 'img/new'])
  await latest
  assert.deepEqual(workspace.categoryEntries.value, [{ id: 'img/new:file.png' }])
  assert.equal(workspace.categoryLoading.value, false)
  rejectOld(new Error('obsolete read failed'))
  await old
  assert.equal(workspace.categoryError.value, '')
  assert.equal(workspace.categoryDirectory.value, 'img/new')
})

test('rapid folder navigation cannot be overwritten by an obsolete favorites read', async () => {
  let finishFavorites!: (result: unknown) => void
  const workspace = navigationHarness(async (id) => id === 'img/pictures'
    ? new Promise((resolve) => { finishFavorites = resolve })
    : { entries: [{ id: 'img/current:file.png' }], directory: 'img/current' })
  const old = workspace.loadCategory('__favorites__')
  await workspace.loadCategory('img/current')
  finishFavorites({ entries: [{ id: 'img/pictures:favorite.png' }] })
  await old
  assert.deepEqual(workspace.categoryEntries.value, [{ id: 'img/current:file.png' }])
  workspace.onTreeNodeClick({ id: '__favorite_folder__:img/shortcut', targetId: 'img/shortcut' })
  assert.equal(workspace.selectedCategoryId.value, 'img/shortcut')
})

test('rapid folder navigation discards late results after the selected project changes', async () => {
  let finish!: (result: unknown) => void
  const workspace = navigationHarness(() => new Promise((resolve) => { finish = resolve }))
  const pending = workspace.loadCategory('img/old')
  workspace.projectStore.currentProject = 'another-demo-project'
  finish({ entries: [{ id: 'img/old:file.png' }], directory: 'img/old' })
  await pending
  assert.deepEqual(workspace.categoryEntries.value, [])
  assert.equal(workspace.categoryDirectory.value, '')
})

test('favorites tree and grid share first-level folders with unique tree keys and selection filtering', () => {
  const folders = [{ id: 'img/ui', entryCount: 2 }, { id: 'audio/se', entryCount: 1 }]
  const workspace = workspaceFunctions(['favoriteFolderItems', 'treeData', 'folderItems'], {
    computed, favoritesGroups: ref(['img/pictures']), favorites: ref(new Set(['img/ui', 'audio/se', 'img/missing'])),
    categoryAllowedInSelectionMode: (id: string) => id.startsWith('img/'),
    treeNodes: ref(folders), language: ref('en-US'), findTreeNode: (nodes: any[], id: string) => nodes.find((node) => node.id === id),
    projectAssetCategoryLabel: (id: string) => id, countFavoriteFilesInNode: () => 1,
    selectionTreeNodes: (nodes: any[]) => nodes, mapTreeNode: (node: any) => ({ ...node, label: node.id }),
    FAVORITES_NODE_ID: '__favorites__', FAVORITES_GROUP_PREFIX: '__favorites__:', PROJECT_RESOURCES_ROOT_NODE_ID: '__project_resources__',
    t: (key: string) => key, selectedCategoryId: ref('__favorites__'), isFavoritesSelection: ref(true), favoritesGroupNodeId: ref(undefined),
  })
  const shortcuts = workspace.treeData.value[0].children[0].children
  const grid = workspace.folderItems.value
  assert.deepEqual(shortcuts.map((item: any) => item.targetId), grid.map((item: any) => item.id))
  assert.deepEqual(grid.map((item: any) => item.id).sort(), ['__favorites__:img/pictures', 'img/ui'])
  assert.equal(shortcuts.find((item: any) => item.targetId === 'img/ui').id, '__favorite_folder__:img/ui')
})
