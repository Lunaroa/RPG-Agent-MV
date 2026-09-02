import type { RpgMakerEngine } from '../../../../contract/types.ts';

export const UNLIMITED_TILESETS_PLUGIN_NAME = 'RPGAgentUnlimitedTilesets';
export const UNLIMITED_TILESETS_PLUGIN_VERSION = '1.0.0';

const COMMON_RUNTIME = String.raw`
  'use strict';
  var FIRST_ID = 8192;
  var CAPACITY = { A1: 768, A2: 1536, A3: 1536, A4: 2304, A5: 128, normal: 256 };

  function sheets() {
    var tileset = $gameMap && $gameMap.tileset ? $gameMap.tileset() : null;
    if (!tileset) return [];
    var names = Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames : [];
    var types = Array.isArray(tileset.rpgAgentExtendedTilesetTypes)
      ? tileset.rpgAgentExtendedTilesetTypes : [];
    var result = [];
    var firstId = FIRST_ID;
    for (var slot = 9; slot < names.length; slot++) {
      var type = types[slot - 9] || 'normal';
      var capacity = CAPACITY[type];
      if (!capacity) throw new Error('RPGAgentUnlimitedTilesets: invalid sheet type ' + type);
      result.push({ slot: slot, type: type, firstId: firstId, capacity: capacity });
      firstId += capacity;
    }
    return result;
  }

  function descriptor(tileId) {
    var list = sheets();
    for (var index = 0; index < list.length; index++) {
      var item = list[index];
      if (tileId >= item.firstId && tileId < item.firstId + item.capacity) return item;
    }
    return null;
  }

  function tileInfo(tileId) {
    var item = descriptor(tileId);
    if (!item) return null;
    var localId = tileId - item.firstId;
    return { item: item, localId: localId, kind: Math.floor(localId / 48), shape: localId % 48 };
  }

  function normalSource(info, tileWidth, tileHeight) {
    var localId = info.localId;
    if (info.item.type === 'A5') {
      return { sx: localId % 8 * tileWidth, sy: Math.floor(localId / 8) * tileHeight };
    }
    return {
      sx: (Math.floor(localId / 128) % 2 * 8 + localId % 8) * tileWidth,
      sy: (Math.floor((localId % 256) / 8) % 16) * tileHeight
    };
  }

  function autotileSource(info) {
    var kind = info.kind;
    var tx = kind % 8;
    var ty = Math.floor(kind / 8);
    var bx = 0;
    var by = 0;
    var table = Tilemap.FLOOR_AUTOTILE_TABLE;
    var frame = Math.floor(this.animationFrame || 0);
    if (info.item.type === 'A1') {
      var waterSurfaceIndex = [0, 1, 2, 1][frame % 4];
      if (kind === 0) { bx = waterSurfaceIndex * 2; by = 0; }
      else if (kind === 1) { bx = waterSurfaceIndex * 2; by = 3; }
      else if (kind === 2) { bx = 6; by = 0; }
      else if (kind === 3) { bx = 6; by = 3; }
      else {
        bx = Math.floor(tx / 4) * 8;
        by = ty * 6 + Math.floor(tx / 2) % 2 * 3;
        if (kind % 2 === 0) bx += waterSurfaceIndex * 2;
        else { bx += 6; by += frame % 3; table = Tilemap.WATERFALL_AUTOTILE_TABLE; }
      }
    } else if (info.item.type === 'A2') {
      bx = tx * 2; by = ty * 3;
    } else if (info.item.type === 'A3') {
      bx = tx * 2; by = ty * 2; table = Tilemap.WALL_AUTOTILE_TABLE;
    } else if (info.item.type === 'A4') {
      bx = tx * 2;
      by = Math.floor(ty * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
      if (ty % 2 === 1) table = Tilemap.WALL_AUTOTILE_TABLE;
    }
    return { bx: bx, by: by, table: table };
  }

  function patchTileClassifiers() {
    var originalA1 = Tilemap.isTileA1;
    var originalA2 = Tilemap.isTileA2;
    var originalA3 = Tilemap.isTileA3;
    var originalA4 = Tilemap.isTileA4;
    var originalA5 = Tilemap.isTileA5;
    var originalAutotile = Tilemap.isAutotile;
    Tilemap.isTileA1 = function(id) { var d = descriptor(id); return d ? d.type === 'A1' : originalA1.call(this, id); };
    Tilemap.isTileA2 = function(id) { var d = descriptor(id); return d ? d.type === 'A2' : originalA2.call(this, id); };
    Tilemap.isTileA3 = function(id) { var d = descriptor(id); return d ? d.type === 'A3' : originalA3.call(this, id); };
    Tilemap.isTileA4 = function(id) { var d = descriptor(id); return d ? d.type === 'A4' : originalA4.call(this, id); };
    Tilemap.isTileA5 = function(id) { var d = descriptor(id); return d ? d.type === 'A5' : originalA5.call(this, id); };
    Tilemap.isAutotile = function(id) {
      var d = descriptor(id);
      return d ? d.type === 'A1' || d.type === 'A2' || d.type === 'A3' || d.type === 'A4' : originalAutotile.call(this, id);
    };
  }

  function extendedEventBitmap(tileId) {
    var info = tileInfo(tileId);
    if (!info) return null;
    var names = $gameMap.tileset().tilesetNames || [];
    var source = ImageManager.loadTileset(names[info.item.slot]);
    var width = $gameMap.tileWidth();
    var height = $gameMap.tileHeight();
    var animationFrame = Math.floor((Graphics.frameCount || 0) / 30);
    var key = String(names[info.item.slot] || '') + ':' + info.item.type + ':' + info.item.firstId
      + ':' + width + 'x' + height + ':' + tileId
      + ':' + (info.item.type === 'A1' ? animationFrame % 12 : 0);
    extendedEventBitmap.cache = extendedEventBitmap.cache || {};
    if (extendedEventBitmap.cache[key]) return extendedEventBitmap.cache[key];
    var bitmap = new Bitmap(width, height);
    function render() {
      if (info.item.type === 'normal' || info.item.type === 'A5') {
        var normal = normalSource(info, width, height);
        bitmap.blt(source, normal.sx, normal.sy, width, height, 0, 0);
      } else {
        var auto = autotileSource.call({ animationFrame: animationFrame, flags: $gameMap.tilesetFlags() }, info);
        var quarters = auto.table[info.shape];
        var halfW = width / 2;
        var halfH = height / 2;
        for (var index = 0; index < 4; index++) {
          var qsx = (auto.bx * 2 + quarters[index][0]) * halfW;
          var qsy = (auto.by * 2 + quarters[index][1]) * halfH;
          bitmap.blt(source, qsx, qsy, halfW, halfH, index % 2 * halfW, Math.floor(index / 2) * halfH);
        }
      }
    }
    if (source.isReady()) render();
    else source.addLoadListener(render);
    extendedEventBitmap.cache[key] = bitmap;
    return bitmap;
  }

  var originalUpdateTileFrame = Sprite_Character.prototype.updateTileFrame;
  Sprite_Character.prototype.updateTileFrame = function() {
    if (this._tileId >= FIRST_ID) {
      var bitmap = extendedEventBitmap(this._tileId);
      if (bitmap) { this.bitmap = bitmap; this.setFrame(0, 0, $gameMap.tileWidth(), $gameMap.tileHeight()); return; }
    }
    originalUpdateTileFrame.call(this);
  };
`;

