import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MV_TILESET_FLAG_BITS,
  applyMvTilesetFlagEdit,
  inspectMvTilesetFlagCell,
  mvTilesetFlagCell,
  mvTilesetSheet,
  nextMvTilesetPassage,
  nextMvTilesetTerrainTag,
} from './rmmvTilesetFlags.ts';

describe('RPG Maker MV tileset flag editing', () => {
  test('maps normal B-E sheet cells to RPG Maker MV tile IDs', () => {
    assert.equal(mvTilesetFlagCell('B', 0, 0).representativeTileId, 0);
    assert.equal(mvTilesetFlagCell('B', 0, 8).representativeTileId, 128);
    assert.equal(mvTilesetFlagCell('B', 1, 0).representativeTileId, 8);
    assert.equal(mvTilesetFlagCell('E', 15, 15).representativeTileId, 1023);
    assert.equal(mvTilesetFlagCell('A5', 15, 7).representativeTileId, 1663);
  });

  test('maps each autotile palette cell to all 48 shape flags', () => {
    const firstA1 = mvTilesetFlagCell('A1', 0, 0);
    const lastA4 = mvTilesetFlagCell('A4', 5, 7);

    assert.equal(firstA1.tileIds.length, 48);
    assert.deepEqual(firstA1.tileIds, Array.from({ length: 48 }, (_, index) => 2048 + index));
    assert.equal(lastA4.tileIds[0], 8144);
    assert.equal(lastA4.tileIds[47], 8191);
  });

  test('rejects cells outside the fixed MV sheet layout', () => {
    assert.throws(() => mvTilesetFlagCell('A1', 2, 0), /outside/i);
    assert.throws(() => mvTilesetFlagCell('B', 0, 16), /outside/i);
  });

  test('cycles passage in MV order and excludes star from A sheets', () => {
    assert.equal(nextMvTilesetPassage('passable', true, false), 'blocked');
    assert.equal(nextMvTilesetPassage('blocked', true, false), 'star');
    assert.equal(nextMvTilesetPassage('star', true, false), 'passable');
    assert.equal(nextMvTilesetPassage('passable', true, true), 'star');
    assert.equal(nextMvTilesetPassage('blocked', false, false), 'passable');
    assert.equal(nextMvTilesetPassage('passable', false, true), 'blocked');
  });

  test('applies passage to every autotile shape without changing unrelated bits', () => {
    const cell = mvTilesetFlagCell('A2', 0, 0);
    const flags = new Array(8192).fill(0);
    flags[cell.tileIds[0]] = MV_TILESET_FLAG_BITS.ladder | (5 << 12) | 0x200;

    const next = applyMvTilesetFlagEdit(flags, cell, { kind: 'passage', value: 'blocked' });

    assert.equal(next[cell.tileIds[0]], MV_TILESET_FLAG_BITS.passageMask | MV_TILESET_FLAG_BITS.ladder | (5 << 12) | 0x200);
    assert.ok(cell.tileIds.every((tileId) => (Number(next[tileId]) & MV_TILESET_FLAG_BITS.passageMask) === MV_TILESET_FLAG_BITS.passageMask));
    assert.equal(flags[cell.tileIds[1]], 0);
  });

  test('enforces MV star and four-direction sheet restrictions', () => {
    const a1 = mvTilesetFlagCell('A1', 0, 0);
    const bTopLeft = mvTilesetFlagCell('B', 0, 0);
    const flags = new Array(8192).fill(0);

    assert.throws(() => applyMvTilesetFlagEdit(flags, a1, { kind: 'passage', value: 'star' }), /B-E/i);
    assert.throws(() => applyMvTilesetFlagEdit(flags, a1, { kind: 'direction', bit: MV_TILESET_FLAG_BITS.up, blocked: true }), /autotile/i);
    assert.throws(() => applyMvTilesetFlagEdit(flags, bTopLeft, { kind: 'passage', value: 'blocked' }), /fixed/i);
    assert.equal(
      Number(applyMvTilesetFlagEdit(flags, bTopLeft, { kind: 'passage', value: 'star' })[0]) & MV_TILESET_FLAG_BITS.star,
      MV_TILESET_FLAG_BITS.star,
    );
  });

  test('edits direction and marker bits independently', () => {
    const cell = mvTilesetFlagCell('A5', 0, 0);
    const flags = new Array(1664).fill(0);
    const directional = applyMvTilesetFlagEdit(flags, cell, { kind: 'direction', bit: MV_TILESET_FLAG_BITS.left, blocked: true });
    const ladder = applyMvTilesetFlagEdit(directional, cell, { kind: 'marker', bit: MV_TILESET_FLAG_BITS.ladder, enabled: true });
    const reopened = applyMvTilesetFlagEdit(ladder, cell, { kind: 'direction', bit: MV_TILESET_FLAG_BITS.left, blocked: false });

    assert.equal(Number(directional[cell.representativeTileId]) & MV_TILESET_FLAG_BITS.left, MV_TILESET_FLAG_BITS.left);
    assert.equal(Number(ladder[cell.representativeTileId]) & MV_TILESET_FLAG_BITS.ladder, MV_TILESET_FLAG_BITS.ladder);
    assert.equal(Number(reopened[cell.representativeTileId]) & MV_TILESET_FLAG_BITS.left, 0);
    assert.equal(Number(reopened[cell.representativeTileId]) & MV_TILESET_FLAG_BITS.ladder, MV_TILESET_FLAG_BITS.ladder);
  });

  test('cycles terrain tags from 0 through 7 in both directions', () => {
    assert.equal(nextMvTilesetTerrainTag(7, false), 0);
    assert.equal(nextMvTilesetTerrainTag(0, true), 7);

    const cell = mvTilesetFlagCell('C', 0, 0);
    const flags = new Array(512).fill(0);
    flags[cell.representativeTileId] = MV_TILESET_FLAG_BITS.damage | 0x800;
    const next = applyMvTilesetFlagEdit(flags, cell, { kind: 'terrain', value: 6 });

    assert.equal((Number(next[cell.representativeTileId]) >> 12) & 0x0f, 6);
    assert.equal(Number(next[cell.representativeTileId]) & MV_TILESET_FLAG_BITS.damage, MV_TILESET_FLAG_BITS.damage);
    assert.equal(Number(next[cell.representativeTileId]) & 0x800, 0x800);
  });

  test('reports mixed autotile values instead of hiding inconsistent data', () => {
    const cell = mvTilesetFlagCell('A3', 0, 0);
    const flags = new Array(8192).fill(0);
    flags[cell.tileIds[1]] = MV_TILESET_FLAG_BITS.ladder;

    const state = inspectMvTilesetFlagCell(flags, cell);

    assert.equal(state.passage, 'passable');
    assert.equal(state.ladder, 'mixed');
    assert.equal(state.terrainTag, 0);
    assert.equal(mvTilesetSheet('A3').directionalEditable, false);
  });
});
