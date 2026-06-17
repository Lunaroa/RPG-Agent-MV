/**
 * RPG Maker MV floor-autotile resolver.
 *
 * Why this exists: A1/A2 ground tiles are autotiles. Each autotile "kind"
 * owns 48 consecutive tile IDs; the editor picks one of those 48 sub-tiles
 * ("shape") per cell based on which of the 8 neighbours share the same kind.
 * Writing a fixed sub-tile ID from outside the editor freezes one shape, so a
 * flood renders as isolated checkerboard squares (see prior
 * post-mortems). This module reproduces the editor's neighbour resolver so
 * cartographer can paint ground regions by intent and still get correct
 * borders, corners and transitions.
 *
 * Algorithm: FLOOR_AUTOTILE_TABLE (copied verbatim from rpg_core.js) maps a
 * shape index to the 4 source quarter-tiles. Each quarter-tile coordinate is
 * a stable code for one corner state (interior / inner-corner / N-edge /
 * W-edge / outer-corner). We classify each of a cell's 4 corners from its
 * neighbours, assemble the 4 quarter-tile coordinates, and look the shape
 * back up. Off-map neighbours count as the same kind, matching how the MV
 * editor leaves no border at the map edge.
 *
 * Scope: MV A1-A4 autotiles. Floor-type autotiles use the 48-shape floor
 * table, A1 waterfall tiles use the 4-shape waterfall table, and A3/A4 wall
 * tiles use the 16-shape wall table.
 */

interface NeighbourConnectivity {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  ne: boolean;
  se: boolean;
  sw: boolean;
  nw: boolean;
}

interface CornerPiece {
  interior: number[];
  inner: number[];
  edgeV?: number[];
  edgeH?: number[];
  outer: number[];
}

const TILE_ID_A1 = 2048;
const TILE_ID_A2 = 2816;
const TILE_ID_A3 = 4352;
const TILE_ID_A4 = 5888;
const TILE_ID_MAX = 8192;

type AutotileTab = "A1" | "A2" | "A3" | "A4" | "unknown";
type AutotileResolveStrategy = "floor" | "waterfall" | "wall" | "out-of-range";

interface AutotileKindClassification {
  kind: number;
  tab: AutotileTab;
  localKind: number | null;
  strategy: AutotileResolveStrategy;
  supported: boolean;
  reason?: string;
}

// Verbatim from RPG Maker MV's Tilemap.FLOOR_AUTOTILE_TABLE.
const FLOOR_AUTOTILE_TABLE = [
  [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]],
  [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
  [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]],
  [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
  [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]],
  [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
  [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]],
  [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
  [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]],
  [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]],
  [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
  [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]],
  [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
  [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]],
  [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]],
  [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]],
  [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
  [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]],
  [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]],
  [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]]
];

// Verbatim from rpg_core.js - Tilemap.WALL_AUTOTILE_TABLE.
const WALL_AUTOTILE_TABLE = [
  [[2, 2], [1, 2], [2, 1], [1, 1]], [[0, 2], [1, 2], [0, 1], [1, 1]],
  [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[2, 2], [3, 2], [2, 1], [3, 1]], [[0, 2], [3, 2], [0, 1], [3, 1]],
  [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [1, 3]],
  [[2, 0], [1, 0], [2, 3], [1, 3]], [[0, 0], [1, 0], [0, 3], [1, 3]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[0, 2], [3, 2], [0, 3], [3, 3]],
  [[2, 0], [3, 0], [2, 3], [3, 3]], [[0, 0], [3, 0], [0, 3], [3, 3]]
];

// Verbatim from rpg_core.js - Tilemap.WATERFALL_AUTOTILE_TABLE.
const WATERFALL_AUTOTILE_TABLE = [
  [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]]
];

// Inverse lookup: "qx,qy|qx,qy|qx,qy|qx,qy" -> shape index.
const SHAPE_BY_QUADS: Record<string, number> = {};
FLOOR_AUTOTILE_TABLE.forEach((quads, shape) => {
  const key = quads.map((p) => p[0] + "," + p[1]).join("|");
  if (!(key in SHAPE_BY_QUADS)) SHAPE_BY_QUADS[key] = shape;
});

// Quarter-tile source coordinates per corner state, derived from the table
// structure (see header). Each corner has up to 5 states.
const TL = { interior: [2, 4], inner: [2, 0], edgeW: [0, 4], edgeN: [2, 2], outer: [0, 2] };
const TR = { interior: [1, 4], inner: [3, 0], edgeE: [3, 4], edgeN: [1, 2], outer: [3, 2] };
const BL = { interior: [2, 3], inner: [2, 1], edgeW: [0, 3], edgeS: [2, 5], outer: [0, 5] };
const BR = { interior: [1, 3], inner: [3, 1], edgeE: [3, 3], edgeS: [1, 5], outer: [3, 5] };

