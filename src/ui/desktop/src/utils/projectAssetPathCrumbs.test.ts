import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProjectAssetPathCrumbs } from './projectAssetPathCrumbs.ts'

describe('buildProjectAssetPathCrumbs', () => {
  const tree = [
    {
      id: 'img',
      directory: 'img',
      children: [
        {
          id: 'pictures',
          directory: 'img/pictures',
          children: [
            { id: 'pictures/busts', directory: 'img/pictures/busts' },
          ],
        },
      ],
    },
  ]

  it('builds navigable crumbs for nested directories', () => {
    const crumbs = buildProjectAssetPathCrumbs('img/pictures/busts', tree)
    assert.deepEqual(crumbs, [
      { label: 'img', directory: 'img', nodeId: 'img' },
      { label: 'pictures', directory: 'img/pictures', nodeId: 'pictures' },
      { label: 'busts', directory: 'img/pictures/busts', nodeId: 'pictures/busts' },
    ])
  })

  it('returns empty for blank directory', () => {
    assert.deepEqual(buildProjectAssetPathCrumbs('', tree), [])
  })
})
