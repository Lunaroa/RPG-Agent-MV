/**
 * Run: node --experimental-strip-types --test src/utils/placementMapId.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  extractMapIdsFromText,
  resolveAskContextMapId,
  resolveEventMapId,
  resolveEventMapIdWithAsk,
  resolveRegistryContractMapId,
  resolveTargetMapId,
} from './placementMapId.ts'

describe('resolveTargetMapId', () => {
  test('numeric and numeric string', () => {
    assert.equal(resolveTargetMapId(1), 1)
    assert.equal(resolveTargetMapId('16'), 16)
  })

  test('Map016 filename style', () => {
    assert.equal(resolveTargetMapId('Map016'), 16)
    assert.equal(resolveTargetMapId('map_001'), 1)
    assert.equal(resolveTargetMapId('Map001.json'), 1)
    assert.equal(resolveTargetMapId('#1'), 1)
    assert.equal(resolveTargetMapId('地图#1'), 1)
    assert.equal(resolveTargetMapId('地图 16'), 16)
  })

  test('resolveEventMapId from rmmvTarget.mapId', () => {
    assert.equal(resolveEventMapId({ contractId: 'c1', rmmvTarget: { mapId: 1 } }), 1)
    assert.equal(resolveEventMapId({ contractId: 'c1', mapId: 'Map016' }), 16)
    assert.equal(resolveEventMapId({ contractId: 'c1' }), null)
  })

  test('resolveRegistryContractMapId', () => {
    assert.equal(resolveRegistryContractMapId({
      id: 'x',
      rmmvTarget: { mapId: 3 },
    }), 3)
    assert.equal(resolveRegistryContractMapId({ id: 'x', mapId: 2 }), 2)
  })

  test('extractMapIdsFromText and ask context', () => {
    assert.deepEqual(extractMapIdsFromText('请在 Map016 放置探针'), [16])
    assert.deepEqual(extractMapIdsFromText('地图#1 与 Map002'), [1, 2])
    assert.equal(resolveAskContextMapId({
      title: '放置事件',
      prompt: '目标：地图#3',
    }), 3)
  })

  test('resolveEventMapIdWithAsk fallback', () => {
    assert.equal(resolveEventMapIdWithAsk(
      { contractId: 'c1' },
      { prompt: 'Map005 门口' },
    ), 5)
  })

  test('mapId fallback field', () => {
    assert.equal(resolveTargetMapId(null, 3), 3)
    assert.equal(resolveTargetMapId(undefined, 'Map002'), 2)
  })

  test('invalid values', () => {
    assert.equal(resolveTargetMapId('MapABC'), null)
    assert.equal(resolveTargetMapId(0), null)
    assert.equal(resolveTargetMapId(NaN), null)
  })
})