// edgeV = the edge piece used when the vertical neighbour (N or S) is missing.
// edgeH = the edge piece used when the horizontal neighbour (E or W) is missing.
function cornerPiece(piece: CornerPiece, vertical: boolean, horizontal: boolean, diagonal: boolean): number[] {
  if (vertical && horizontal) return diagonal ? piece.interior : piece.inner;
  if (vertical && !horizontal) return piece.edgeH!;
  if (!vertical && horizontal) return piece.edgeV!;
  return piece.outer;
}

/**
 * Resolve the floor-autotile shape (0-47) for one cell.
 *
 * @param {object} nb 8-neighbour connectivity, true = same autotile kind.
 *   Keys: n, e, s, w, ne, se, sw, nw.
 * @returns {number} shape index into FLOOR_AUTOTILE_TABLE.
 */
function floorAutotileShape(nb: NeighbourConnectivity): number {
  const tl = cornerPiece({ interior: TL.interior, inner: TL.inner, edgeV: TL.edgeN, edgeH: TL.edgeW, outer: TL.outer }, nb.n, nb.w, nb.nw);
  const tr = cornerPiece({ interior: TR.interior, inner: TR.inner, edgeV: TR.edgeN, edgeH: TR.edgeE, outer: TR.outer }, nb.n, nb.e, nb.ne);
  const bl = cornerPiece({ interior: BL.interior, inner: BL.inner, edgeV: BL.edgeS, edgeH: BL.edgeW, outer: BL.outer }, nb.s, nb.w, nb.sw);
  const br = cornerPiece({ interior: BR.interior, inner: BR.inner, edgeV: BR.edgeS, edgeH: BR.edgeE, outer: BR.outer }, nb.s, nb.e, nb.se);
  const key = [tl, tr, bl, br].map((p) => p[0] + "," + p[1]).join("|");
  const shape = SHAPE_BY_QUADS[key];
  if (shape === undefined) {
    throw new Error("Autotile shape not found for neighbours " + JSON.stringify(nb));
  }
  return shape;
}

function wallAutotileShape(nb: Pick<NeighbourConnectivity, "n" | "e" | "s" | "w">): number {
  return (nb.w ? 0 : 1) + (nb.n ? 0 : 2) + (nb.e ? 0 : 4) + (nb.s ? 0 : 8);
}

function waterfallAutotileShape(nb: Pick<NeighbourConnectivity, "e" | "w">): number {
  return (nb.w ? 0 : 1) + (nb.e ? 0 : 2);
}

function classifyAutotileKind(kind: number): AutotileKindClassification {
  if (!Number.isInteger(kind) || kind < 0 || kind >= (TILE_ID_MAX - TILE_ID_A1) / 48) {
    return {
      kind,
      tab: "unknown",
      localKind: null,
      strategy: "out-of-range",
      supported: false,
      reason: "autotile kind is outside RPG Maker MV A1-A4 range."
    };
  }
  if (kind < (TILE_ID_A2 - TILE_ID_A1) / 48) {
    const waterfall = kind >= 4 && kind % 2 === 1;
    return {
      kind,
      tab: "A1",
      localKind: kind,
      strategy: waterfall ? "waterfall" : "floor",
      supported: true
    };
  }
  if (kind < (TILE_ID_A3 - TILE_ID_A1) / 48) {
    return {
      kind,
      tab: "A2",
      localKind: kind - (TILE_ID_A2 - TILE_ID_A1) / 48,
      strategy: "floor",
      supported: true
    };
  }
  if (kind < (TILE_ID_A4 - TILE_ID_A1) / 48) {
    return {
      kind,
      tab: "A3",
      localKind: kind - (TILE_ID_A3 - TILE_ID_A1) / 48,
      strategy: "wall",
      supported: true
    };
  }

  const row = Math.floor(kind / 8);
  const floorRow = row % 2 === 0;
  return {
    kind,
    tab: "A4",
    localKind: kind - (TILE_ID_A4 - TILE_ID_A1) / 48,
    strategy: floorRow ? "floor" : "wall",
    supported: true
  };
}

function isFloorAutotileKind(kind: number): boolean {
  return classifyAutotileKind(kind).strategy === "floor";
}

function isSupportedAutotileKind(kind: number): boolean {
  return classifyAutotileKind(kind).supported;
}

function autotileTab(kind: number): string {
  return classifyAutotileKind(kind).tab;
}

function makeAutotileId(kind: number, shape: number): number {
  return TILE_ID_A1 + kind * 48 + shape;
}

