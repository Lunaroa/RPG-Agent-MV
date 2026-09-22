import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultNode, createUiDocument } from './document'
import { smartSnapTargetsForNode, snapRect, snapMoveRect, resizeHandlePoint } from './geometry'

test('hierarchy snapping includes stationary parents and excludes every moving subtree and hidden branch', () => {
  const document = createUiDocument()
  const a = createDefaultNode('container', { id: 'box_a', name: 'Box A', parentId: 'node_root' })
  const b = createDefaultNode('container', { id: 'box_b', name: 'Box B', parentId: 'node_root' })
  const childA = createDefaultNode('sprite', { id: 'child_a', name: 'Child A', parentId: a.id })
  const childB = createDefaultNode('sprite', { id: 'child_b', name: 'Child B', parentId: b.id })
  a.children.push(childA.id)
  b.children.push(childB.id)
  document.nodes[0].children.push(a.id, b.id)
  document.nodes.push(a, b, childA, childB)
  const targets = (id: string, excluded: string[] = []) => smartSnapTargetsForNode(document, id, excluded).map((target) => target.id)
  assert.deepEqual(targets(childA.id), [a.id, b.id, childB.id])
  assert.deepEqual(targets(a.id, [a.id, b.id]), [])
  b.props.visible = false
  assert.deepEqual(targets(childA.id), [a.id])
  b.props.visible = true
  b.locked = true
  assert.deepEqual(targets(childA.id), [a.id])
})

test('hierarchy snapping keeps node feedback when a resize or move also matches the grid', () => {
  const options = {
    enabled: true, gridEnabled: true, gridSize: 20, smartEnabled: true, sensitivity: 8,
    guides: [], targets: [{ id: 'peer', rect: { x: 100, y: 300, width: 30, height: 30 } }],
  }
  const origin = { x: 10, y: 10, width: 80, height: 30 }
  const resize = snapRect({ ...origin, width: 89 }, origin, 'e', { preserveAspect: false, fromCenter: false }, options)
  assert.equal(resize.x + resize.width, 100)
  assert.ok(resize.hits.some((hit) => hit.axis === 'x' && hit.nodeId === 'peer'))
  const move = snapMoveRect({ x: 99, y: 101, width: 20, height: 30 }, options, ['x'])
  assert.ok(move.hits.some((hit) => hit.nodeId === 'peer'))
})

test('hierarchy snapping shows peer guides on all eight resize handles when grid lines coincide', () => {
  const origin = { x: 100, y: 100, width: 100, height: 100 }
  const options = {
    enabled: true, gridEnabled: true, gridSize: 20, smartEnabled: true, sensitivity: 5,
    guides: [], targets: [{ id: 'peer', rect: { x: 80, y: 80, width: 140, height: 140 } }],
  }
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
    const xAxis = handle.includes('e') || handle.includes('w')
    const yAxis = handle.includes('n') || handle.includes('s')
    const request = { x: handle.includes('w') ? 81 : 100, y: handle.includes('n') ? 81 : 100, width: xAxis ? 119 : 100, height: yAxis ? 119 : 100 }
    const result = snapRect(request, origin, handle, { preserveAspect: false, fromCenter: false }, options)
    const point = resizeHandlePoint(result, handle)
    if (xAxis) {
      assert.equal(point.x, handle.includes('w') ? 80 : 220, handle)
      assert.ok(result.hits.some((hit) => hit.axis === 'x' && hit.nodeId === 'peer'), handle)
    }
    if (yAxis) {
      assert.equal(point.y, handle.includes('n') ? 80 : 220, handle)
      assert.ok(result.hits.some((hit) => hit.axis === 'y' && hit.nodeId === 'peer'), handle)
    }
  }
})