const MV_ADAPTER = String.raw`
  function drawExtendedCanvas(bitmap, tileId, dx, dy) {
    var info = tileInfo(tileId);
    if (!info) return false;
    var source = this.bitmaps[info.item.slot];
    if (!source) return true;
    var width = this._tileWidth;
    var height = this._tileHeight;
    if (info.item.type === 'normal' || info.item.type === 'A5') {
      var normal = normalSource(info, width, height);
      bitmap.blt(source, normal.sx, normal.sy, width, height, dx, dy);
      return true;
    }
    var auto = autotileSource.call(this, info);
    var quarters = auto.table[info.shape];
    var halfW = width / 2;
    var halfH = height / 2;
    for (var index = 0; index < 4; index++) {
      var qsx = (auto.bx * 2 + quarters[index][0]) * halfW;
      var qsy = (auto.by * 2 + quarters[index][1]) * halfH;
      bitmap.blt(source, qsx, qsy, halfW, halfH, dx + index % 2 * halfW, dy + Math.floor(index / 2) * halfH);
    }
    return true;
  }

  function drawExtendedTableEdge(bitmap, tileId, dx, dy) {
    var info = tileInfo(tileId);
    if (!info || info.item.type !== 'A2') return false;
    var source = this.bitmaps[info.item.slot];
    if (!source) return true;
    var width = this._tileWidth;
    var height = this._tileHeight;
    var auto = autotileSource.call(this, info);
    var quarters = auto.table[info.shape];
    var halfW = width / 2;
    var halfH = height / 2;
    for (var index = 0; index < 2; index++) {
      var quarter = quarters[2 + index];
      bitmap.blt(source, (auto.bx * 2 + quarter[0]) * halfW,
        (auto.by * 2 + quarter[1]) * halfH + halfH / 2,
        halfW, halfH / 2, dx + index * halfW, dy, halfW, halfH / 2);
    }
    return true;
  }

  var originalDrawTile = Tilemap.prototype._drawTile;
  Tilemap.prototype._drawTile = function(bitmap, tileId, dx, dy) {
    if (tileId >= FIRST_ID && drawExtendedCanvas.call(this, bitmap, tileId, dx, dy)) return;
    originalDrawTile.call(this, bitmap, tileId, dx, dy);
  };

  var originalDrawTableEdge = Tilemap.prototype._drawTableEdge;
  Tilemap.prototype._drawTableEdge = function(bitmap, tileId, dx, dy) {
    if (tileId >= FIRST_ID && drawExtendedTableEdge.call(this, bitmap, tileId, dx, dy)) return;
    originalDrawTableEdge.call(this, bitmap, tileId, dx, dy);
  };

  if (typeof ShaderTilemap !== 'undefined') {
    var originalShaderDrawTile = ShaderTilemap.prototype._drawTile;
    ShaderTilemap.prototype._drawTile = function(layer, tileId, dx, dy) {
      var info = tileInfo(tileId);
      if (!info) return originalShaderDrawTile.call(this, layer, tileId, dx, dy);
      var width = this._tileWidth;
      var height = this._tileHeight;
      if (info.item.type === 'normal' || info.item.type === 'A5') {
        var normal = normalSource(info, width, height);
        layer.addRect(info.item.slot, normal.sx, normal.sy, dx, dy, width, height);
        return;
      }
      var auto = autotileSource.call(this, info);
      var quarters = auto.table[info.shape];
      var halfW = width / 2;
      var halfH = height / 2;
      for (var index = 0; index < 4; index++) {
        layer.addRect(info.item.slot, (auto.bx * 2 + quarters[index][0]) * halfW,
          (auto.by * 2 + quarters[index][1]) * halfH,
          dx + index % 2 * halfW, dy + Math.floor(index / 2) * halfH, halfW, halfH);
      }
    };
    var originalShaderDrawTableEdge = ShaderTilemap.prototype._drawTableEdge;
    ShaderTilemap.prototype._drawTableEdge = function(layer, tileId, dx, dy) {
      var info = tileInfo(tileId);
      if (!info || info.item.type !== 'A2') return originalShaderDrawTableEdge.call(this, layer, tileId, dx, dy);
      var width = this._tileWidth;
      var height = this._tileHeight;
      var auto = autotileSource.call(this, info);
      var quarters = auto.table[info.shape];
      var halfW = width / 2;
      var halfH = height / 2;
      for (var index = 0; index < 2; index++) {
        var quarter = quarters[2 + index];
        layer.addRect(info.item.slot, (auto.bx * 2 + quarter[0]) * halfW,
          (auto.by * 2 + quarter[1]) * halfH + halfH / 2,
          dx + index * halfW, dy, halfW, halfH / 2);
      }
    };
  }
`;

