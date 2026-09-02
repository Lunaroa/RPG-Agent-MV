import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodePng, renderMapToFittedRgba, renderMapToPng } from "./map-render.ts";
import { buildExtendedTilesetDescriptors } from "../../../../../contract/extended-tileset.ts";

describe("map renderer engine dimensions", () => {
  for (const tileSize of [16, 24, 32, 48] as const) {
    test(`renders four map layers and autotiles at ${tileSize}px`, () => {
      const autotileBitmap = solidBitmap(tileSize * 16, tileSize * 18, [24, 96, 168, 255]);
      const normalBitmap = solidBitmap(tileSize * 16, tileSize * 16, [210, 120, 30, 255]);
      const bitmaps: Array<{ width: number; height: number; rgba: Buffer } | null> = Array.from(
        { length: 9 },
        () => null,
      );
      bitmaps[0] = autotileBitmap;
      bitmaps[5] = normalBitmap;

      const rendered = renderMapToPng(
        {
          width: 2,
          height: 1,
          tilesetId: 1,
          data: [2048, 1, 0, 1, 0, 1, 0, 1],
        },
        bitmaps,
        1,
        tileSize,
      );

      assert.equal(rendered.width, tileSize * 2);
      assert.equal(rendered.height, tileSize);
      assert.equal(rendered.drawnTiles, 5);

      const decoded = decodePng(rendered.png);
      assert.equal(decoded.width, tileSize * 2);
      assert.equal(decoded.height, tileSize);
      assert.deepEqual(Array.from(decoded.rgba.subarray(0, 4)), [24, 96, 168, 255]);
      assert.deepEqual(Array.from(decoded.rgba.subarray(tileSize * 4, tileSize * 4 + 4)), [210, 120, 30, 255]);
    });
  }
});

test("renders a large map directly into the bounded thumbnail buffer", () => {
  const rendered = renderMapToFittedRgba(
    { width: 300, height: 200, tilesetId: 1, data: [] },
    Array.from({ length: 9 }, () => null),
    720,
    432,
  );

  assert.equal(rendered.rgba.length, 720 * 432 * 4);
  assert.equal(rendered.contentWidth, 648);
  assert.equal(rendered.contentHeight, 432);
  assert.equal(rendered.offsetX, 36);
  assert.equal(rendered.offsetY, 0);
});

test("renders normal, A5, and A1-A4 extended sheets from their declared slots", () => {
  const types = ['A1', 'A2', 'A3', 'A4', 'A5', 'normal'] as const;
  const names = [...Array(9).fill(''), ...types.map((type) => `Extra${type}`)];
  const descriptors = buildExtendedTilesetDescriptors(names, types);
  const colors = [
    [220, 20, 40, 255],
    [255, 140, 0, 255],
    [240, 220, 20, 255],
    [40, 180, 80, 255],
    [40, 110, 220, 255],
    [150, 70, 190, 255],
  ] as const;
  const bitmaps: Array<ReturnType<typeof solidBitmap> | null> = Array.from({ length: names.length }, () => null);
  descriptors.forEach((descriptor, index) => {
    bitmaps[descriptor.slotIndex] = solidBitmap(768, 768, colors[index]);
  });
  const data = Array(6 * 4).fill(0);
  descriptors.forEach((descriptor, index) => { data[index] = descriptor.firstTileId; });

  const rendered = decodePng(renderMapToPng({
    width: 6,
    height: 1,
    tilesetId: 1,
    data,
    extendedTilesetSheets: descriptors,
  }, bitmaps, 1, 48).png);

  colors.forEach((color, index) => {
    const offset = index * 48 * 4;
    assert.deepEqual(Array.from(rendered.rgba.subarray(offset, offset + 4)), color);
  });
});

test("renders the lower edge of an extended A2 table tile", () => {
  const names = [...Array(9).fill(''), 'ExtraA2'];
  const descriptors = buildExtendedTilesetDescriptors(names, ['A2']);
  const descriptor = descriptors[0];
  const bitmaps: Array<ReturnType<typeof solidBitmap> | null> = Array.from({ length: names.length }, () => null);
  bitmaps[descriptor.slotIndex] = solidBitmap(768, 576, [35, 180, 95, 255]);
  const flags = Array(descriptor.firstTileId + descriptor.capacity).fill(0);
  flags[descriptor.firstTileId] = 0x80;
  const data = Array(8).fill(0);
  data[2] = descriptor.firstTileId;

  const rendered = decodePng(renderMapToPng({
    width: 1,
    height: 2,
    tilesetId: 1,
    data,
    tilesetFlags: flags,
    extendedTilesetSheets: descriptors,
  }, bitmaps, 1, 48, { transparent: true }).png);

  const lowerCellTop = 48 * rendered.width * 4;
  assert.deepEqual(Array.from(rendered.rgba.subarray(lowerCellTop, lowerCellTop + 4)), [35, 180, 95, 255]);
  const lowerCellMiddle = (60 * rendered.width) * 4;
  assert.deepEqual(Array.from(rendered.rgba.subarray(lowerCellMiddle, lowerCellMiddle + 4)), [0, 0, 0, 0]);
});

function solidBitmap(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): { width: number; height: number; rgba: Buffer } {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
  }
  return { width, height, rgba };
}
