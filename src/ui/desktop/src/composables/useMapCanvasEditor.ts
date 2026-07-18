import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { TileEdit } from '../api/client';
import type { EditorMode, EditorStatusKind, MapLayerSelection, MapPaintMode, MapTool, PaletteTab, TileTab } from '../components/editor/editorTypes';
import type { ProductLanguage } from '@contract/types';
import { EDITOR_DEFAULT_ZOOM } from './useEditorWorkspaceState';
import {
  AUTOTILE_KINDS,
  REGION_LAYER,
  SHADOW_LAYER,
  TILE_ID_A1,
  drawCheckerboard,
  drawGrid,
  drawMapContent,
  drawTile,
  eventCharacterFrame,
  type MvEvent,
  type MvEventImage,
  type MvMap,
} from './useMapRenderer';
import {
  MV_PALETTE_COLS,
  palettePickForCell,
  paletteRowsForTab,
  tileIdForPalettePreview,
  tileIdToPaletteCell,
  tileTabAvailable,
} from '../utils/mvTilePalette';
import { normalizeProductLanguage, translate, type MessageKey } from '../i18n/messages.ts'

const MAP_MODE_EVENT_OPACITY = 0.35;

type TileChange = TileEdit & { before?: number; after?: number };
type BrushCell = { dx: number; dy: number; tileId?: number; autotileKind?: number; layerTiles?: number[] };
type PaletteCell = { col: number; row: number };
type PaintLayer = 0 | 1 | 2 | 3;
type LayerStackEdit = TileEdit & { kind: 'tile'; layer: PaintLayer; tileId: number };
type Brush =
  | { type: 'autotile'; autotileKind: number; cells: BrushCell[] }
  | { type: 'tile'; tileId: number; cells: BrushCell[] }
  | { type: 'tileRect'; cells: BrushCell[]; width: number; height: number }
  | { type: 'stackRect'; cells: BrushCell[]; width: number; height: number };

export interface PlacementFlashCell {
  x: number;
  y: number;
  until: number;
}

export function buildLayerStackEdits(
  x: number,
  y: number,
  selection: MapLayerSelection,
  layerTiles: readonly number[],
): LayerStackEdit[] {
  if (layerTiles.length < 4) throw new Error('A map layer stack must contain four tile values.');
  const layers: PaintLayer[] = selection === 'auto' ? [0, 1, 2, 3] : [selection];
  return layers.map((layer) => {
    const tileId = Number(layerTiles[layer] || 0);
    return {
      kind: 'tile',
      x,
      y,
      layer,
      tileId,
      preserveAutotileShape: tileId >= TILE_ID_A1,
    };
  });
}

export function buildStackFloodFillEdits(
  map: Pick<MvMap, 'width' | 'height' | 'data'>,
  start: { x: number; y: number },
  layerTiles: readonly number[],
): TileEdit[] {
  if (layerTiles.length < 4) throw new Error('A map layer stack must contain four tile values.');
  if (start.x < 0 || start.y < 0 || start.x >= map.width || start.y >= map.height) return [];
  const layerSize = map.width * map.height;
  const replacement = [0, 1, 2, 3].map((layer) => Number(layerTiles[layer] || 0));
  const stackAt = (x: number, y: number) => [0, 1, 2, 3].map((layer) => Number(map.data[layer * layerSize + y * map.width + x] || 0));
  const target = stackAt(start.x, start.y);
  if (target.every((tileId, layer) => tileId === replacement[layer])) return [];

  const stack = [start];
  const seen = new Set<number>();
  const edits: TileEdit[] = [];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.x < 0 || current.y < 0 || current.x >= map.width || current.y >= map.height) continue;
    const cell = current.y * map.width + current.x;
    if (seen.has(cell)) continue;
    seen.add(cell);
    if (!stackAt(current.x, current.y).every((tileId, layer) => tileId === target[layer])) continue;
    edits.push(...buildLayerStackEdits(current.x, current.y, 'auto', replacement));
    stack.push(
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    );
  }
  return edits;
}

interface CanvasEditorOptions {
  tileSize: Ref<number>;
  parallaxImage: Ref<HTMLImageElement | null>;
  mode: Ref<EditorMode>;
  tool: Ref<MapTool>;
  paintMode: Ref<MapPaintMode>;
  layer: Ref<MapLayerSelection>;
  regionId: Ref<number>;
  shadowBits: Ref<number>;
  showGrid: Ref<boolean>;
  showRegions: Ref<boolean>;
  showTileFlags: Ref<boolean>;
  tileFlags: Ref<number[]>;
  selectedEventId: Ref<number | null>;
  hoveredEventId?: Ref<number | null>;
  busy: Ref<boolean>;
  postTiles: (edits: TileEdit[]) => Promise<{ changedCells: number; changes: TileEdit[] }>;
  reloadMap: () => Promise<void>;
  selectEvent: (eventId: number | null) => void;
  moveEvent: (eventId: number, x: number, y: number) => Promise<void>;
  openEvent: (eventId: number) => void;
  newEvent: (x: number, y: number) => void;
  setStatus: (text: string, kind: EditorStatusKind) => void;
  language?: Ref<ProductLanguage>;
  getCharacterImage?: (name: string) => HTMLImageElement | null;
  placementActive?: Ref<boolean>;
  placementDirection?: Ref<number>;
  getPlacementPreviewImage?: () => MvEventImage | null;
  getPlacementCellValidity?: (x: number, y: number) => { valid: boolean; reason?: string };
  onPlacementClick?: (cell: { x: number; y: number }) => void;
  onPlacementContextMenu?: (event: MouseEvent, cell: { x: number; y: number }) => void;
  onPlacementWheel?: (deltaY: number) => void;
  placementFlash?: Ref<PlacementFlashCell | null>;
}

