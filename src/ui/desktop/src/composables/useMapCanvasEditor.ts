import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { TileEdit } from '../api/client';
import type { EditorMode, EditorStatusKind, MapLayerSelection, MapPaintMode, MapTool, PaletteTab, PaletteTabId, TileTab } from '../components/editor/editorTypes';
import type { ProductLanguage, RpgMakerEngine } from '../../../../contract/types.ts';
import {
  applyRmmvMapBrushEdits,
  RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
} from '../../../../contract/rmmv-map-brush.ts';
import { EDITOR_DEFAULT_ZOOM } from './useEditorWorkspaceState';
import {
  AUTOTILE_KINDS,
  REGION_LAYER,
  SHADOW_LAYER,
  TILE_ID_A1,
  drawCheckerboard,
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
  type PaletteCell,
} from '../utils/mvTilePalette';
import {
  buildPaletteRectSelection,
  paletteSelectionButton,
  paletteSelectionReleaseMatches,
  type PaletteSelectionButton,
} from '../utils/tilePaletteSelection';
import {
  brushPathPatternPlacements,
  brushDragRect,
  brushOriginAt,
  brushRectAt,
  normalizeInclusiveCellRect,
  patternPlacements,
  rasterMapCellLine,
  type InclusiveCellRect,
  type RectBrushFootprint,
} from '../utils/mapCopyBrush';
import {
  drawMvRegionLabel,
  drawMvRegionMarker,
  MV_REGION_PALETTE_COLS,
  MV_REGION_PALETTE_ROWS,
  paintModeForPaletteTab,
  regionIdForPaletteCell,
  regionPaletteLayout,
  regionPaletteCellForId,
  shouldShowRegionOverlay,
  tileTabForShadow,
  visibleRegionViewport,
} from '../utils/mvRegionPalette';
import {
  rasterShadowQuarterLine,
  shadowQuarterAtCanvasPoint,
  shadowQuarterStrokeEdits,
  shadowStrokeAction,
  type ShadowQuarterPoint,
  type ShadowStrokeAction,
} from '../utils/shadowPen';
import { normalizeProductLanguage, translate, type MessageKey } from '../i18n/messages.ts'

const MAP_MODE_EVENT_OPACITY = 0.35;

type TileChange = TileEdit & { before?: number; after?: number };
type BrushCell = {
  dx: number;
  dy: number;
  tileId?: number;
  autotileKind?: number;
  preserveAutotileShape?: boolean;
  layerStack?: LayerBrushSample[];
};
type PaintLayer = 0 | 1 | 2 | 3;
export type LayerBrushSample = {
  tileId: number;
  autotileKind?: number;
  preserveAutotileShape?: boolean;
};
export type MapCanvasBrush =
  | { type: 'autotile'; autotileKind: number; cells: BrushCell[] }
  | { type: 'tile'; tileId: number; cells: BrushCell[] }
  | { type: 'tileRect'; cells: BrushCell[]; width: number; height: number; hotspotX: number; hotspotY: number }
  | { type: 'stackRect'; cells: BrushCell[]; width: number; height: number; hotspotX: number; hotspotY: number };

export interface PlacementFlashCell {
  x: number;
  y: number;
  until: number;
}

export function buildLayerStackEdits(
  x: number,
  y: number,
  selection: MapLayerSelection,
  layerStack: readonly LayerBrushSample[],
  forceExactAutotiles = false,
): TileEdit[] {
  if (layerStack.length < 4) throw new Error('A map layer stack must contain four tile samples.');
  const layers: PaintLayer[] = selection === 'auto' ? [0, 1, 2, 3] : [selection];
  return layers.map((layer) => {
    const sample = layerStack[layer] || { tileId: 0 };
    if (sample.autotileKind != null && !sample.preserveAutotileShape && !forceExactAutotiles) {
      return {
        kind: 'autotile',
        x,
        y,
        layer,
        autotileKind: sample.autotileKind,
      };
    }
    const tileId = Number(sample.tileId || 0);
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
  layerStack: readonly LayerBrushSample[],
  forceExactAutotiles = false,
): TileEdit[] {
  if (layerStack.length < 4) throw new Error('A map layer stack must contain four tile samples.');
  if (start.x < 0 || start.y < 0 || start.x >= map.width || start.y >= map.height) return [];
  const layerSize = map.width * map.height;
  const replacement = [0, 1, 2, 3].map((layer) => Number(layerStack[layer]?.tileId || 0));
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
    edits.push(...buildLayerStackEdits(current.x, current.y, 'auto', layerStack, forceExactAutotiles));
    stack.push(
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    );
  }
  return edits;
}

export function buildMapRangeBrush(
  map: Pick<MvMap, 'width' | 'height' | 'data'>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  selection: MapLayerSelection,
  preserveAutotileShapes = false,
): MapCanvasBrush {
  const range = normalizeInclusiveCellRect(from, to);
  const cells: BrushCell[] = [];
  const layerSize = map.width * map.height;
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      if (selection === 'auto') {
        cells.push({
          dx: x - range.minX,
          dy: y - range.minY,
          layerStack: [0, 1, 2, 3].map((layer) => {
            const tileId = Number(map.data[layer * layerSize + y * map.width + x] || 0);
            return sampleMapTile(tileId, preserveAutotileShapes);
          }),
        });
        continue;
      }
      const tileId = Number(map.data[selection * layerSize + y * map.width + x] || 0);
      if (tileId >= TILE_ID_A1 && !preserveAutotileShapes) {
        cells.push({ dx: x - range.minX, dy: y - range.minY, tileId, autotileKind: Math.floor((tileId - TILE_ID_A1) / 48) });
      } else {
        cells.push({
          dx: x - range.minX,
          dy: y - range.minY,
          tileId,
          preserveAutotileShape: tileId >= TILE_ID_A1,
        });
      }
    }
  }
  const hotspotX = to.x - range.minX;
  const hotspotY = to.y - range.minY;
  if (selection === 'auto') {
    return { type: 'stackRect', cells, width: range.width, height: range.height, hotspotX, hotspotY };
  }
  if (cells.length === 1 && cells[0].autotileKind != null) {
    return { type: 'autotile', autotileKind: cells[0].autotileKind, cells };
  }
  if (cells.length === 1) return { type: 'tile', tileId: cells[0].tileId || 0, cells };
  return { type: 'tileRect', cells, width: range.width, height: range.height, hotspotX, hotspotY };
}