const MZ_ADAPTER = String.raw`
  var originalAddTile = Tilemap.prototype._addTile;
  Tilemap.prototype._addTile = function(layer, tileId, dx, dy) {
    var info = tileInfo(tileId);
    if (!info) return originalAddTile.call(this, layer, tileId, dx, dy);
    var width = this.tileWidth;
    var height = this.tileHeight;
    if (info.item.type === 'normal' || info.item.type === 'A5') {
      var normal = normalSource(info, width, height);
      layer.addRect(info.item.slot, normal.sx, normal.sy, dx, dy, width, height);
      return;
    }
    var auto = autotileSource.call(this, info);
    var quarters = auto.table[info.shape];
    var halfW = width / 2;
    var halfH = height / 2;
    for (var index = 0; index < 4; index++) {
      layer.addRect(info.item.slot, (auto.bx * 2 + quarters[index][0]) * halfW,
        (auto.by * 2 + quarters[index][1]) * halfH,
        dx + index % 2 * halfW, dy + Math.floor(index / 2) * halfH, halfW, halfH);
    }
  };

  var originalAddTableEdge = Tilemap.prototype._addTableEdge;
  Tilemap.prototype._addTableEdge = function(layer, tileId, dx, dy) {
    var info = tileInfo(tileId);
    if (!info || info.item.type !== 'A2') return originalAddTableEdge.call(this, layer, tileId, dx, dy);
    var width = this.tileWidth;
    var height = this.tileHeight;
    var auto = autotileSource.call(this, info);
    var quarters = auto.table[info.shape];
    var halfW = width / 2;
    var halfH = height / 2;
    for (var index = 0; index < 2; index++) {
      var quarter = quarters[2 + index];
      layer.addRect(info.item.slot, (auto.bx * 2 + quarter[0]) * halfW,
        (auto.by * 2 + quarter[1]) * halfH + halfH / 2,
        dx + index * halfW, dy, halfW, halfH / 2);
    }
  };
`;

export function buildUnlimitedTilesetsRuntimePlugin(engine: RpgMakerEngine): string {
  const target = engine === 'rpg-maker-mz' ? 'MZ' : 'MV';
  const adapter = engine === 'rpg-maker-mz' ? MZ_ADAPTER : MV_ADAPTER;
  return `/*:\n * @target ${target}\n * @plugindesc RPG Agent Unlimited Tilesets ${UNLIMITED_TILESETS_PLUGIN_VERSION}\n * @author RPG Agent\n * @help\n * Managed by RPG Agent. Do not edit this file directly.\n * Protocol version: ${UNLIMITED_TILESETS_PLUGIN_VERSION}\n */\n\n(function() {\n${COMMON_RUNTIME}\n  patchTileClassifiers();\n${adapter}\n})();\n`;
}