/**
 * Resolve one map layer of floor autotiles.
 *
 * @param {Int32Array|number[]} kindGrid length width*height; cell value is an
 *   autotile kind (>= 0) or -1 for "no autotile here".
 * @param {number} width
 * @param {number} height
 * @returns {number[]} tileId per cell; -1 cells map to 0 (caller keeps its
 *   own non-autotile tile there instead).
 */
function resolveFloorLayer(kindGrid: Int32Array | number[], width: number, height: number): number[] {
  const out: number[] = new Array(width * height).fill(0);
  const same = (x: number, y: number, kind: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true; // off-map = connected
    return kindGrid[y * width + x] === kind;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const kind = kindGrid[y * width + x];
      if (kind < 0) continue;
      const nb = {
        n: same(x, y - 1, kind),
        e: same(x + 1, y, kind),
        s: same(x, y + 1, kind),
        w: same(x - 1, y, kind),
        ne: same(x + 1, y - 1, kind),
        se: same(x + 1, y + 1, kind),
        sw: same(x - 1, y + 1, kind),
        nw: same(x - 1, y - 1, kind)
      };
      out[y * width + x] = makeAutotileId(kind, floorAutotileShape(nb));
    }
  }
  return out;
}

function resolveAutotileLayer(kindGrid: Int32Array | number[], width: number, height: number): number[] {
  const out: number[] = new Array(width * height).fill(0);
  const same = (x: number, y: number, kind: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    return kindGrid[y * width + x] === kind;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const kind = kindGrid[y * width + x];
      if (kind < 0) continue;
      const classification = classifyAutotileKind(kind);
      if (!classification.supported) continue;
      const nb = {
        n: same(x, y - 1, kind),
        e: same(x + 1, y, kind),
        s: same(x, y + 1, kind),
        w: same(x - 1, y, kind),
        ne: same(x + 1, y - 1, kind),
        se: same(x + 1, y + 1, kind),
        sw: same(x - 1, y + 1, kind),
        nw: same(x - 1, y - 1, kind)
      };
      let shape: number;
      if (classification.strategy === "floor") {
        shape = floorAutotileShape(nb);
      } else if (classification.strategy === "wall") {
        shape = wallAutotileShape(nb);
      } else if (classification.strategy === "waterfall") {
        shape = waterfallAutotileShape(nb);
      } else {
        throw new Error(`Autotile kind ${kind} is not supported: ${classification.reason || classification.strategy}`);
      }
      out[y * width + x] = makeAutotileId(kind, shape);
    }
  }
  return out;
}

/**
 * Total-function check: every one of the 256 neighbour bit patterns must
 * resolve to a shape present in FLOOR_AUTOTILE_TABLE. Throws on any gap.
 */
function selfTest(): { neighbourPatternsResolved: number } {
  let resolved = 0;
  for (let mask = 0; mask < 256; mask += 1) {
    const nb = {
      n: !!(mask & 1), e: !!(mask & 2), s: !!(mask & 4), w: !!(mask & 8),
      ne: !!(mask & 16), se: !!(mask & 32), sw: !!(mask & 64), nw: !!(mask & 128)
    };
    const shape = floorAutotileShape(nb);
    if (shape < 0 || shape > 47) throw new Error("selfTest: bad shape " + shape);
    resolved += 1;
  }
  // A fully surrounded cell must be the interior shape 0.
  if (floorAutotileShape({ n: true, e: true, s: true, w: true, ne: true, se: true, sw: true, nw: true }) !== 0) {
    throw new Error("selfTest: interior cell did not resolve to shape 0");
  }
  if (wallAutotileShape({ n: true, e: true, s: true, w: true }) !== 0) {
    throw new Error("selfTest: wall interior cell did not resolve to shape 0");
  }
  if (waterfallAutotileShape({ e: true, w: true }) !== 0) {
    throw new Error("selfTest: waterfall interior cell did not resolve to shape 0");
  }
  return { neighbourPatternsResolved: resolved };
}

export {
  type NeighbourConnectivity,
  type CornerPiece,
  type AutotileKindClassification,
  type AutotileResolveStrategy,
  type AutotileTab,
  FLOOR_AUTOTILE_TABLE,
  WALL_AUTOTILE_TABLE,
  WATERFALL_AUTOTILE_TABLE,
  floorAutotileShape,
  wallAutotileShape,
  waterfallAutotileShape,
  resolveFloorLayer,
  resolveAutotileLayer,
  classifyAutotileKind,
  isFloorAutotileKind,
  isSupportedAutotileKind,
  autotileTab,
  makeAutotileId,
  selfTest
};