function sampleMapTile(tileId: number, preserveAutotileShape: boolean): LayerBrushSample {
  if (tileId < TILE_ID_A1) return { tileId };
  if (preserveAutotileShape) return { tileId, preserveAutotileShape: true };
  return { tileId, autotileKind: Math.floor((tileId - TILE_ID_A1) / 48) };
}

interface CanvasEditorOptions {
  tileSize: Ref<number>;
  parallaxImage: Ref<HTMLImageElement | null>;
  engine: Ref<RpgMakerEngine>;
  tilesetMode: Ref<number | null>;
  mode: Ref<EditorMode>;
  tool: Ref<MapTool>;
  paintMode: Ref<MapPaintMode>;
  layer: Ref<MapLayerSelection>;
  regionId: Ref<number>;
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
  const regionLabelRef = ref<HTMLCanvasElement>();
  const scrollRef = ref<HTMLDivElement>();
  const canvasWidth = ref(0);
  const canvasHeight = ref(0);
  const zoom = ref(EDITOR_DEFAULT_ZOOM);
  const cursorText = ref('x -, y -');
  const tilesetReady = ref(false);
  const tileTab = ref<PaletteTabId>('A');
  let lastTileTab: TileTab = 'A';
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
  let brush: MapCanvasBrush | null = null;
  let hoverCell: { x: number; y: number } | null = null;
  let dragStart: { x: number; y: number } | null = null;
  let painting = false;
  let strokeEdits = new Map<string, TileEdit>();
  let strokeSnapshot: number[] | null = null;
  let lastStrokeCell: { x: number; y: number } | null = null;
  let shapePreviewTouched = new Set<number>();
  let mapRenderFrame: number | null = null;
  let shadowHoverQuarter: ShadowQuarterPoint | null = null;
  let lastShadowQuarter: ShadowQuarterPoint | null = null;
  let shadowStrokeActionMode: ShadowStrokeAction | null = null;
  let shadowStrokeQuadrants = new Set<string>();
  let undoStack: TileChange[][] = [];
  let redoStack: TileChange[][] = [];
  let paletteHoverCell: PaletteCell | null = null;
  let paletteDragStart: PaletteCell | null = null;
  let paletteDragEnd: PaletteCell | null = null;
  let paletteDragButton: PaletteSelectionButton | null = null;
  let paletteRenderFrame: number | null = null;
  let regionLabelRenderFrame: number | null = null;
  let paletteResizeObserver: ResizeObserver | null = null;
  let scrollResizeObserver: ResizeObserver | null = null;
  let draggingEvent: { event: MvEvent; originalX: number; originalY: number; moved: boolean } | null = null;
  let panStart: { x: number; y: number; left: number; top: number } | null = null;
  let spacePressed = false;
  let shiftPressed = false;
  let eyedropStart: { x: number; y: number } | null = null;
  let eyedropEnd: { x: number; y: number } | null = null;
  let eyedropPreserveAutotileShapes = false;

  function tileSlotLoaded(slot: number): boolean {
    return Boolean(tilesetImages[slot]);
  }

  const tileTabs = computed<PaletteTab[]>(() => {
    // tilesetReady 是响应式 ref，读取它以建立依赖追踪；
    // 当 setMap 更新 tilesetImages 并修改 tilesetReady 时，此 computed 会自动重新计算
    void tilesetReady.value;
    return [
      ...(['A', 'B', 'C', 'D', 'E'] as const).map((tab) => ({
        tab,
        label: tab,
        available: tileTabAvailable(tab, tileSlotLoaded),
      })),
      { tab: 'R' as const, label: 'R', available: true },
    ];
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
    options.layer,
    options.placementActive,
    options.placementDirection,
    options.placementFlash,
    options.tileSize,
    options.parallaxImage,
    tileTab,
    productLanguage,
  ], () => {
    renderMap();
    renderOverlay();
  });
  watch([options.paintMode, options.regionId, productLanguage], updateBrushInfo);
  watch([options.mode, options.paintMode], () => {
    cancelStrokePreview();
    cancelMapRangeSelection();
  });
  watch([options.mode, options.paintMode], () => {
    shadowHoverQuarter = null;
    clearPaletteInteraction();
    schedulePaletteRender();
  });
  watch(zoom, scheduleRegionLabelRender);
  const activeTileTabAvailable = computed(() => (
    tileTab.value !== 'R'
    && tileTabs.value.some((entry) => entry.tab === tileTab.value && entry.available)
  ));

