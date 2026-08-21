import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alignNodes,
  clampNodePositionToParent,
  clampNodeRectToParent,
  distributeNodes,
  nodeRect,
  nodeVisualRect,
  snapMoveRect,
  smartSnapTargetsForNode,
} from './geometry'
import { createDefaultNode, createUiDocument } from './document'
import type { UiDesignerDocument, UiNode } from '@contract/ui-designer'

const documentWith = (...nodes: UiNode[]): UiDesignerDocument => {
  const document = createUiDocument()
  document.nodes.push(...nodes)
  document.nodes[0].children.push(...nodes.map((node) => node.id))
  return document
}

const approximately = (actual: number, expected: number, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`)

test('root canvas children are not confined to the scene rect', () => {
  const node = createDefaultNode('sprite', { id: 'free', name: 'Free', parentId: 'node_root', x: 10, y: 10, width: 100, height: 60 })
  const document = documentWith(node)
  assert.deepEqual(clampNodePositionToParent(document, 'free', { x: -500, y: 900 }), { x: -500, y: 900 })
  assert.deepEqual(clampNodeRectToParent(document, 'free', { x: -400, y: -300, width: 100, height: 60 }), { x: -400, y: -300, width: 100, height: 60 })
})

test('clipped user containers still contain their children', () => {
  const parent = createDefaultNode('container', { id: 'clipper', name: 'Clipper', parentId: 'node_root', x: 40, y: 30, width: 300, height: 180 })
  const child = createDefaultNode('sprite', { id: 'inner', name: 'Inner', parentId: parent.id, x: 60, y: 50, width: 100, height: 60 })
  const document = documentWith(parent, child)
  parent.children.push(child.id)
  parent.props.clip = true
  assert.deepEqual(clampNodePositionToParent(document, 'inner', { x: 999, y: 999 }), { x: 240, y: 150 })
  assert.deepEqual(clampNodePositionToParent(document, 'inner', { x: -999, y: -999 }), { x: 40, y: 30 })
})

test('smart snap targets can exclude the rest of a selection', () => {
  const a = createDefaultNode('sprite', { id: 'a', name: 'A', parentId: 'node_root', x: 0, y: 0 })
  const b = createDefaultNode('sprite', { id: 'b', name: 'B', parentId: 'node_root', x: 200, y: 0 })
  const c = createDefaultNode('sprite', { id: 'c', name: 'C', parentId: 'node_root', x: 400, y: 0 })
  const document = documentWith(a, b, c)
  assert.deepEqual(smartSnapTargetsForNode(document, 'a', ['b']).map((target) => target.id), ['c'])
  assert.deepEqual(smartSnapTargetsForNode(document, 'a').map((target) => target.id), ['b', 'c'])
})

test('move snapping aligns visual edges and centers instead of only node anchors', () => {
  const result = snapMoveRect({ x: 204, y: 94, width: 80, height: 40 }, {
    enabled: true,
    gridEnabled: false,
    gridSize: 32,
    smartEnabled: true,
    sensitivity: 7,
    guides: [],
    canvasWidth: 816,
    canvasHeight: 624,
    targets: [{ id: 'peer', rect: { x: 100, y: 100, width: 100, height: 80 } }],
  })
  assert.deepEqual({ x: result.x, y: result.y }, { x: 200, y: 100 })
  assert.deepEqual(result.hits.map((hit) => [hit.axis, hit.value, hit.source]), [
    ['x', 200, 'node'],
    ['y', 100, 'node'],
  ])
})

test('axis-locked move snapping never changes the other axis', () => {
  const result = snapMoveRect({ x: 204, y: 94, width: 80, height: 40 }, {
    enabled: true,
    gridEnabled: false,
    gridSize: 32,
    smartEnabled: true,
    sensitivity: 7,
    guides: [],
    targets: [{ id: 'peer', rect: { x: 100, y: 100, width: 100, height: 80 } }],
  }, ['x'])
  assert.deepEqual({ x: result.x, y: result.y }, { x: 200, y: 94 })
  assert.deepEqual(result.hits.map((hit) => hit.axis), ['x'])
})

test('nodeVisualRect rotates the frame about its visual center', () => {
  const node = createDefaultNode('sprite', { id: 'r', name: 'R', parentId: 'node_root', x: 100, y: 100, width: 100, height: 100 })
  const unrotated = nodeVisualRect(node)
  assert.deepEqual(unrotated, nodeRect(node))
  node.props.rotate = 180
  assert.deepEqual(nodeVisualRect(node), nodeRect(node))
  node.props.rotate = 45
  const rotated = nodeVisualRect(node)
  approximately(rotated.x, 79.29, 0.01)
  approximately(rotated.width, 141.42, 0.01)
  approximately(rotated.x + rotated.width / 2, 150, 0.01)
})

test('align puts rotated nodes visually flush, not frame-aligned', () => {
  const rotated = createDefaultNode('sprite', { id: 'rot', name: 'Rot', parentId: 'node_root', x: 100, y: 100, width: 100, height: 100 })
  rotated.props.rotate = 45
  const plain = createDefaultNode('sprite', { id: 'plain', name: 'Plain', parentId: 'node_root', x: 400, y: 100, width: 100, height: 100 })
  const aligned = alignNodes(documentWith(rotated, plain), ['rot', 'plain'], 'left', 'selection') as UiDesignerDocument
  const rotRect = nodeVisualRect(aligned.nodes.find((node) => node.id === 'rot')!)
  const movedPlain = aligned.nodes.find((node) => node.id === 'plain')!
  const plainRect = nodeVisualRect(movedPlain)
  approximately(rotRect.x, plainRect.x)
  approximately(movedPlain.props.x, 79.29)

  const centered = alignNodes(documentWith(rotated, plain), ['rot', 'plain'], 'centerY', 'selection') as UiDesignerDocument
  const rotCenter = nodeVisualRect(centered.nodes.find((node) => node.id === 'rot')!)
  const plainCenter = nodeVisualRect(centered.nodes.find((node) => node.id === 'plain')!)
  approximately(rotCenter.y + rotCenter.height / 2, plainCenter.y + plainCenter.height / 2)
})

test('distribute keeps equal visual gaps for rotated nodes', () => {
  const first = createDefaultNode('sprite', { id: 'd1', name: 'D1', parentId: 'node_root', x: 0, y: 0, width: 80, height: 80 })
  const middle = createDefaultNode('sprite', { id: 'd2', name: 'D2', parentId: 'node_root', x: 300, y: 0, width: 80, height: 80 })
  middle.props.rotate = 45
  const last = createDefaultNode('sprite', { id: 'd3', name: 'D3', parentId: 'node_root', x: 700, y: 0, width: 80, height: 80 })
  const distributed = distributeNodes(documentWith(first, middle, last), ['d1', 'd2', 'd3'], 'horizontal') as UiDesignerDocument
  const rects = ['d1', 'd2', 'd3'].map((id) => nodeVisualRect(distributed.nodes.find((node) => node.id === id)!))
  const gaps = [rects[1].x - (rects[0].x + rects[0].width), rects[2].x - (rects[1].x + rects[1].width)]
  approximately(gaps[0], gaps[1])
})

test('align honors anchors through the visual rect', () => {
  const anchored = createDefaultNode('sprite', { id: 'anchored', name: 'Anchored', parentId: 'node_root', x: 50, y: 50, width: 100, height: 100 })
  anchored.props.anchorX = 0.5
  anchored.props.anchorY = 0.5
  const plain = createDefaultNode('sprite', { id: 'plain2', name: 'Plain2', parentId: 'node_root', x: 400, y: 400, width: 100, height: 100 })
  const aligned = alignNodes(documentWith(anchored, plain), ['anchored', 'plain2'], 'left', 'selection') as UiDesignerDocument
  const anchoredRect = nodeVisualRect(aligned.nodes.find((node) => node.id === 'anchored')!)
  const plainRect = nodeVisualRect(aligned.nodes.find((node) => node.id === 'plain2')!)
  approximately(anchoredRect.x, plainRect.x)
})

test('parent reference aligns a child within its container', () => {
  const parent = createDefaultNode('container', { id: 'frame', name: 'Frame', parentId: 'node_root', x: 40, y: 30, width: 300, height: 180 })
  const child = createDefaultNode('sprite', { id: 'kid', name: 'Kid', parentId: parent.id, x: 60, y: 50, width: 100, height: 60 })
  parent.children.push(child.id)
  const aligned = alignNodes(documentWith(parent, child), ['kid'], 'centerX', 'parent') as UiDesignerDocument
  const moved = nodeVisualRect(aligned.nodes.find((node) => node.id === 'kid')!)
  approximately(moved.x + moved.width / 2, 190)
  const flushed = alignNodes(documentWith(parent, child), ['kid'], 'bottom', 'parent') as UiDesignerDocument
  const flushedRect = nodeVisualRect(flushed.nodes.find((node) => node.id === 'kid')!)
  approximately(flushedRect.y + flushedRect.height, 210)
})

test('parent reference falls back to the canvas for top-level nodes', () => {
  const node = createDefaultNode('sprite', { id: 'top', name: 'Top', parentId: 'node_root', x: 100, y: 100, width: 100, height: 60 })
  const document = documentWith(node)
  const aligned = alignNodes(document, ['top'], 'centerX', 'parent') as UiDesignerDocument
  const rect = nodeVisualRect(aligned.nodes.find((item) => item.id === 'top')!)
  approximately(rect.x + rect.width / 2, document.canvas.width / 2)
  const flushed = alignNodes(document, ['top'], 'right', 'parent') as UiDesignerDocument
  const flushedRect = nodeVisualRect(flushed.nodes.find((item) => item.id === 'top')!)
  approximately(flushedRect.x + flushedRect.width, document.canvas.width)
})
