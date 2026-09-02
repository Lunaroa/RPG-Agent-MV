import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEmptyTileLayer,
  parseMapTileLayersNote,
  writeMapTileLayersNote,
} from './map-tile-layers.ts'

describe('parseMapTileLayersNote', () => {
  it('parses a single layer block', () => {
    const result = parseMapTileLayersNote('<tileLayers>{"name":"roof","tiles":[0,2816,0,0]}</tileLayers>')
    assert.equal(result.layers.length, 1)
    assert.equal(result.layers[0].name, 'roof')
    assert.deepEqual(result.layers[0].tiles, [0, 2816, 0, 0])
    assert.deepEqual(result.invalidBlocks, [])
  })

  it('merges multiple blocks in note order and keeps surrounding text', () => {
    const note = [
      'before',
      '<tileLayers>{"name":"A","tiles":[1]}</tileLayers>',
      '<tileLayers>{"name":"B","tiles":[2]}</tileLayers>',
      'after',
    ].join('\n')
    const result = parseMapTileLayersNote(note)
    assert.deepEqual(result.layers.map((layer) => layer.name), ['A', 'B'])
  })

  it('keeps malformed blocks verbatim instead of failing', () => {
    const note = '<tileLayers>{"name":oops}</tileLayers>\n<tileLayers>{"name":"ok","tiles":[5]}</tileLayers>'
    const result = parseMapTileLayersNote(note)
    assert.equal(result.layers.length, 1)
    assert.equal(result.layers[0].name, 'ok')
    assert.deepEqual(result.invalidBlocks, ['{"name":oops}'])
  })

  it('rejects blocks without a tiles array', () => {
    const result = parseMapTileLayersNote('<tileLayers>{"name":"noTiles"}</tileLayers>')
    assert.equal(result.layers.length, 0)
    assert.equal(result.invalidBlocks.length, 1)
  })

  it('normalizes non-integer and negative tile ids to empty cells', () => {
    const result = parseMapTileLayersNote('<tileLayers>{"name":"n","tiles":[1.5,-3,"7",2816,null]}</tileLayers>')
    assert.deepEqual(result.layers[0].tiles, [0, 0, 7, 2816, 0])
  })
})

describe('writeMapTileLayersNote', () => {
  it('round-trips layers while preserving other note content', () => {
    const note = 'keep me\n<tileLayers>{"name":"old","tiles":[1]}</tileLayers>\n<ulds> {"name":"U"} </ulds>'
    const written = writeMapTileLayersNote(note, [
      { name: 'roof', tiles: [0, 2816], extra: 'kept' },
    ])
    assert.ok(written.startsWith('keep me\n'))
    assert.ok(written.includes('<ulds> {"name":"U"} </ulds>'))
    const reparsed = parseMapTileLayersNote(written)
    assert.equal(reparsed.layers.length, 1)
    assert.equal(reparsed.layers[0].name, 'roof')
    assert.deepEqual(reparsed.layers[0].tiles, [0, 2816])
    assert.equal(reparsed.layers[0].extra, 'kept')
  })

  it('re-appends invalid blocks verbatim', () => {
    const written = writeMapTileLayersNote('', [{ name: 'A', tiles: [1] }], ['{"name":oops}'])
    const reparsed = parseMapTileLayersNote(written)
    assert.equal(reparsed.layers.length, 1)
    assert.deepEqual(reparsed.invalidBlocks, ['{"name":oops}'])
  })

  it('drops the blocks entirely when no layers remain', () => {
    const written = writeMapTileLayersNote('text\n<tileLayers>{"name":"A","tiles":[1]}</tileLayers>', [])
    assert.equal(written, 'text')
  })
})

describe('createEmptyTileLayer', () => {
  it('fills a width*height grid with empty cells', () => {
    const layer = createEmptyTileLayer('L', 3, 2)
    assert.equal(layer.name, 'L')
    assert.deepEqual(layer.tiles, [0, 0, 0, 0, 0, 0])
  })
})
