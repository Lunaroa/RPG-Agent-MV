import assert from 'node:assert/strict'
import { test, vi } from 'vitest'

vi.mock('../adapters', () => ({ createUiDesignerAdapters: (overrides = {}) => ({ ...overrides }) }))
import { useUiDesigner } from './useUiDesigner'

test('keyboard nudge moves each descendant once and preserves undo and redo', () => {
  const designer = useUiDesigner()
  const parent = designer.addNode('container', 'node_root', { x: 40, y: 40 })!
  const child = designer.addNode('container', parent, { x: 60, y: 60 })!
  const leaf = designer.addNode('sprite', child, { x: 70, y: 70 })!
  const ids = [parent, child, leaf]
  const positions = () => ids.map((id) => {
    const { x, y } = designer.document.value.nodes.find((node) => node.id === id)!.props
    return { x, y }
  })
  for (const selected of [[parent], [parent, child, leaf], [parent, leaf]]) {
    designer.selectNodes(selected)
    for (const delta of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 10 }, { x: 0, y: -10 }]) {
      const before = positions()
      assert.equal(designer.nudgeSelected(delta), true)
      const after = before.map(({ x, y }) => ({ x: x + delta.x, y: y + delta.y }))
      assert.deepEqual(positions(), after)
      designer.undo()
      assert.deepEqual(positions(), before)
      designer.redo()
      assert.deepEqual(positions(), after)
    }
  }
})

test('keyboard nudge respects locked descendants and does not move stationary ancestors', () => {
  const designer = useUiDesigner()
  const parent = designer.addNode('container', 'node_root', { x: 20, y: 20 })!
  const child = designer.addNode('sprite', parent, { x: 40, y: 40 })!
  designer.selectNodes([child])
  assert.equal(designer.nudgeSelected({ x: 1, y: 0 }), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === parent)!.props.x, 20)
  designer.document.value.nodes.find((node) => node.id === child)!.locked = true
  designer.selectNodes([parent])
  const before = JSON.stringify(designer.document.value)
  assert.equal(designer.nudgeSelected({ x: 10, y: 0 }), false)
  assert.equal(JSON.stringify(designer.document.value), before)
})
