import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ULDS_DEFAULT_Z,
  parseUldsNote,
  staticUldsBlendMode,
  staticUldsBoolean,
  staticUldsCoordinate,
  staticUldsNumber,
  writeUldsNote,
} from './ulds.ts'

describe('parseUldsNote', () => {
  it('parses a single object block', () => {
    const result = parseUldsNote('<ulds> {"name":"BlueSky","x":10,"y":20} </ulds>')
    assert.equal(result.layers.length, 1)
    assert.equal(result.layers[0].name, 'BlueSky')
    assert.equal(result.layers[0].x, 10)
    assert.deepEqual(result.invalidBlocks, [])
  })

  it('merges multiple blocks in note order', () => {
    const note = [
      'before',
      '<ulds> {"name":"A","x":1,"y":1} </ulds>',
      '<ulds> {"name":"B","x":2,"y":2,"z":4.5} </ulds>',
      'after',
    ].join('\n')
    const result = parseUldsNote(note)
    assert.deepEqual(result.layers.map((layer) => layer.name), ['A', 'B'])
    assert.equal(result.layers[1].z, 4.5)
  })

  it('keeps malformed blocks verbatim instead of failing', () => {
    const note = '<ulds> {"name":oops} </ulds>\n<ulds> {"name":"ok","x":0,"y":0} </ulds>'
    const result = parseUldsNote(note)
    assert.equal(result.layers.length, 1)
    assert.equal(result.layers[0].name, 'ok')
    assert.deepEqual(result.invalidBlocks, [' {"name":oops} '])
  })

  it('accepts an array body and skips non-object entries', () => {
    const result = parseUldsNote('<ulds>[{"name":"A","x":0,"y":0}, 3, {"name":"B","x":1,"y":1}]</ulds>')
    assert.deepEqual(result.layers.map((layer) => layer.name), ['A', 'B'])
  })

  it('preserves unknown fields like frame or dynamic expressions', () => {
    const result = parseUldsNote('<ulds> {"name":"F","x":"this.rx(t)","y":0,"frame":{"tx":1},"smooth":true} </ulds>')
    assert.equal(result.layers[0].x, 'this.rx(t)')
    assert.deepEqual(result.layers[0].frame, { tx: 1 })
    assert.equal(result.layers[0].smooth, true)
  })

  it('returns empty for a note without tags', () => {
    const result = parseUldsNote('<parallax>whatever</parallax>')
    assert.deepEqual(result.layers, [])
    assert.deepEqual(result.invalidBlocks, [])
  })
})

describe('writeUldsNote', () => {
  it('round-trips layers while keeping surrounding note text', () => {
    const note = 'intro\n<ulds> {"name":"A","x":1,"y":2} </ulds>\ntrail'
    const parsed = parseUldsNote(note)
    const rewritten = writeUldsNote(note, parsed.layers, parsed.invalidBlocks)
    assert.ok(rewritten.startsWith('intro'))
    assert.ok(rewritten.indexOf('trail') < rewritten.indexOf('<ulds>'))
    const reparsed = parseUldsNote(rewritten)
    assert.equal(reparsed.layers.length, 1)
    assert.equal(reparsed.layers[0].name, 'A')
    assert.equal(reparsed.layers[0].x, 1)
  })

  it('writes one canonical block per layer with known keys first', () => {
    const rewritten = writeUldsNote('', [
      { z: 4, y: 2, x: 1, name: 'A', custom: 'keep-me' },
    ])
    const firstBlock = rewritten.slice(rewritten.indexOf('{'), rewritten.indexOf('}') + 1)
    assert.ok(firstBlock.indexOf('"name"') < firstBlock.indexOf('"x"'))
    assert.ok(firstBlock.indexOf('"x"') < firstBlock.indexOf('"y"'))
    assert.ok(firstBlock.indexOf('"y"') < firstBlock.indexOf('"z"'))
    assert.ok(firstBlock.indexOf('"z"') < firstBlock.indexOf('"custom"'))
    const reparsed = parseUldsNote(rewritten)
    assert.equal(reparsed.layers[0].custom, 'keep-me')
  })

  it('re-appends malformed blocks untouched', () => {
    const note = '<ulds> {broken </ulds>'
    const parsed = parseUldsNote(note)
    const rewritten = writeUldsNote(note, [], parsed.invalidBlocks)
    assert.ok(rewritten.includes('{broken'))
    assert.equal(parseUldsNote(rewritten).invalidBlocks.length, 1)
  })

  it('removes all ulds blocks when layers are empty', () => {
    assert.equal(writeUldsNote('<ulds> {"name":"A","x":0,"y":0} </ulds>', []).trim(), '')
  })
})

describe('static resolvers', () => {
  it('treats plain numbers as screen-fixed coordinates', () => {
    assert.deepEqual(staticUldsCoordinate(120), { space: 'screen', value: 120 })
    assert.deepEqual(staticUldsCoordinate(' -8.5 '), { space: 'screen', value: -8.5 })
  })

  it('resolves this.rx(n) / this.ry(n) as map coordinates', () => {
    assert.deepEqual(staticUldsCoordinate('this.rx(320)'), { space: 'map', value: 320 })
    assert.deepEqual(staticUldsCoordinate('this.ry(-4)'), { space: 'map', value: -4 })
  })

  it('collapses scroll expressions to map coordinate 0', () => {
    assert.deepEqual(staticUldsCoordinate('this.rx(t)'), { space: 'map', value: 0 })
    assert.deepEqual(staticUldsCoordinate('this.ry(-t)'), { space: 'map', value: 0 })
  })

  it('returns null for game-state expressions', () => {
    assert.equal(staticUldsCoordinate('s.value(3)'), null)
    assert.equal(staticUldsCoordinate(undefined), null)
  })

  it('falls back for dynamic numeric fields', () => {
    assert.equal(staticUldsNumber('2.5', 1), 2.5)
    assert.equal(staticUldsNumber('v.value(1)*2', 1), 1)
    assert.equal(staticUldsNumber(undefined, ULDS_DEFAULT_Z), ULDS_DEFAULT_Z)
    assert.equal(staticUldsBoolean('true', false), true)
    assert.equal(staticUldsBoolean(undefined, true), true)
  })

  it('clamps blend modes to the four PIXI modes', () => {
    assert.equal(staticUldsBlendMode(3), 3)
    assert.equal(staticUldsBlendMode(9), 0)
    assert.equal(staticUldsBlendMode('2'), 2)
    assert.equal(staticUldsBlendMode('s.value(4)'), 0)
  })
})
