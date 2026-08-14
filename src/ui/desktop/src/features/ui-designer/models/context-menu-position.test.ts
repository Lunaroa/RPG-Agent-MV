import assert from 'node:assert/strict'
import test from 'node:test'
import { fitContextMenuPosition } from './context-menu-position'

test('context menus remain fully inside every viewport edge', () => {
  const viewport = { width: 800, height: 600 }
  const menu = { width: 180, height: 420 }
  assert.deepEqual(fitContextMenuPosition({ x: 0, y: 0 }, menu, viewport), { x: 8, y: 8 })
  assert.deepEqual(fitContextMenuPosition({ x: 790, y: 590 }, menu, viewport), { x: 612, y: 172 })
  assert.deepEqual(fitContextMenuPosition({ x: 790, y: 20 }, menu, viewport), { x: 612, y: 20 })
  assert.deepEqual(fitContextMenuPosition({ x: 20, y: 590 }, menu, viewport), { x: 20, y: 172 })
})
