import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodePng, renderMapToPng } from "./map-render.ts";

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
