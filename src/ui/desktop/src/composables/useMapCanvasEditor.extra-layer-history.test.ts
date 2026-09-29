import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ref, shallowRef } from 'vue';

import { createEmptyTileLayer } from '@contract/map-tile-layers';
import type { RpgMakerEngine } from '../../../../contract/types.ts';
import {
  extraLayerSelection,
  type EditorMode,
  type MapLayerSelection,
  type MapPaintMode,
  type MapTool,
} from '../components/editor/editorTypes.ts';
import type { MvMap, UldsDrawLayer } from './useMapRenderer.ts';
import { useMapCanvasEditor, type PlacementFlashCell } from './useMapCanvasEditor.ts';

async function createEditor() {
  const layers = shallowRef([
    createEmptyTileLayer('A', 1, 1),
    createEmptyTileLayer('B', 1, 1),
  ]);
  layers.value[1].tiles[0] = 13;
  const selectedLayer = ref<MapLayerSelection>(extraLayerSelection(0));
  let saves = 0;
  const editor = useMapCanvasEditor({
    tileSize: ref(48),
    parallaxImage: ref<HTMLImageElement | null>(null),
    uldsLayers: ref<UldsDrawLayer[]>([]),
    extraTileLayers: layers,
    saveExtraTileLayers: async () => { saves += 1; },
    engine: ref<RpgMakerEngine>('rpg-maker-mv'),
    tilesetMode: ref<number | null>(1),
    mode: ref<EditorMode>('map'),
    tool: ref<MapTool>('fill'),
    paintMode: ref<MapPaintMode>('tile'),
    layer: selectedLayer,
    regionId: ref(1),
    showGrid: ref(false),
    showRegions: ref(false),
    showTileFlags: ref(false),
    tileFlags: ref<number[]>([]),
    selectedEventId: ref<number | null>(null),
    hoveredEventId: ref<number | null>(null),
    busy: ref(false),
    placementActive: ref(false),
    placementDirection: ref(2),
    placementFlash: ref<PlacementFlashCell | null>(null),
    postTiles: async () => { throw new Error('Unexpected stock-layer write'); },
    reloadMap: async () => {},
    selectEvent: () => {},
    moveEvent: async () => {},
    openEvent: () => {},
    newEvent: () => {},
    setStatus: () => {},
  });
  await editor.setMap({ width: 1, height: 1, data: new Array(6).fill(0), events: [] } as unknown as MvMap, [], [{} as HTMLImageElement]);
  editor.canvasRef.value = {
    width: 48,
    height: 48,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 48, height: 48 }),
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  return { editor, layers, selectedLayer, get saves() { return saves; } };
}

async function paintFirstLayer(editor: ReturnType<typeof useMapCanvasEditor>) {
  editor.onCanvasMouseDown({ button: 0, clientX: 24, clientY: 24 } as MouseEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('extra tile layer history after structural deletion', () => {
  test('does not replay a deleted A stroke into B on undo or redo', async () => {
    const fixture = await createEditor();
    const { editor, layers, selectedLayer } = fixture;
    await paintFirstLayer(editor);
    assert.equal(editor.undoLen.value, 1);
    assert.ok(layers.value[0].tiles[0] > 0);
    assert.equal(layers.value[1].tiles[0], 13);

    editor.invalidateExtraLayerHistory();
    layers.value = layers.value.filter((_, index) => index !== 0);
    selectedLayer.value = extraLayerSelection(0);
    assert.equal(editor.undoLen.value, 0);
    assert.equal(editor.redoLen.value, 0);

    const savesBeforeReplay = fixture.saves;
    await editor.undo();
    await editor.redo();
    assert.equal(layers.value[0].tiles[0], 13);
    assert.equal(fixture.saves, savesBeforeReplay);
  });

  test('clears redo for A before B moves into A’s old index', async () => {
    const fixture = await createEditor();
    const { editor, layers } = fixture;
    await paintFirstLayer(editor);
    await editor.undo();
    assert.equal(editor.redoLen.value, 1);

    editor.invalidateExtraLayerHistory();
    layers.value = layers.value.slice(1);
    assert.equal(editor.redoLen.value, 0);
    const savesBeforeReplay = fixture.saves;
    await editor.redo();
    assert.equal(layers.value[0].tiles[0], 13);
    assert.equal(fixture.saves, savesBeforeReplay);
  });

  test('editor deletion invalidates history before removing the layer', () => {
    const source = readFileSync(new URL('../views/EditorView.vue', import.meta.url), 'utf8');
    const deletion = source.match(/async function removeExtraTileLayer\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0];
    assert.ok(deletion);
    assert.match(deletion, /canvasEditor\.invalidateExtraLayerHistory\(\);[\s\S]*?extraTileLayers\.value = extraTileLayers\.value\.filter/);
  });
});