  onMounted(() => {
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);
    window.addEventListener('mouseup', finishPointerInteraction);
    window.addEventListener('blur', cancelPointerPreviews);
    window.addEventListener('resize', onWindowResize);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('keyup', onWindowKeyUp);
    window.removeEventListener('mouseup', finishPointerInteraction);
    window.removeEventListener('blur', cancelPointerPreviews);
    window.removeEventListener('resize', onWindowResize);
    cancelScheduledMapRender();
    cancelScheduledPaletteRender();
    cancelScheduledRegionLabelRender();
    paletteResizeObserver?.disconnect();
    scrollResizeObserver?.disconnect();
  });

  async function setMap(nextMap: MvMap, _names: string[], images: (HTMLImageElement | null)[], resetHistory = true) {
    cancelStrokePreview();
    cancelMapRangeSelection(false);
    shadowHoverQuarter = null;
    map = nextMap;
    clearPaletteInteraction();
    tilesetImages = images;
    tilesetReady.value = images.some(Boolean);
    canvasWidth.value = nextMap.width * tileSize.value;
    canvasHeight.value = nextMap.height * tileSize.value;
    if (tileTab.value !== 'R' && !activeTileTabAvailable.value) {
      const availableTileTab = tileTabs.value.find((entry) => entry.tab !== 'R' && entry.available)?.tab;
      tileTab.value = availableTileTab && availableTileTab !== 'R' ? availableTileTab : 'A';
      lastTileTab = tileTab.value;
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
    cancelStrokePreview();
    cancelMapRangeSelection(false);
    map = nextMap;
    canvasWidth.value = nextMap.width * tileSize.value;
    canvasHeight.value = nextMap.height * tileSize.value;
    renderMap();
    renderOverlay();
  }
  function clearMap() {
    cancelStrokePreview();
    cancelMapRangeSelection(false);
    shadowHoverQuarter = null;
    map = null;
    clearPaletteInteraction();
    canvasWidth.value = 0;
    canvasHeight.value = 0;
    renderMap();
    renderOverlay();
  }
  function setPaletteCanvas(canvas: HTMLCanvasElement) {
    paletteCanvas = canvas;
    paletteResizeObserver?.disconnect();
    paletteResizeObserver = new ResizeObserver(() => schedulePaletteRender());
    if (canvas.parentElement) paletteResizeObserver.observe(canvas.parentElement);
    renderPalette();
  }
  function setCanvasElement(element: unknown) {
    const canvas = element as HTMLCanvasElement | undefined;
    canvasRef.value = canvas;
    if (canvas) renderMap();
  }
  function setOverlayElement(element: unknown) {
    const canvas = element as HTMLCanvasElement | undefined;
    overlayRef.value = canvas;
    if (canvas) renderOverlay();
  }
  function setRegionLabelElement(element: unknown) {
    regionLabelRef.value = element as HTMLCanvasElement | undefined;
    scheduleRegionLabelRender();
  }
  function setScrollElement(element: unknown) {
    scrollRef.value = element as HTMLDivElement | undefined;
    scrollResizeObserver?.disconnect();
    scrollResizeObserver = null;
    if (scrollRef.value) {
      scrollResizeObserver = new ResizeObserver(() => scheduleRegionLabelRender());
      scrollResizeObserver.observe(scrollRef.value);
    }
    scheduleRegionLabelRender();
  }

  function renderMap() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!map) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      scheduleRegionLabelRender();
      return;
    }
    const eventMode = options.mode.value === 'event';
    drawMapContent(context, map, {
      tilesetImages,
      parallaxImage: options.parallaxImage.value,
      tileSize: tileSize.value,
      tilesetFlags: options.tileFlags.value,
      showGrid: eventMode || options.showGrid.value,
      showRegions: shouldShowRegionOverlay(options.mode.value, options.paintMode.value, tileTab.value, options.showRegions.value),
      showRegionLabels: false,
      showTileFlags: options.mode.value === 'map' && options.showTileFlags.value,
      activeLayer: options.mode.value === 'map' && options.paintMode.value === 'tile' && options.layer.value !== 'auto'
        ? options.layer.value
        : null,
      eventOpacity: eventMode ? 1 : MAP_MODE_EVENT_OPACITY,
      selectedEventId: eventMode ? options.selectedEventId.value : null,
      hoveredEventId: eventMode ? options.hoveredEventId?.value : null,
      getCharacterImage: options.getCharacterImage,
    });
    scheduleRegionLabelRender();
  }
  function scheduleRegionLabelRender() {
    if (regionLabelRenderFrame != null) return;
    regionLabelRenderFrame = window.requestAnimationFrame(() => {
      regionLabelRenderFrame = null;
      renderRegionLabels();
    });
  }
  function cancelScheduledRegionLabelRender() {
    if (regionLabelRenderFrame == null) return;
    window.cancelAnimationFrame(regionLabelRenderFrame);
    regionLabelRenderFrame = null;
  }
  function onCanvasScroll() {
    scheduleRegionLabelRender();
  }
  function onWindowResize() {
    schedulePaletteRender();
    scheduleRegionLabelRender();
  }
  function renderRegionLabels() {
    const canvas = regionLabelRef.value;
    const scroll = scrollRef.value;
    if (!canvas || !scroll) return;
    const cssWidth = Math.max(1, scroll.clientWidth);
    const cssHeight = Math.max(1, scroll.clientHeight);
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.left = `${scroll.scrollLeft}px`;
    canvas.style.top = `${scroll.scrollTop}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!map || !shouldShowRegionOverlay(options.mode.value, options.paintMode.value, tileTab.value, options.showRegions.value)) return;
    context.setTransform(pixelWidth / cssWidth, 0, 0, pixelHeight / cssHeight, 0, 0);
    const viewport = visibleRegionViewport({
      mapWidth: map.width,
      mapHeight: map.height,
      tileSize: tileSize.value,
      zoom: zoom.value,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
      overscan: 1,
    });
    const layerSize = map.width * map.height;
    for (let row = viewport.startRow; row < viewport.endRow; row += 1) {
      for (let col = viewport.startCol; col < viewport.endCol; col += 1) {
        const regionId = Number(map.data[REGION_LAYER * layerSize + row * map.width + col] || 0);
        if (!regionId) continue;
        drawMvRegionLabel(
          context,
          regionId,
          col * viewport.displayTileSize - scroll.scrollLeft,
          row * viewport.displayTileSize - scroll.scrollTop,
          viewport.displayTileSize,
        );
      }
    }
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

    if (eyedropStart) {
      drawContinuousRectFrame(context, normalizeInclusiveCellRect(eyedropStart, eyedropEnd || eyedropStart));
      return;
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

    if (options.mode.value === 'map' && options.paintMode.value === 'shadow') {
      if (shadowHoverQuarter) drawShadowQuarterFrame(context, shadowHoverQuarter);
      return;
    }

    if (!hoverCell) return;
    if (options.mode.value === 'map' && painting && dragStart && (options.tool.value === 'rect' || options.tool.value === 'ellipse')) {
      const bounds = brushDragRect(dragStart, hoverCell, activeBrushFootprint());
      if (options.tool.value === 'ellipse' && (dragStart.x !== hoverCell.x || dragStart.y !== hoverCell.y)) {
        drawContinuousEllipseFrame(context, bounds);
      } else {
        drawContinuousRectFrame(context, bounds);
      }
      return;
    }
    if (options.mode.value === 'map' && rectangularBrush() && options.tool.value !== 'eraser' && options.tool.value !== 'fill') {
      drawContinuousRectFrame(context, brushRectAt(hoverCell, activeBrushFootprint()));
      return;
    }
    const cells = options.mode.value === 'event' ? [hoverCell] : previewBrushCells(hoverCell.x, hoverCell.y);
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
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
      return;
    }
    const regionPalette = tileTab.value === 'R';
    const available = regionPalette || activeTileTabAvailable.value;
    const rows = regionPalette ? MV_REGION_PALETTE_ROWS : available ? paletteRowsForTab(tileTab.value as TileTab) : 4;
    if (regionPalette) {
      const layout = regionPaletteLayout(
        canvas.parentElement?.clientWidth || MV_REGION_PALETTE_COLS * tileSize.value,
        window.devicePixelRatio,
      );
      canvas.width = layout.pixelWidth;
      canvas.height = layout.pixelHeight;
      canvas.style.width = `${layout.cssWidth}px`;
      canvas.style.height = `${layout.cssHeight}px`;
      context.setTransform(layout.scaleX, 0, 0, layout.scaleY, 0, 0);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, layout.cssWidth, layout.cssHeight);
      for (let row = 0; row < MV_REGION_PALETTE_ROWS; row += 1) {
        for (let col = 0; col < MV_REGION_PALETTE_COLS; col += 1) {
          const region = regionIdForPaletteCell(col, row);
          if (region == null || region === 0) continue;
          drawMvRegionMarker(context, region, col * layout.cellSize, row * layout.cellSize, layout.cellSize);
        }
      }
      highlightPaletteHover(context, layout.cellSize);
      highlightPaletteSelection(context, layout.cellSize);
      return;
    }
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    canvas.width = MV_PALETTE_COLS * tileSize.value;
    canvas.height = rows * tileSize.value;
    context.setTransform(1, 0, 0, 1, 0, 0);
    drawCheckerboard(context, canvas.width, canvas.height);
    if (!available) {
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
        const pick = palettePickForCell(tileTab.value as TileTab, col, row, tileSlotLoaded);
        if (!pick) continue;
        drawTile(context, tilesetImages, tileIdForPalettePreview(pick), col * tileSize.value, row * tileSize.value, tileSize.value);
      }
    }
    if (paletteDragStart && paletteDragEnd) highlightPaletteDrag(context);
    else {
      highlightPaletteHover(context);
      highlightPaletteSelection(context);
    }
  }
  function highlightPaletteHover(context: CanvasRenderingContext2D, size = tileSize.value) {
    if (!paletteHoverCell || paletteDragStart) return;
    const x = paletteHoverCell.col * size;
    const y = paletteHoverCell.row * size;
    drawPaletteFrame(context, x, y, size, size);
  }

  function drawPaletteFrame(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const canvas = context.canvas;
    const rect = canvas.getBoundingClientRect();
    const transform = context.getTransform();
    const cssScaleX = rect.width > 0 && canvas.width > 0
      ? Math.abs(transform.a) * rect.width / canvas.width
      : 1;
    const cssScaleY = rect.height > 0 && canvas.height > 0
      ? Math.abs(transform.d) * rect.height / canvas.height
      : 1;
    const cssScale = Math.max(.01, Math.min(cssScaleX, cssScaleY));
    const inset = 1 / cssScale;
    context.save();
    context.setLineDash([]);
    context.strokeStyle = 'rgba(17, 17, 17, .92)';
    context.lineWidth = 2 / cssScale;
    context.strokeRect(
      x + inset,
      y + inset,
      Math.max(1, width - inset * 2),
      Math.max(1, height - inset * 2),
    );
    context.strokeStyle = 'rgba(255, 255, 255, .99)';
    context.lineWidth = 1 / cssScale;
    context.strokeRect(
      x + inset,
      y + inset,
      Math.max(1, width - inset * 2),
      Math.max(1, height - inset * 2),
    );
    context.restore();
  }

  function drawShadowQuarterFrame(context: CanvasRenderingContext2D, quarter: ShadowQuarterPoint) {
    const size = tileSize.value / 2;
    const x = quarter.quarterX * size;
    const y = quarter.quarterY * size;
    context.save();
    context.setLineDash([]);
    context.strokeStyle = 'rgba(17, 17, 17, .92)';
    context.lineWidth = 3;
    context.strokeRect(x + 1.5, y + 1.5, Math.max(1, size - 3), Math.max(1, size - 3));
    context.strokeStyle = 'rgba(255, 255, 255, .99)';
    context.lineWidth = 1;
    context.strokeRect(x + 1.5, y + 1.5, Math.max(1, size - 3), Math.max(1, size - 3));
    context.restore();
  }

  function drawContinuousRectFrame(context: CanvasRenderingContext2D, rect: InclusiveCellRect) {
    const x = rect.minX * tileSize.value;
    const y = rect.minY * tileSize.value;
    const width = rect.width * tileSize.value;
    const height = rect.height * tileSize.value;
    context.save();
    context.strokeStyle = 'rgba(0, 0, 0, .82)';
    context.lineWidth = 3;
    context.strokeRect(x + 1.5, y + 1.5, Math.max(1, width - 3), Math.max(1, height - 3));
    context.strokeStyle = 'rgba(255, 255, 255, .98)';
    context.lineWidth = 1;
    context.strokeRect(x + .5, y + .5, Math.max(1, width - 1), Math.max(1, height - 1));
    context.restore();
  }

  function drawContinuousEllipseFrame(context: CanvasRenderingContext2D, rect: InclusiveCellRect) {
    const x = rect.minX * tileSize.value;
    const y = rect.minY * tileSize.value;
    const width = rect.width * tileSize.value;
    const height = rect.height * tileSize.value;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rx = Math.max(.5, width / 2 - 1.5);
    const ry = Math.max(.5, height / 2 - 1.5);
    context.save();
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(0, 0, 0, .82)';
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.ellipse(cx, cy, Math.max(.5, rx + 1), Math.max(.5, ry + 1), 0, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(255, 255, 255, .98)';
    context.lineWidth = 1;
    context.stroke();
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
    drawPaletteFrame(context, x, y, width, height);
  }
  function highlightPaletteSelection(context: CanvasRenderingContext2D, size = tileSize.value) {
    if (tileTab.value === 'R') {
      const selected = regionPaletteCellForId(options.regionId.value);
      if (!selected) return;
      const x = selected.col * size;
      const y = selected.row * size;
      drawPaletteFrame(context, x, y, size, size);
      return;
    }
    if (!brush) return;
    const places = brush.cells.map((cell) => {
      if (cell.autotileKind != null && tileTab.value === 'A') {
        return tileIdToPaletteCell(TILE_ID_A1 + cell.autotileKind * 48, tileTab.value as TileTab);
      }
      return cell.tileId == null ? null : tileIdToPaletteCell(cell.tileId, tileTab.value as TileTab);
    }).filter(Boolean) as { col: number; row: number }[];
    if (!places.length) return;
    const minCol = Math.min(...places.map((place) => place.col));
    const minRow = Math.min(...places.map((place) => place.row));
    const maxCol = Math.max(...places.map((place) => place.col));
    const maxRow = Math.max(...places.map((place) => place.row));
    drawPaletteFrame(
      context,
      minCol * tileSize.value,
      minRow * tileSize.value,
      (maxCol - minCol + 1) * tileSize.value,
      (maxRow - minRow + 1) * tileSize.value,
    );
  }

  function selectTileTab(tab: PaletteTabId) {
    tileTab.value = tab;
    if (tab === 'R') {
      options.paintMode.value = paintModeForPaletteTab(tab);
    } else {
      lastTileTab = tab;
      options.paintMode.value = paintModeForPaletteTab(tab);
    }
    clearPaletteInteraction();
    updateBrushInfo();
    renderMap();
    renderPalette();
  }
  function selectMapTool(nextTool: MapTool) {
    if (options.paintMode.value === 'shadow') {
      tileTab.value = tileTabForShadow(tileTab.value, lastTileTab);
      lastTileTab = tileTab.value;
      options.paintMode.value = 'tile';
      clearPaletteInteraction();
      renderPalette();
    }
    options.tool.value = nextTool;
    updateBrushInfo();
    renderMap();
    renderOverlay();
  }
  function selectTileMode() {
    tileTab.value = tileTabForShadow(tileTab.value, lastTileTab);
    lastTileTab = tileTab.value;
    options.paintMode.value = 'tile';
    clearPaletteInteraction();
    updateBrushInfo();
    renderMap();
    renderPalette();
    renderOverlay();
  }
  function selectShadowMode() {
    tileTab.value = tileTabForShadow(tileTab.value, lastTileTab);
    lastTileTab = tileTab.value;
    options.paintMode.value = 'shadow';
    clearPaletteInteraction();
    updateBrushInfo();
    renderMap();
    renderPalette();
    renderOverlay();
  }
  function onPaletteMouseDown(event: MouseEvent) {
    const selectionButton = paletteSelectionButton(event.button, tileTab.value === 'R');
    if (selectionButton == null || options.mode.value !== 'map') return;
    if (tileTab.value !== 'R' && (options.paintMode.value !== 'tile' || !activeTileTabAvailable.value)) return;
    if (selectionButton === 2) event.preventDefault();
    const cell = paletteCell(event);
    if (!cell) return;
    paletteHoverCell = cell;
    if (tileTab.value === 'R') {
      const selectedRegionId = regionIdForPaletteCell(cell.col, cell.row);
      if (selectedRegionId == null) return;
      options.regionId.value = selectedRegionId;
      options.paintMode.value = 'region';
      updateBrushInfo();
      renderMap();
      schedulePaletteRender();
      return;
    }
    paletteDragStart = cell;
    paletteDragEnd = cell;
    paletteDragButton = selectionButton;
    schedulePaletteRender();
  }
  function onPaletteMouseMove(event: MouseEvent) {
    if (options.mode.value !== 'map' || (tileTab.value !== 'R' && (options.paintMode.value !== 'tile' || !activeTileTabAvailable.value))) {
      if (paletteHoverCell || paletteDragStart || paletteDragEnd) {
        clearPaletteInteraction();
        schedulePaletteRender();
      }
      return;
    }
    const cell = paletteCell(event, Boolean(paletteDragStart));
    if (tileTab.value !== 'R' && paletteDragStart) {
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
  function onPaletteMouseUp(event: MouseEvent) {
    if (paletteDragStart && !paletteSelectionReleaseMatches(paletteDragButton, event.button)) return;
    paletteHoverCell = null;
    if (paletteDragStart) {
      finishPaletteSelection();
      return;
    }
    schedulePaletteRender();
  }
  function onPaletteMouseLeave() {
    paletteHoverCell = null;
    if (paletteDragStart) {
      finishPaletteSelection();
      return;
    }
    schedulePaletteRender();
  }
  function finishPaletteSelection() {
    if (!paletteDragStart || !paletteDragEnd) return;
    const selection = buildPaletteRectSelection(
      paletteDragStart,
      paletteDragEnd,
      (col, row) => palettePickForCell(tileTab.value as TileTab, col, row, tileSlotLoaded),
    );
    if (!selection) {
      paletteDragStart = null;
      paletteDragEnd = null;
      paletteDragButton = null;
      renderPalette();
      return;
    }
    const cells: BrushCell[] = selection.cells;
    options.paintMode.value = 'tile';
    if (cells.length === 1 && cells[0].autotileKind != null) brush = { type: 'autotile', autotileKind: cells[0].autotileKind, cells };
    else if (cells.length === 1) brush = { type: 'tile', tileId: cells[0].tileId || 0, cells };
    else brush = {
      type: 'tileRect',
      cells,
      width: selection.width,
      height: selection.height,
      hotspotX: selection.hotspotX,
      hotspotY: selection.hotspotY,
    };
    paletteDragStart = null;
    paletteDragEnd = null;
    paletteDragButton = null;
    if (options.tool.value === 'eraser') options.tool.value = 'pencil';
    updateBrushInfo();
    renderPalette();
  }
  function paletteCell(event: MouseEvent, clampToBounds = false): PaletteCell | null {
    if (!paletteCanvas || !paletteCanvas.width || !paletteCanvas.height) return null;
    const rect = paletteCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (tileTab.value === 'R') {
      const rawCol = Math.floor((event.clientX - rect.left) / rect.width * MV_REGION_PALETTE_COLS);
      const rawRow = Math.floor((event.clientY - rect.top) / rect.height * MV_REGION_PALETTE_ROWS);
      if (!clampToBounds && (
        rawCol < 0 || rawRow < 0
        || rawCol >= MV_REGION_PALETTE_COLS || rawRow >= MV_REGION_PALETTE_ROWS
      )) return null;
      return {
        col: Math.max(0, Math.min(MV_REGION_PALETTE_COLS - 1, rawCol)),
        row: Math.max(0, Math.min(MV_REGION_PALETTE_ROWS - 1, rawRow)),
      };
    }
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
    paletteDragButton = null;
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

  function scheduleMapRender() {
    if (mapRenderFrame != null) return;
    mapRenderFrame = window.requestAnimationFrame(() => {
      mapRenderFrame = null;
      renderMap();
    });
  }

  function cancelScheduledMapRender() {
    if (mapRenderFrame == null) return;
    window.cancelAnimationFrame(mapRenderFrame);
    mapRenderFrame = null;
  }

  function canvasPoint(event: MouseEvent) {
    const canvas = canvasRef.value;
    if (!canvas || !map) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }
  function canvasCell(event: MouseEvent) {
    const point = canvasPoint(event);
    if (!point) return null;
    const x = Math.floor(point.x / tileSize.value);
    const y = Math.floor(point.y / tileSize.value);
    return inMap(x, y) ? { x, y } : null;
  }
  function canvasShadowQuarter(event: MouseEvent) {
    const point = canvasPoint(event);
    if (!point || !map) return null;
    return shadowQuarterAtCanvasPoint(point.x, point.y, tileSize.value, map.width, map.height);
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
    const shadowQuarter = options.mode.value === 'map' && options.paintMode.value === 'shadow'
      ? canvasShadowQuarter(event)
      : null;
    const cell = shadowQuarter ? { x: shadowQuarter.x, y: shadowQuarter.y } : canvasCell(event);
    if (!cell) return;
    hoverCell = cell;
    shadowHoverQuarter = shadowQuarter;
    if (event.button === 2 && options.mode.value === 'map' && !options.placementActive?.value) {
      event.preventDefault();
      if (options.paintMode.value === 'shadow') {
        renderOverlay();
        return;
      }
      eyedropStart = cell;
      eyedropEnd = cell;
      eyedropPreserveAutotileShapes = event.shiftKey || shiftPressed;
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
    if (options.paintMode.value === 'shadow') {
      if (!shadowQuarter) return;
      beginStroke(cell);
      beginShadowStroke(shadowQuarter);
      applyPreviewEdits(shadowQuarterEdits([shadowQuarter]), true);
      renderOverlay();
      return;
    }
    if (options.tool.value === 'fill') {
      const edits = floodFillEdits(cell);
      if (edits.length) {
        beginStroke(cell);
        applyPreviewEdits(edits, true);
        void finishPointerInteraction();
      }
      return;
    }
    if (!toolReady()) {
      options.setStatus(t('mapcanvas.status.selectBrushFirst'), 'error');
      return;
    }
    beginStroke(cell);
    if (options.tool.value === 'rect' || options.tool.value === 'ellipse') previewShape(cell, true);
    else if (options.tool.value === 'pencil' && rectangularBrush()) {
      applyPreviewEdits(rectangularBrushPathEdits([cell], cell), true);
    } else applyToolAt(cell.x, cell.y, true);
    renderOverlay();
  }
  function onCanvasMouseMove(event: MouseEvent) {
    if (isPanning.value && panStart && scrollRef.value) {
      scrollRef.value.scrollLeft = panStart.left - (event.clientX - panStart.x);
      scrollRef.value.scrollTop = panStart.top - (event.clientY - panStart.y);
      return;
    }
    const shadowQuarter = options.mode.value === 'map' && options.paintMode.value === 'shadow'
      ? canvasShadowQuarter(event)
      : null;
    const cell = shadowQuarter ? { x: shadowQuarter.x, y: shadowQuarter.y } : canvasCell(event);
    hoverCell = cell;
    shadowHoverQuarter = shadowQuarter;
    cursorText.value = cell ? `x ${cell.x}, y ${cell.y}` : 'x -, y -';
    if (eyedropStart && cell && options.mode.value === 'map') {
      eyedropEnd = options.paintMode.value === 'tile' ? cell : eyedropStart;
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
    } else if (painting && cell && options.mode.value === 'map') {
      if (options.paintMode.value === 'shadow' && shadowQuarter && shadowStrokeActionMode) {
        const points = rasterShadowQuarterLine(
          lastShadowQuarter || shadowQuarter,
          shadowQuarter,
          map?.width || 0,
          map?.height || 0,
        );
        applyPreviewEdits(shadowQuarterEdits(points));
        lastShadowQuarter = shadowQuarter;
        lastStrokeCell = cell;
      } else if (options.tool.value === 'rect' || options.tool.value === 'ellipse') previewShape(cell);
      else {
        const points = rasterMapCellLine(lastStrokeCell || cell, cell);
        const edits = options.tool.value === 'pencil' && rectangularBrush() && dragStart
          ? rectangularBrushPathEdits(points, dragStart)
          : points.flatMap((point) => toolEditsAt(point.x, point.y));
        applyPreviewEdits(edits);
        lastStrokeCell = cell;
      }
    }
    renderOverlay();
  }
  function onCanvasMouseLeave() {
    hoverCell = null;
    shadowHoverQuarter = null;
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
  async function finishPointerInteraction(event?: MouseEvent) {
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
    if (eyedropStart && (!event || event.button === 2)) {
      const from = eyedropStart;
      const to = eyedropEnd || from;
      const preserveAutotileShapes = eyedropPreserveAutotileShapes;
      eyedropStart = null;
      eyedropEnd = null;
      eyedropPreserveAutotileShapes = false;
      pickMapRange(from, to, preserveAutotileShapes);
      renderOverlay();
    }
    if (!painting || (event && event.button !== 0)) return;
    const rollback = strokeSnapshot;
    painting = false;
    dragStart = null;
    strokeSnapshot = null;
    lastStrokeCell = null;
    shapePreviewTouched = new Set();
    lastShadowQuarter = null;
    shadowStrokeActionMode = null;
    shadowStrokeQuadrants = new Set();
    const edits = [...strokeEdits.values()];
    strokeEdits = new Map();
    if (edits.length) await commitEdits(edits, rollback);
    renderOverlay();
  }

  function rectangularBrush(): Extract<MapCanvasBrush, { type: 'tileRect' | 'stackRect' }> | null {
    return brush?.type === 'tileRect' || brush?.type === 'stackRect' ? brush : null;
  }
  function activeBrushFootprint(): RectBrushFootprint {
    const rectangle = options.paintMode.value === 'tile' && options.tool.value !== 'eraser' && options.tool.value !== 'fill'
      ? rectangularBrush()
      : null;
    return rectangle
      ? { width: rectangle.width, height: rectangle.height, hotspotX: rectangle.hotspotX, hotspotY: rectangle.hotspotY }
      : { width: 1, height: 1, hotspotX: 0, hotspotY: 0 };
  }
  function previewBrushCells(x: number, y: number) {
    if (options.paintMode.value !== 'tile' || options.tool.value === 'eraser' || options.tool.value === 'fill') return [{ x, y }];
    const origin = brushOriginAt({ x, y }, activeBrushFootprint());
    return brush?.cells.map((cell) => ({ x: origin.x + cell.dx, y: origin.y + cell.dy })) || [{ x, y }];
  }
  function beginStroke(cell: { x: number; y: number }) {
    if (!map) return;
    painting = true;
    dragStart = cell;
    strokeSnapshot = map.data.slice();
    lastStrokeCell = cell;
    strokeEdits = new Map();
    shapePreviewTouched = new Set();
    lastShadowQuarter = null;
    shadowStrokeActionMode = null;
    shadowStrokeQuadrants = new Set();
  }

  function beginShadowStroke(quarter: ShadowQuarterPoint) {
    if (!map) return;
    const current = shadowBitsAt(quarter.x, quarter.y);
    shadowStrokeActionMode = shadowStrokeAction(current, quarter.bit);
    lastShadowQuarter = quarter;
  }

  function shadowBitsAt(x: number, y: number): number {
    if (!map || !inMap(x, y)) return 0;
    const index = SHADOW_LAYER * map.width * map.height + y * map.width + x;
    return clampInt(map.data[index] || 0, 0, 15);
  }

  function shadowQuarterEdits(quarters: readonly ShadowQuarterPoint[]): TileEdit[] {
    if (!map || !shadowStrokeActionMode) return [];
    return shadowQuarterStrokeEdits(
      quarters.filter((quarter) => inMap(quarter.x, quarter.y)),
      shadowStrokeActionMode,
      shadowBitsAt,
      shadowStrokeQuadrants,
    ).map(({ x, y, shadowBits }) => ({
      kind: 'shadow',
      x,
      y,
      layer: SHADOW_LAYER,
      shadowBits,
    }));
  }

  function toolEditsAt(x: number, y: number): TileEdit[] {
    if (options.mode.value !== 'map') return [];
    if (options.paintMode.value === 'shadow') return [];
    if (options.paintMode.value === 'region') {
      const value = options.tool.value === 'eraser' ? 0 : clampInt(options.regionId.value, 0, 255);
      return [{ kind: 'region', x, y, layer: REGION_LAYER, regionId: value }];
    }
    if (options.tool.value === 'eraser') return [{ kind: 'tile', x, y, layer: options.layer.value, tileId: 0 }];
    const edits: TileEdit[] = [];
    const origin = brushOriginAt({ x, y }, activeBrushFootprint());
    for (const cell of brush?.cells || []) {
      edits.push(...brushCellEditsAt(cell, origin.x + cell.dx, origin.y + cell.dy));
    }
    return edits;
  }

  function brushCellEditsAt(cell: BrushCell, x: number, y: number): TileEdit[] {
    if (cell.layerStack) return buildLayerStackEdits(x, y, options.layer.value, cell.layerStack, shiftPressed);
    if (cell.preserveAutotileShape) {
      return [{
        kind: 'tile',
        x,
        y,
        layer: options.layer.value,
        tileId: cell.tileId ?? (TILE_ID_A1 + (cell.autotileKind || 0) * 48),
        preserveAutotileShape: true,
      }];
    }
    const exactAutotile = cell.autotileKind != null && shiftPressed;
    const payload = cell.autotileKind != null && !exactAutotile
      ? { kind: 'autotile' as const, autotileKind: cell.autotileKind }
      : {
          kind: 'tile' as const,
          tileId: cell.tileId ?? (TILE_ID_A1 + (cell.autotileKind || 0) * 48),
          preserveAutotileShape: exactAutotile,
        };
    return [{ x, y, layer: options.layer.value, ...payload }];
  }

  function applyToolAt(x: number, y: number, immediate = false) {
    applyPreviewEdits(toolEditsAt(x, y), immediate);
  }

  function rectangularBrushPathEdits(
    pointers: readonly { x: number; y: number }[],
    anchor: { x: number; y: number },
  ): TileEdit[] {
    const rectangle = rectangularBrush();
    if (!rectangle) return pointers.flatMap((point) => toolEditsAt(point.x, point.y));
    const footprint = {
      width: rectangle.width,
      height: rectangle.height,
      hotspotX: rectangle.hotspotX,
      hotspotY: rectangle.hotspotY,
    };
    const sourceCells = new Map(rectangle.cells.map((cell) => [`${cell.dx},${cell.dy}`, cell]));
    return brushPathPatternPlacements(pointers, anchor, footprint, map ? { width: map.width, height: map.height } : undefined).flatMap((placement) => {
      const source = sourceCells.get(`${placement.sourceDx},${placement.sourceDy}`);
      return source ? brushCellEditsAt(source, placement.x, placement.y) : [];
    });
  }

  function applyPreviewEdits(edits: readonly TileEdit[], immediate = false, shape = false) {
    if (!map || !edits.length) return;
    const accepted: TileEdit[] = [];
    for (const edit of edits) {
      if (!inMap(edit.x, edit.y)) continue;
      const key = strokeEditKey(edit);
      const previous = strokeEdits.get(key);
      if (previous && sameTileEdit(previous, edit)) continue;
      strokeEdits.set(key, edit);
      accepted.push(edit);
    }
    if (!accepted.length) return;
    const result = applyRmmvMapBrushEdits(map, accepted, {
      engine: options.engine.value,
      tilesetMode: options.tilesetMode.value,
      autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
      mutate: true,
      collectChanges: false,
    });
    if (shape) for (const index of result.touchedIndices) shapePreviewTouched.add(index);
    if (immediate) {
      cancelScheduledMapRender();
      renderMap();
    } else {
      scheduleMapRender();
    }
  }

  function previewShape(end: { x: number; y: number }, immediate = false) {
    if (!map || !strokeSnapshot || !dragStart) return;
    for (const index of shapePreviewTouched) map.data[index] = strokeSnapshot[index];
    shapePreviewTouched = new Set();
    strokeEdits = new Map();
    shadowStrokeQuadrants = new Set();
    applyPreviewEdits(shapePatternEdits(dragStart, end), immediate, true);
  }

  function shapePatternEdits(from: { x: number; y: number }, to: { x: number; y: number }): TileEdit[] {
    const shape = options.tool.value === 'ellipse' ? 'ellipse' : 'rect';
    const footprint = activeBrushFootprint();
    const placements = patternPlacements(from, to, footprint, shape);
    const rectangle = options.paintMode.value === 'tile' && options.tool.value !== 'eraser' ? rectangularBrush() : null;
    if (!rectangle) return placements.flatMap((placement) => toolEditsAt(placement.x, placement.y));
    const sourceCells = new Map(rectangle.cells.map((cell) => [`${cell.dx},${cell.dy}`, cell]));
    return placements.flatMap((placement) => {
      const source = sourceCells.get(`${placement.sourceDx},${placement.sourceDy}`);
      return source ? brushCellEditsAt(source, placement.x, placement.y) : [];
    });
  }

  function strokeEditKey(edit: TileEdit): string {
    return `${edit.x},${edit.y},${edit.layer ?? 'auto'}`;
  }

  function sameTileEdit(left: TileEdit, right: TileEdit): boolean {
    return left.kind === right.kind
      && left.x === right.x
      && left.y === right.y
      && left.layer === right.layer
      && left.tileId === right.tileId
      && left.autotileKind === right.autotileKind
      && left.preserveAutotileShape === right.preserveAutotileShape
      && left.shadowBits === right.shadowBits
      && left.regionId === right.regionId;
  }

  function pickMapRange(
    from: { x: number; y: number },
    to: { x: number; y: number },
    preserveAutotileShapes: boolean,
  ) {
    if (!map) return;
    if (options.paintMode.value === 'region' && tileTab.value === 'R') {
      const layerSize = map.width * map.height;
      options.regionId.value = clampInt(map.data[REGION_LAYER * layerSize + from.y * map.width + from.x] || 0, 0, 255);
      if (options.tool.value === 'eraser') options.tool.value = 'pencil';
      updateBrushInfo();
      renderPalette();
      return;
    }
    brush = buildMapRangeBrush(map, from, to, options.layer.value, preserveAutotileShapes);
    if (tileTab.value === 'R') tileTab.value = lastTileTab;
    options.paintMode.value = 'tile';
    if (options.tool.value === 'eraser') options.tool.value = 'pencil';
    updateBrushInfo();
  }
  function floodFillEdits(start: { x: number; y: number }) {
    if (!map || !toolReady()) return [];
    const cell = brush?.cells[0];
    if (options.layer.value === 'auto' && options.tool.value !== 'eraser' && cell?.layerStack) {
      return buildStackFloodFillEdits(map, start, cell.layerStack, shiftPressed);
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

  function cancelStrokePreview() {
    if (!painting) return;
    painting = false;
    cancelScheduledMapRender();
    if (map && strokeSnapshot) map.data = strokeSnapshot;
    dragStart = null;
    strokeSnapshot = null;
    lastStrokeCell = null;
    strokeEdits = new Map();
    shapePreviewTouched = new Set();
    lastShadowQuarter = null;
    shadowStrokeActionMode = null;
    shadowStrokeQuadrants = new Set();
    renderMap();
    renderOverlay();
  }

  function cancelMapRangeSelection(render = true) {
    if (!eyedropStart && !eyedropEnd) return;
    eyedropStart = null;
    eyedropEnd = null;
    eyedropPreserveAutotileShapes = false;
    if (render) renderOverlay();
  }

  function cancelPointerPreviews() {
    cancelStrokePreview();
    cancelMapRangeSelection();
  }

  async function commitEdits(edits: TileEdit[], rollback: number[] | null = null) {
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
      if (map && rollback) {
        map.data = rollback;
        renderMap();
      }
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
    if (options.paintMode.value === 'region') return REGION_LAYER;
    if (options.layer.value !== 'auto') return options.layer.value;
    const cell = brush?.cells[0];
    if (cell?.layerStack) return 0;
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
    if (options.paintMode.value === 'region') return clampInt(options.regionId.value, 0, 255);
    const cell = brush?.cells[0];
    if (cell?.layerStack && options.layer.value !== 'auto') return Number(cell.layerStack[options.layer.value]?.tileId || 0);
    return cell?.autotileKind != null ? TILE_ID_A1 + cell.autotileKind * 48 : cell?.tileId || 0;
  }
  function activeEditPayload(x: number, y: number): TileEdit {
    if (options.paintMode.value === 'region') {
      return { kind: 'region', x, y, layer: REGION_LAYER, regionId: options.tool.value === 'eraser' ? 0 : clampInt(options.regionId.value, 0, 255) };
    }
    if (options.tool.value === 'eraser') return { kind: 'tile', x, y, layer: options.layer.value, tileId: 0 };
    const cell = brush?.cells[0];
    if (cell?.layerStack && options.layer.value !== 'auto') {
      return buildLayerStackEdits(x, y, options.layer.value, cell.layerStack, shiftPressed)[0]!;
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
      brushInfo.value = t('mapcanvas.brush.shadow');
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
    if (event.key === 'Escape' && (painting || eyedropStart)) {
      event.preventDefault();
      cancelPointerPreviews();
      return;
    }
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
    canvasRef, overlayRef, regionLabelRef, scrollRef, canvasWidth, canvasHeight, zoom, cursorText, tilesetReady, tileTab, tileTabs,
    brushInfo, brushSet, undoLen, redoLen, isPanning,
    setMap, replaceMap, clearMap, setPaletteCanvas, setCanvasElement, setOverlayElement, setRegionLabelElement, setScrollElement, selectTileTab, selectMapTool, selectTileMode, selectShadowMode, canvasCell, eventAtCell,
    onPaletteMouseDown, onPaletteMouseMove, onPaletteMouseUp, onPaletteMouseLeave,
    onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasDoubleClick, onCanvasWheel, onCanvasScroll,
    renderMap, renderOverlay, zoomIn, zoomOut, resetZoom, setZoom, undo, redo, getPlacementCell,
  };
}
