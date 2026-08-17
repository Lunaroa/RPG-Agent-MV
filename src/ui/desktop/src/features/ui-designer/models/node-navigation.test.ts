import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationDirectionFromKey, nextNodeIdInDirection, type UiNavigationEntry } from './node-navigation'

// Mirrors the reference layout the feature was specified with: three buttons in
// a top row, a nested sub-panel with two inner buttons, and a wide bottom bar.
const entries: UiNavigationEntry[] = [
  { id: 'btn1', rect: { x: 50, y: 50, width: 100, height: 50 } },
  { id: 'btn2', rect: { x: 200, y: 50, width: 100, height: 50 } },
  { id: 'btn3', rect: { x: 350, y: 50, width: 150, height: 50 } },
  { id: 'btn4', rect: { x: 50, y: 150, width: 100, height: 50 } },
  { id: 'btn5', rect: { x: 50, y: 220, width: 100, height: 50 } },
  { id: 'subPanel', rect: { x: 200, y: 150, width: 220, height: 140 } },
  { id: 'btn6', rect: { x: 210, y: 160, width: 100, height: 50 } },
  { id: 'btn7', rect: { x: 210, y: 230, width: 100, height: 50 } },
  { id: 'btn8', rect: { x: 50, y: 350, width: 370, height: 50 } },
]

test('arrow keys map to directions and nothing else does', () => {
  assert.equal(navigationDirectionFromKey('ArrowUp'), 'up')
  assert.equal(navigationDirectionFromKey('ArrowDown'), 'down')
  assert.equal(navigationDirectionFromKey('ArrowLeft'), 'left')
  assert.equal(navigationDirectionFromKey('ArrowRight'), 'right')
  assert.equal(navigationDirectionFromKey(' '), undefined)
  assert.equal(navigationDirectionFromKey('a'), undefined)
  assert.equal(navigationDirectionFromKey('Enter'), undefined)
})

test('moves along the same row and ignores candidates that do not lead with their edge', () => {
  // btn4 shares btn1's left edge, so it is never "to the right" of btn1.
  assert.equal(nextNodeIdInDirection(entries, 'btn1', 'right'), 'btn2')
  assert.equal(nextNodeIdInDirection(entries, 'btn3', 'left'), 'btn2')
  assert.equal(nextNodeIdInDirection(entries, 'btn4', 'up'), 'btn1')
})

test('reaches nested children and prefers the aligned neighbor over diagonals', () => {
  assert.equal(nextNodeIdInDirection(entries, 'btn2', 'down'), 'btn6')
  assert.equal(nextNodeIdInDirection(entries, 'btn8', 'up'), 'btn7')
})

test('weights the cross axis three times heavier than the travel axis', () => {
  const local: UiNavigationEntry[] = [
    { id: 'origin', rect: { x: 0, y: 0, width: 10, height: 10 } },
    { id: 'aligned', rect: { x: 100, y: 0, width: 10, height: 10 } },
    { id: 'diagonal', rect: { x: 50, y: 40, width: 10, height: 10 } },
  ]
  assert.equal(nextNodeIdInDirection(local, 'origin', 'right'), 'aligned')
})

test('without a current anchor falls back to the first entry and dead ends stay put', () => {
  assert.equal(nextNodeIdInDirection(entries, null, 'left'), 'btn1')
  assert.equal(nextNodeIdInDirection(entries, 'btn1', 'up'), null)
  assert.equal(nextNodeIdInDirection(entries, 'btn8', 'down'), null)
  assert.equal(nextNodeIdInDirection([], null, 'right'), null)
  assert.equal(nextNodeIdInDirection(entries, 'missing-id', 'right'), 'btn1')
})