export function useMapCanvasEditor(options: CanvasEditorOptions) {
  const canvasRef = ref<HTMLCanvasElement>();
  const overlayRef = ref<HTMLCanvasElement>();
  const scrollRef = ref<HTMLDivElement>();
  const canvasWidth = ref(0);
  const canvasHeight = ref(0);
  const zoom = ref(EDITOR_DEFAULT_ZOOM);
  const cursorText = ref('x -, y -');
  const tilesetReady = ref(false);
  const tileTab = ref<TileTab>('A');
  const productLanguage = computed(() => normalizeProductLanguage(options.language?.value));
  const tileSize = computed(() => [16, 24, 32, 48].includes(options.tileSize.value) ? options.tileSize.value : 48);
  const t = (key: MessageKey, params: Record<string, string | number> = {}) => translate(key, productLanguage.value, params)
  const brushInfo = ref(t('mapcanvas.brush.none'));
  const brushSet = ref(false);
  const undoLen = ref(0);
  const redoLen = ref(0);
  const isPanning = ref(false);

  let map: MvMap | null = null;
  let tilesetImages: (HTMLImageElement | null)[] = [];
  let paletteCanvas: HTMLCanvasElement | null = null;
  let brush: Brush | null = null;
  let hoverCell: { x: number; y: number } | null = null;
  let dragStart: { x: number; y: number } | null = null;
  let painting = false;
  let strokeEdits = new Map<string, TileEdit>();
  let shadowStrokeQuadrants = new Set<string>();
  let undoStack: TileChange[][] = [];
  let redoStack: TileChange[][] = [];
  let paletteHoverCell: PaletteCell | null = null;
  let paletteDragStart: PaletteCell | null = null;
  let paletteDragEnd: PaletteCell | null = null;
  let paletteRenderFrame: number | null = null;
  let draggingEvent: { event: MvEvent; originalX: number; originalY: number; moved: boolean } | null = null;
  let panStart: { x: number; y: number; left: number; top: number } | null = null;
  let spacePressed = false;
  let shiftPressed = false;
  let eyedropStart: { x: number; y: number } | null = null;
  let eyedropEnd: { x: number; y: number } | null = null;

  function tileSlotLoaded(slot: number): boolean {
    return Boolean(tilesetImages[slot]);
  }

  const tileTabs = computed<PaletteTab[]>(() => {
    // tilesetReady 是响应式 ref，读取它以建立依赖追踪；
    // 当 setMap 更新 tilesetImages 并修改 tilesetReady 时，此 computed 会自动重新计算
    void tilesetReady.value;
    return (['A', 'B', 'C', 'D', 'E'] as const).map((tab) => ({
      tab,
      label: tab,
      available: tileTabAvailable(tab, tileSlotLoaded),
    }));
  });

  watch([
    options.mode,
    options.showGrid,
    options.showRegions,
    options.showTileFlags,
    options.tileFlags,
    options.selectedEventId,
    options.hoveredEventId,
    options.paintMode,
    options.regionId,
    options.shadowBits,
    options.layer,
    options.placementActive,
    options.placementDirection,
    options.placementFlash,
    options.tileSize,
    options.parallaxImage,
    productLanguage,
  ], () => {
    renderMap();
    renderOverlay();
  });
  watch([options.paintMode, options.regionId, options.shadowBits, productLanguage], updateBrushInfo);
  watch([options.mode, options.paintMode], () => {
    clearPaletteInteraction();
    schedulePaletteRender();
  });
  const activeTileTabAvailable = computed(() => tileTabs.value.some((entry) => entry.tab === tileTab.value && entry.available));

  onMounted(() => {
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);
    window.addEventListener('mouseup', finishPointerInteraction);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('keyup', onWindowKeyUp);
    window.removeEventListener('mouseup', finishPointerInteraction);
    cancelScheduledPaletteRender();
  });

  async function setMap(nextMap: MvMap, _names: string[], images: (HTMLImageElement | null)[], resetHistory = true) {
    map = nextMap;
    clearPaletteInteraction();
    tilesetImages = images;
    tilesetReady.value = images.some(Boolean);
    canvasWidth.value = nextMap.width * tileSize.value;
    canvasHeight.value = nextMap.height * tileSize.value;
    if (!tileTabs.value.some((entry) => entry.tab === tileTab.value && entry.available)) {
      tileTab.value = tileTabs.value.find((entry) => entry.available)?.tab || 'A';
    }
    if (!brush) brush = { type: 'autotile', autotileKind: AUTOTILE_KINDS[0], cells: [{ dx: 0, dy: 0, autotileKind: AUTOTILE_KINDS[0] }] };
    updateBrushInfo();
    if (resetHistory) {
      undoStack = [];
      redoStack = [];
      syncStackLengths();
    }
    await nextTick();
    renderMap();
    renderPalette();
    renderOverlay();
  }
  function replaceMap(nextMap: MvMap) {
    map = nextMap;
    canvasWidth.value = nextMap.width * tileSize.value;
    canvasHeight.value = nextMap.height * tileSize.value;
    renderMap();
    renderOverlay();
  }
  function clearMap() {
    map = null;
    clearPaletteInteraction();
    canvasWidth.value = 0;
    canvasHeight.value = 0;
    renderMap();
    renderOverlay();
  }
  function setPaletteCanvas(canvas: HTMLCanvasElement) {
    paletteCanvas = canvas;
    renderPalette();
  }
  function setCanvasElement(element: unknown) { canvasRef.value = element as HTMLCanvasElement | undefined; }
  function setOverlayElement(element: unknown) { overlayRef.value = element as HTMLCanvasElement | undefined; }
  function setScrollElement(element: unknown) { scrollRef.value = element as HTMLDivElement | undefined; }

  function renderMap() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!map) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const eventMode = options.mode.value === 'event';
    drawMapContent(context, map, {
      tilesetImages,
      parallaxImage: options.parallaxImage.value,
      tileSize: tileSize.value,
      tilesetFlags: options.tileFlags.value,
      showGrid: eventMode || options.showGrid.value,
      showRegions: options.showRegions.value || (options.mode.value === 'map' && options.paintMode.value === 'region'),
      regionOnly: options.mode.value === 'map' && options.paintMode.value === 'region',
      showTileFlags: options.showTileFlags.value,
      activeLayer: options.mode.value === 'map' && options.paintMode.value === 'tile' && options.layer.value !== 'auto'
        ? options.layer.value
        : null,
      eventOpacity: eventMode ? 1 : MAP_MODE_EVENT_OPACITY,
      selectedEventId: eventMode ? options.selectedEventId.value : null,
      hoveredEventId: eventMode ? options.hoveredEventId?.value : null,
      getCharacterImage: options.getCharacterImage,
    });
  }
  function renderOverlay() {
    const canvas = overlayRef.value;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!map) return;

    const flash = options.placementFlash?.value;
    if (flash && flash.until > Date.now()) {
      drawPlacementCellFrame(context, flash.x, flash.y, 'rgba(34, 197, 94, .28)', 'rgba(34, 197, 94, .95)');
    } else if (flash && options.placementFlash) {
      options.placementFlash.value = null;
    }

    if (options.placementActive?.value && hoverCell) {
      const validity = options.getPlacementCellValidity?.(hoverCell.x, hoverCell.y) || { valid: true };
      if (validity.valid) {
        drawPlacementGhost(context, hoverCell.x, hoverCell.y);
        drawPlacementCellFrame(context, hoverCell.x, hoverCell.y, 'rgba(79, 70, 229, .2)', 'rgba(79, 70, 229, .92)');
      } else {
        drawPlacementCellFrame(context, hoverCell.x, hoverCell.y, 'rgba(239, 68, 68, .24)', 'rgba(239, 68, 68, .95)');
      }
      return;
    }

    if (!hoverCell) return;
    const cells = options.mode.value === 'event'
      ? [hoverCell]
      : dragStart && (options.tool.value === 'rect' || options.tool.value === 'ellipse')
        ? regionCells(dragStart, hoverCell, options.tool.value)
        : previewBrushCells(hoverCell.x, hoverCell.y);
    context.save();
    context.fillStyle = options.mode.value === 'event' ? 'rgba(79, 70, 229, .16)' : 'rgba(255, 255, 255, .18)';
    context.strokeStyle = options.mode.value === 'event' ? 'rgba(79, 70, 229, .94)' : 'rgba(255, 230, 89, .96)';
    context.lineWidth = 2;
    for (const cell of cells) {
      if (!inMap(cell.x, cell.y)) continue;
      context.fillRect(cell.x * tileSize.value, cell.y * tileSize.value, tileSize.value, tileSize.value);
      context.strokeRect(cell.x * tileSize.value + 1, cell.y * tileSize.value + 1, tileSize.value - 2, tileSize.value - 2);
    }
    context.restore();
  }

  function drawPlacementCellFrame(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    fill: string,
    stroke: string,
  ) {
    const px = x * tileSize.value;
    const py = y * tileSize.value;
    context.save();
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.fillRect(px, py, tileSize.value, tileSize.value);
    context.strokeRect(px + 1, py + 1, tileSize.value - 2, tileSize.value - 2);
    context.restore();
  }

  function drawPlacementGhost(context: CanvasRenderingContext2D, x: number, y: number) {
    const base = options.getPlacementPreviewImage?.() || {
      tileId: 0,
      characterName: '',
      direction: options.placementDirection?.value ?? 2,
      pattern: 1,
      characterIndex: 0,
    };
    const image: MvEventImage = {
      ...base,
      direction: options.placementDirection?.value ?? base.direction ?? 2,
    };
    const px = x * tileSize.value;
    const py = y * tileSize.value;
    context.save();
    context.globalAlpha = 0.55;
    if (Number(image.tileId) > 0) {
      drawTile(context, tilesetImages, Number(image.tileId), px, py, tileSize.value);
    } else if (image.characterName) {
      const bitmap = options.getCharacterImage?.(image.characterName) || null;
      const frame = bitmap ? eventCharacterFrame(bitmap, image) : null;
      if (bitmap && frame) {
        const dx = Math.round(px + tileSize.value / 2 - frame.sw / 2);
        const dy = Math.round(py + tileSize.value - frame.sh);
        context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, frame.sw, frame.sh);
      } else {
        drawPlacementPlaceholder(context, px, py);
      }
    } else {
      drawPlacementPlaceholder(context, px, py);
    }
    context.restore();
  }

  function drawPlacementPlaceholder(context: CanvasRenderingContext2D, px: number, py: number) {
    const inset = Math.max(2, Math.round(tileSize.value / 5));
    context.fillStyle = 'rgba(99, 102, 241, .42)';
    context.fillRect(px + inset, py + inset, tileSize.value - inset * 2, tileSize.value - inset * 2);
    context.strokeStyle = 'rgba(255, 255, 255, .75)';
    context.lineWidth = 2;
    context.strokeRect(px + inset + 2, py + inset + 2, Math.max(2, tileSize.value - inset * 2 - 4), Math.max(2, tileSize.value - inset * 2 - 4));
    context.fillStyle = 'rgba(255, 255, 255, .9)';
    context.font = `bold ${Math.max(8, Math.min(14, tileSize.value / 3))}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('EV', px + tileSize.value / 2, py + tileSize.value / 2 + 1);
  }
  function renderPalette() {
    cancelScheduledPaletteRender();
    const canvas = paletteCanvas;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!map) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const available = activeTileTabAvailable.value;
    const rows = available ? paletteRowsForTab(tileTab.value) : 4;
    canvas.width = MV_PALETTE_COLS * tileSize.value;
    canvas.height = rows * tileSize.value;
    drawCheckerboard(context, canvas.width, canvas.height);
    if (!available) {
      drawGrid(context, MV_PALETTE_COLS, rows, tileSize.value);
      context.save();
      context.fillStyle = 'rgba(49, 46, 43, .78)';
      context.font = '600 13px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(t('mapcanvas.palette.unconfigured'), canvas.width / 2, canvas.height / 2);
      context.restore();
      return;
    }
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < MV_PALETTE_COLS; col += 1) {
        const pick = palettePickForCell(tileTab.value, col, row, tileSlotLoaded);
        if (!pick) continue;
        drawTile(context, tilesetImages, tileIdForPalettePreview(pick), col * tileSize.value, row * tileSize.value, tileSize.value);
      }
    }
    drawGrid(context, MV_PALETTE_COLS, rows, tileSize.value);
    highlightPaletteHover(context);
    highlightPaletteDrag(context);
    highlightPaletteSelection(context);
  }
  function highlightPaletteHover(context: CanvasRenderingContext2D) {
    if (!paletteHoverCell || paletteDragStart) return;
    const size = tileSize.value;
    const x = paletteHoverCell.col * size;
    const y = paletteHoverCell.row * size;
    context.save();
    context.fillStyle = 'rgba(255, 230, 89, .14)';
    context.strokeStyle = 'rgba(255, 230, 89, .98)';
    context.lineWidth = 2;
    context.fillRect(x, y, size, size);
    context.strokeRect(x + 1, y + 1, Math.max(1, size - 2), Math.max(1, size - 2));
    context.restore();
  }
  function highlightPaletteDrag(context: CanvasRenderingContext2D) {
    if (!paletteDragStart || !paletteDragEnd) return;
    const range = normalizePaletteRange(paletteDragStart, paletteDragEnd);
    const size = tileSize.value;
    const x = range.minCol * size;
    const y = range.minRow * size;
    const width = (range.maxCol - range.minCol + 1) * size;
    const height = (range.maxRow - range.minRow + 1) * size;
    context.save();
    context.fillStyle = 'rgba(79, 70, 229, .18)';
    context.strokeStyle = 'rgba(255, 255, 255, .98)';
    context.lineWidth = 2;
    context.setLineDash([6, 3]);
    context.fillRect(x, y, width, height);
    context.strokeRect(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2));
    context.restore();
  }
  function highlightPaletteSelection(context: CanvasRenderingContext2D) {
    if (!brush) return;
    const places = brush.cells.map((cell) => {
      if (cell.autotileKind != null && tileTab.value === 'A') {
        return tileIdToPaletteCell(TILE_ID_A1 + cell.autotileKind * 48, tileTab.value);
      }
      return cell.tileId == null ? null : tileIdToPaletteCell(cell.tileId, tileTab.value);
    }).filter(Boolean) as { col: number; row: number }[];
    if (!places.length) return;
    const minCol = Math.min(...places.map((place) => place.col));
    const minRow = Math.min(...places.map((place) => place.row));
    const maxCol = Math.max(...places.map((place) => place.col));
    const maxRow = Math.max(...places.map((place) => place.row));
    context.save();
    context.strokeStyle = '#fff';
    context.lineWidth = 3;
    context.strokeRect(minCol * tileSize.value + 1.5, minRow * tileSize.value + 1.5, (maxCol - minCol + 1) * tileSize.value - 3, (maxRow - minRow + 1) * tileSize.value - 3);
    context.strokeStyle = '#111';
    context.lineWidth = 1;
    context.strokeRect(minCol * tileSize.value + 4.5, minRow * tileSize.value + 4.5, Math.max(1, (maxCol - minCol + 1) * tileSize.value - 9), Math.max(1, (maxRow - minRow + 1) * tileSize.value - 9));
    context.restore();
  }

  function selectTileTab(tab: TileTab) {
    tileTab.value = tab;
    clearPaletteInteraction();
    updateBrushInfo();
    renderPalette();
  }
  function onPaletteMouseDown(event: MouseEvent) {
    if (event.button !== 0 || options.mode.value !== 'map' || options.paintMode.value !== 'tile' || !activeTileTabAvailable.value) return;
    const cell = paletteCell(event);
    if (!cell) return;
    paletteHoverCell = cell;
    paletteDragStart = cell;
    paletteDragEnd = cell;
    schedulePaletteRender();
  }
  function onPaletteMouseMove(event: MouseEvent) {
    if (options.mode.value !== 'map' || options.paintMode.value !== 'tile' || !activeTileTabAvailable.value) {
      if (paletteHoverCell || paletteDragStart || paletteDragEnd) {
        clearPaletteInteraction();
        schedulePaletteRender();
      }
      return;
    }
    const cell = paletteCell(event, Boolean(paletteDragStart));
    if (paletteDragStart) {
      if (cell && !samePaletteCell(paletteDragEnd, cell)) {
        paletteDragEnd = cell;
        paletteHoverCell = cell;
        schedulePaletteRender();
      }
      return;
    }
    if (!samePaletteCell(paletteHoverCell, cell)) {
      paletteHoverCell = cell;
      schedulePaletteRender();
    }
  }
  function onPaletteMouseUp() {
    paletteHoverCell = null;
    if (paletteDragStart) {
      finishPaletteSelection();
      return;
    }
    schedulePaletteRender();
  }
  function onPaletteMouseLeave() {
    onPaletteMouseUp();
  }
  function finishPaletteSelection() {
    if (!paletteDragStart || !paletteDragEnd) return;
    const { minCol, maxCol, minRow, maxRow } = normalizePaletteRange(paletteDragStart, paletteDragEnd);
    const cells: BrushCell[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const pick = palettePickForCell(tileTab.value, col, row, tileSlotLoaded);
        if (pick) cells.push({ dx: col - minCol, dy: row - minRow, ...pick });
      }
    }
    if (!cells.length) {
      paletteDragStart = null;
      paletteDragEnd = null;
      renderPalette();
      return;
    }
    options.paintMode.value = 'tile';
    if (cells.length === 1 && cells[0].autotileKind != null) brush = { type: 'autotile', autotileKind: cells[0].autotileKind, cells };
    else if (cells.length === 1) brush = { type: 'tile', tileId: cells[0].tileId || 0, cells };
    else brush = { type: 'tileRect', cells, width: maxCol - minCol + 1, height: maxRow - minRow + 1 };
    paletteDragStart = null;
    paletteDragEnd = null;
    if (options.tool.value === 'eraser') options.tool.value = 'pencil';
    updateBrushInfo();
    renderPalette();
  }
  function paletteCell(event: MouseEvent, clampToBounds = false): PaletteCell | null {
    if (!paletteCanvas || !paletteCanvas.width || !paletteCanvas.height) return null;
    const rect = paletteCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const rawCol = Math.floor((event.clientX - rect.left) * paletteCanvas.width / rect.width / tileSize.value);
    const rawRow = Math.floor((event.clientY - rect.top) * paletteCanvas.height / rect.height / tileSize.value);
    const maxCol = Math.max(0, Math.floor(paletteCanvas.width / tileSize.value) - 1);
    const maxRow = Math.max(0, Math.floor(paletteCanvas.height / tileSize.value) - 1);
    if (!clampToBounds && (rawCol < 0 || rawRow < 0 || rawCol > maxCol || rawRow > maxRow)) return null;
    return {
      col: Math.max(0, Math.min(maxCol, rawCol)),
      row: Math.max(0, Math.min(maxRow, rawRow)),
    };
  }

  function normalizePaletteRange(start: PaletteCell, end: PaletteCell) {
    return {
      minCol: Math.min(start.col, end.col),
      maxCol: Math.max(start.col, end.col),
      minRow: Math.min(start.row, end.row),
      maxRow: Math.max(start.row, end.row),
    };
  }

  function samePaletteCell(left: PaletteCell | null, right: PaletteCell | null): boolean {
    return left?.col === right?.col && left?.row === right?.row;
  }

  function clearPaletteInteraction() {
    paletteHoverCell = null;
    paletteDragStart = null;
    paletteDragEnd = null;
  }

  function schedulePaletteRender() {
    if (paletteRenderFrame != null) return;
    paletteRenderFrame = window.requestAnimationFrame(() => {
      paletteRenderFrame = null;
      renderPalette();
    });
  }

  function cancelScheduledPaletteRender() {
    if (paletteRenderFrame == null) return;
    window.cancelAnimationFrame(paletteRenderFrame);
    paletteRenderFrame = null;
  }

  function canvasCell(event: MouseEvent) {
    const canvas = canvasRef.value;
    if (!canvas || !map) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width / tileSize.value);
    const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height / tileSize.value);
    return inMap(x, y) ? { x, y } : null;
  }
  function eventAtCell(x: number, y: number) { return map?.events?.find((event) => event && event.x === x && event.y === y) || null; }
  function onCanvasMouseDown(event: MouseEvent) {
    if (!map || options.busy.value) return;
    if (event.button === 1 || (event.button === 0 && spacePressed)) {
      const scroll = scrollRef.value;
      if (!scroll) return;
      event.preventDefault();
      isPanning.value = true;
      panStart = { x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop };
      return;
    }
    const cell = canvasCell(event);
    if (!cell) return;
    hoverCell = cell;
    if (event.button === 2 && options.mode.value === 'map' && !options.placementActive?.value) {
      event.preventDefault();
      eyedropStart = cell;
      eyedropEnd = cell;
      renderOverlay();
      return;
    }
    if (event.button !== 0) return;
    if (options.mode.value === 'map' && options.paintMode.value === 'tile' && !activeTileTabAvailable.value) {
      options.setStatus(t('mapcanvas.status.tilePageUnavailable'), 'error');
      return;
    }
    if (options.placementActive?.value) {
      const validity = options.getPlacementCellValidity?.(cell.x, cell.y);
      if (validity?.valid) options.onPlacementClick?.(cell);
      renderOverlay();
      return;
    }
    if (options.mode.value === 'event') {
      const existing = eventAtCell(cell.x, cell.y);
      options.selectEvent(existing?.id ?? null);
      if (existing) draggingEvent = { event: existing, originalX: existing.x, originalY: existing.y, moved: false };
      renderOverlay();
      return;
    }
    if (options.tool.value === 'fill' && options.paintMode.value === 'tile') {
      const edits = floodFillEdits(cell);
      if (edits.length) void commitEdits(edits);
      return;
    }
    if (!toolReady()) {
      options.setStatus(t('mapcanvas.status.selectBrushFirst'), 'error');
      return;
    }
    painting = true;
    dragStart = cell;
    strokeEdits = new Map();
    shadowStrokeQuadrants = new Set();
    if (options.tool.value !== 'rect' && options.tool.value !== 'ellipse') applyToolAt(cell.x, cell.y, event);
    renderOverlay();
  }
  function onCanvasMouseMove(event: MouseEvent) {
    if (isPanning.value && panStart && scrollRef.value) {
      scrollRef.value.scrollLeft = panStart.left - (event.clientX - panStart.x);
      scrollRef.value.scrollTop = panStart.top - (event.clientY - panStart.y);
      return;
    }
    const cell = canvasCell(event);
    hoverCell = cell;
    cursorText.value = cell ? `x ${cell.x}, y ${cell.y}` : 'x -, y -';
    if (eyedropStart && cell && options.mode.value === 'map') {
      eyedropEnd = cell;
    } else if (options.placementActive?.value) {
      renderOverlay();
      return;
    }
    if (draggingEvent && cell && options.mode.value === 'event') {
      if (draggingEvent.event.x !== cell.x || draggingEvent.event.y !== cell.y) {
        draggingEvent.event.x = cell.x;
        draggingEvent.event.y = cell.y;
        draggingEvent.moved = true;
        renderMap();
      }
    } else if (painting && cell && options.mode.value === 'map' && options.tool.value !== 'rect' && options.tool.value !== 'ellipse') applyToolAt(cell.x, cell.y, event);
    renderOverlay();
  }
  function onCanvasMouseLeave() {
    hoverCell = null;
    cursorText.value = 'x -, y -';
    renderOverlay();
  }
  function onCanvasDoubleClick(event: MouseEvent) {
    if (options.mode.value !== 'event') return;
    const cell = canvasCell(event);
    if (!cell) return;
    const existing = eventAtCell(cell.x, cell.y);
    if (existing) options.openEvent(existing.id);
    else options.newEvent(cell.x, cell.y);
  }
  function onCanvasWheel(event: WheelEvent) {
    if (options.placementActive?.value) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        options.onPlacementWheel?.(event.deltaY);
        renderOverlay();
      }
      // 普通滚轮交给 .canvas-scroll 原生滚动，便于查看放大后地图四周留白
      return;
    }
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom.value + (event.deltaY < 0 ? .25 : -.25));
  }
  async function finishPointerInteraction() {
    if (isPanning.value) {
      isPanning.value = false;
      panStart = null;
    }
    if (draggingEvent) {
      const drag = draggingEvent;
      draggingEvent = null;
      if (drag.moved) {
        try { await options.moveEvent(drag.event.id, drag.event.x, drag.event.y); }
        catch {
          drag.event.x = drag.originalX;
          drag.event.y = drag.originalY;
          renderMap();
        }
      }
    }
    if (eyedropStart) {
      const from = eyedropStart;
      const to = eyedropEnd || from;
      eyedropStart = null;
      eyedropEnd = null;
      pickMapRange(from, to);
      renderOverlay();
    }
    if (!painting) return;
    painting = false;
    if (dragStart && hoverCell && (options.tool.value === 'rect' || options.tool.value === 'ellipse')) {
      for (const cell of regionCells(dragStart, hoverCell, options.tool.value)) applyToolAt(cell.x, cell.y);
    }
    dragStart = null;
    shadowStrokeQuadrants = new Set();
    const edits = [...strokeEdits.values()];
    strokeEdits = new Map();
    if (edits.length) await commitEdits(edits);
    renderOverlay();
  }

  function previewBrushCells(x: number, y: number) {
    if (options.paintMode.value !== 'tile' || options.tool.value === 'eraser' || options.tool.value === 'fill') return [{ x, y }];
    return brush?.cells.map((cell) => ({ x: x + cell.dx, y: y + cell.dy })) || [{ x, y }];
  }
  function regionCells(from: { x: number; y: number }, to: { x: number; y: number }, tool: MapTool) {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const cells: { x: number; y: number }[] = [];
    if (tool !== 'ellipse') {
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) cells.push({ x, y });
      return cells;
    }
    const rx = Math.max(.5, (maxX - minX + 1) / 2);
    const ry = Math.max(.5, (maxY - minY + 1) / 2);
    const cx = minX + rx - .5;
    const cy = minY + ry - .5;
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) cells.push({ x, y });
    return cells;
  }
  function applyToolAt(x: number, y: number, event?: MouseEvent) {
    if (options.mode.value !== 'map') return;
    if (options.paintMode.value === 'shadow') {
      const value = event && (options.tool.value === 'pencil' || options.tool.value === 'eraser')
        ? shadowValueFromPointer(x, y, event)
        : options.tool.value === 'eraser' ? 0 : clampInt(options.shadowBits.value, 0, 15);
      return pushEdit(x, y, SHADOW_LAYER, { kind: 'shadow', shadowBits: value }, value);
    }
    if (options.paintMode.value === 'region') {
      const value = options.tool.value === 'eraser' ? 0 : clampInt(options.regionId.value, 0, 255);
      return pushEdit(x, y, REGION_LAYER, { kind: 'region', regionId: value }, value);
    }
    if (options.tool.value === 'eraser') return pushEdit(x, y, options.layer.value, { kind: 'tile', tileId: 0 }, 0);
    for (const cell of brush?.cells || []) {
      if (cell.layerTiles) {
        for (const edit of buildLayerStackEdits(x + cell.dx, y + cell.dy, options.layer.value, cell.layerTiles)) {
          pushEdit(edit.x, edit.y, edit.layer, edit, edit.tileId);
        }
        continue;
      }
      const exactAutotile = cell.autotileKind != null && shiftPressed;
      const payload = cell.autotileKind != null && !exactAutotile
        ? { kind: 'autotile' as const, autotileKind: cell.autotileKind }
        : { kind: 'tile' as const, tileId: cell.tileId ?? (TILE_ID_A1 + (cell.autotileKind || 0) * 48), preserveAutotileShape: exactAutotile };
      const optimistic = cell.autotileKind != null ? TILE_ID_A1 + cell.autotileKind * 48 : cell.tileId || 0;
      pushEdit(x + cell.dx, y + cell.dy, options.layer.value, payload, optimistic);
    }
  }
  function pushEdit(x: number, y: number, layer: MapLayerSelection | number, payload: Partial<TileEdit>, tileId: number) {
    if (!map || !inMap(x, y)) return;
    strokeEdits.set(`${x},${y},${layer}`, { x, y, layer, ...payload });
    if (typeof layer === 'number') map.data[layer * map.width * map.height + y * map.width + x] = tileId;
    renderMap();
  }

  function pickMapRange(from: { x: number; y: number }, to: { x: number; y: number }) {
    if (!map) return;
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxX = Math.max(from.x, to.x);
    const maxY = Math.max(from.y, to.y);
    const cells: BrushCell[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (options.layer.value === 'auto') {
          cells.push({ dx: x - minX, dy: y - minY, layerTiles: [0, 1, 2, 3].map((layer) => map!.data[layer * map!.width * map!.height + y * map!.width + x] || 0) });
          continue;
        }
        const tileId = map.data[options.layer.value * map.width * map.height + y * map.width + x] || 0;
        const autotileKind = !shiftPressed && tileId >= TILE_ID_A1 ? Math.floor((tileId - TILE_ID_A1) / 48) : undefined;
        cells.push({ dx: x - minX, dy: y - minY, tileId, ...(autotileKind === undefined ? {} : { autotileKind }) });
      }
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (options.layer.value === 'auto') brush = { type: 'stackRect', cells, width, height };
    else if (cells.length === 1 && cells[0].autotileKind != null) brush = { type: 'autotile', autotileKind: cells[0].autotileKind, cells };
    else if (cells.length === 1) brush = { type: 'tile', tileId: cells[0].tileId || 0, cells };
    else brush = { type: 'tileRect', cells, width, height };
    options.paintMode.value = 'tile';
    if (options.tool.value === 'eraser') options.tool.value = 'pencil';
    updateBrushInfo();
  }
  function shadowValueFromPointer(x: number, y: number, event: MouseEvent) {
    const bit = shadowQuadrantBit(event);
    if (!map || !bit) return options.tool.value === 'eraser' ? 0 : clampInt(options.shadowBits.value, 0, 15);
    const key = `${x},${y},${bit}`;
    const index = SHADOW_LAYER * map.width * map.height + y * map.width + x;
    const current = clampInt(map.data[index] || 0, 0, 15);
    if (shadowStrokeQuadrants.has(key)) return current;
    shadowStrokeQuadrants.add(key);
    return options.tool.value === 'eraser' ? (current & ~bit) : (current ^ bit);
  }
  function shadowQuadrantBit(event: MouseEvent) {
    const canvas = canvasRef.value;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * canvas.width / rect.width;
    const py = (event.clientY - rect.top) * canvas.height / rect.height;
    const localX = ((px % tileSize.value) + tileSize.value) % tileSize.value;
    const localY = ((py % tileSize.value) + tileSize.value) % tileSize.value;
    if (localY < tileSize.value / 2) return localX < tileSize.value / 2 ? 1 : 2;
    return localX < tileSize.value / 2 ? 4 : 8;
  }
  function floodFillEdits(start: { x: number; y: number }) {
    if (!map || !toolReady()) return [];
    const cell = brush?.cells[0];
    if (options.layer.value === 'auto' && options.tool.value !== 'eraser' && cell?.layerTiles) {
      return buildStackFloodFillEdits(map, start, cell.layerTiles);
    }
    const layer = activeEditLayer();
    const base = layer * map.width * map.height;
    const target = map.data[base + start.y * map.width + start.x] || 0;
    const replacement = activeReplacementValue();
    if (target === replacement) return [];
    const stack = [start];
    const seen = new Set<string>();
    const edits: TileEdit[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      const key = `${current.x},${current.y}`;
      if (seen.has(key) || !inMap(current.x, current.y) || (map.data[base + current.y * map.width + current.x] || 0) !== target) continue;
      seen.add(key);
      edits.push(activeEditPayload(current.x, current.y));
      stack.push({ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 });
    }
    return edits;
  }
  async function commitEdits(edits: TileEdit[]) {
    if (options.mode.value !== 'map') {
      options.setStatus(t('mapcanvas.status.eventModeNoTiles'), 'error');
      return;
    }
    options.busy.value = true;
    options.setStatus(t('mapcanvas.status.stagingPaint'), 'busy');
    try {
      const report = await options.postTiles(edits);
      if (report.changes?.length) {
        undoStack.push(report.changes as TileChange[]);
        if (undoStack.length > 80) undoStack.shift();
        redoStack = [];
        syncStackLengths();
      }
      await options.reloadMap();
      options.setStatus(t('mapcanvas.status.stagedCells', { count: report.changedCells }), 'saved');
    } catch (error) {
      options.setStatus(t('mapcanvas.status.stageFailed', { message: (error as Error).message }), 'error');
      await options.reloadMap();
    } finally { options.busy.value = false; }
  }
  async function undo() { await replayHistory('undo'); }
  async function redo() { await replayHistory('redo'); }
  async function replayHistory(kind: 'undo' | 'redo') {
    if (options.mode.value !== 'map' || options.busy.value) return;
    const source = kind === 'undo' ? undoStack : redoStack;
    if (!source.length) return;
    const changes = source.pop()!;
    syncStackLengths();
    options.busy.value = true;
    options.setStatus(kind === 'undo' ? t('mapcanvas.status.undoing') : t('mapcanvas.status.redoing'), 'busy');
    try {
      await options.postTiles(changes.map((change) => changeToEdit(change, kind === 'undo' ? change.before ?? 0 : change.after ?? 0)));
      (kind === 'undo' ? redoStack : undoStack).push(changes);
      syncStackLengths();
      await options.reloadMap();
      options.setStatus(kind === 'undo' ? t('mapcanvas.status.undone') : t('mapcanvas.status.redone'), 'saved');
    } catch (error) {
      const message = (error as Error).message;
      options.setStatus(kind === 'undo' ? t('mapcanvas.status.undoFailed', { message }) : t('mapcanvas.status.redoFailed', { message }), 'error');
    } finally { options.busy.value = false; }
  }

  function toolReady() { return options.paintMode.value !== 'tile' || (activeTileTabAvailable.value && (options.tool.value === 'eraser' || Boolean(brush))); }
  function activeEditLayer() {
    if (options.paintMode.value === 'shadow') return SHADOW_LAYER;
    if (options.paintMode.value === 'region') return REGION_LAYER;
    if (options.layer.value !== 'auto') return options.layer.value;
    const cell = brush?.cells[0];
    if (cell?.layerTiles) return 0;
    if (cell?.autotileKind != null) {
      const kind = cell.autotileKind;
      return kind >= 16 && kind < 48 && (kind - 16) % 8 >= 4 ? 1 : 0;
    }
    const tileId = cell?.tileId || 0;
    if (tileId > 0 && tileId < 1024 && map) {
      const size = map.width * map.height;
      const index = (hoverCell?.y || 0) * map.width + (hoverCell?.x || 0);
      return map.data[3 * size + index] ? 3 : 2;
    }
    return 0;
  }
  function activeReplacementValue() {
    if (options.tool.value === 'eraser') return 0;
    if (options.paintMode.value === 'shadow') return clampInt(options.shadowBits.value, 0, 15);
    if (options.paintMode.value === 'region') return clampInt(options.regionId.value, 0, 255);
    const cell = brush?.cells[0];
    if (cell?.layerTiles && options.layer.value !== 'auto') return Number(cell.layerTiles[options.layer.value] || 0);
    return cell?.autotileKind != null ? TILE_ID_A1 + cell.autotileKind * 48 : cell?.tileId || 0;
  }
  function activeEditPayload(x: number, y: number): TileEdit {
    if (options.paintMode.value === 'shadow') {
      return { kind: 'shadow', x, y, layer: SHADOW_LAYER, shadowBits: options.tool.value === 'eraser' ? 0 : clampInt(options.shadowBits.value, 0, 15) };
    }
    if (options.paintMode.value === 'region') {
      return { kind: 'region', x, y, layer: REGION_LAYER, regionId: options.tool.value === 'eraser' ? 0 : clampInt(options.regionId.value, 0, 255) };
    }
    if (options.tool.value === 'eraser') return { kind: 'tile', x, y, layer: options.layer.value, tileId: 0 };
    const cell = brush?.cells[0];
    if (cell?.layerTiles && options.layer.value !== 'auto') {
      const tileId = Number(cell.layerTiles[options.layer.value] || 0);
      return { kind: 'tile', x, y, layer: options.layer.value, tileId, preserveAutotileShape: tileId >= TILE_ID_A1 };
    }
    return { x, y, layer: options.layer.value, ...(cell?.autotileKind != null ? { kind: 'autotile' as const, autotileKind: cell.autotileKind } : { kind: 'tile' as const, tileId: cell?.tileId || 0 }) };
  }
  function changeToEdit(change: TileChange, value: number): TileEdit {
    const layer = Number(change.layer ?? 0);
    if (layer === SHADOW_LAYER) return { kind: 'shadow', x: change.x, y: change.y, layer: SHADOW_LAYER, shadowBits: clampInt(value, 0, 15) };
    if (layer === REGION_LAYER) return { kind: 'region', x: change.x, y: change.y, layer: REGION_LAYER, regionId: clampInt(value, 0, 255) };
    return { kind: 'tile', x: change.x, y: change.y, layer, tileId: value };
  }
  function inMap(x: number, y: number) { return Boolean(map) && x >= 0 && y >= 0 && x < map!.width && y < map!.height; }
  function updateBrushInfo() {
    if (options.paintMode.value === 'shadow') {
      const value = clampInt(options.shadowBits.value, 0, 15);
      brushInfo.value = t('mapcanvas.brush.shadow', { value });
      brushSet.value = true;
    } else if (options.paintMode.value === 'region') {
      const value = clampInt(options.regionId.value, 0, 255);
      brushInfo.value = t('mapcanvas.brush.region', { value });
      brushSet.value = true;
    } else if (!activeTileTabAvailable.value) {
      brushInfo.value = '';
      brushSet.value = false;
    } else if (!brush) {
      brushInfo.value = t('mapcanvas.brush.none');
      brushSet.value = false;
    } else if (brush.type === 'tileRect' || brush.type === 'stackRect') {
      brushInfo.value = t('mapcanvas.brush.rect', { width: brush.width, height: brush.height });
      brushSet.value = true;
    } else {
      brushInfo.value = brush.type === 'autotile'
        ? t('mapcanvas.brush.autotile', { kind: brush.autotileKind })
        : t('mapcanvas.brush.tile', { id: brush.tileId });
      brushSet.value = true;
    }
  }
  function syncStackLengths() { undoLen.value = undoStack.length; redoLen.value = redoStack.length; }
  function setZoom(value: number) { zoom.value = Math.max(.25, Math.min(2, Math.round(value * 4) / 4)); }
  function clampInt(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  function zoomIn() { setZoom(zoom.value + .25); }
  function zoomOut() { setZoom(zoom.value - .25); }
  function resetZoom() { zoom.value = EDITOR_DEFAULT_ZOOM; }
  function onWindowKeyDown(event: KeyboardEvent) {
    if (event.code === 'Space' && !isFormTarget(event.target)) spacePressed = true;
    if (event.key === 'Shift') shiftPressed = true;
  }
  function onWindowKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') spacePressed = false;
    if (event.key === 'Shift') shiftPressed = false;
  }
  function isFormTarget(target: EventTarget | null) { return ['INPUT', 'TEXTAREA', 'SELECT'].includes((target as HTMLElement | null)?.tagName || ''); }

  function getPlacementCell(): { x: number; y: number } | null {
    if (hoverCell) return { x: hoverCell.x, y: hoverCell.y };
    if (!map) return null;
    return { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  }

  return {
    canvasRef, overlayRef, scrollRef, canvasWidth, canvasHeight, zoom, cursorText, tilesetReady, tileTab, tileTabs,
    brushInfo, brushSet, undoLen, redoLen, isPanning,
    setMap, replaceMap, clearMap, setPaletteCanvas, setCanvasElement, setOverlayElement, setScrollElement, selectTileTab, canvasCell, eventAtCell,
    onPaletteMouseDown, onPaletteMouseMove, onPaletteMouseUp, onPaletteMouseLeave,
    onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasDoubleClick, onCanvasWheel,
    renderMap, renderOverlay, zoomIn, zoomOut, resetZoom, setZoom, undo, redo, getPlacementCell,
  };
}
