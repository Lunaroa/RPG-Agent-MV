import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { TileEdit } from '../api/client';
import type { EditorMode, EditorStatusKind, MapPaintMode, MapTool, PaletteTab, TileTab } from '../components/editor/editorTypes';
import type { ProductLanguage } from '@contract/types';
import { EDITOR_DEFAULT_ZOOM } from './useEditorWorkspaceState';
import {
  AUTOTILE_KINDS,
  REGION_LAYER,
  SHADOW_LAYER,
  TILE_ID_A1,
  TILE_SIZE,
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

type TileChange = TileEdit & { before?: number; after?: number };
type BrushCell = { dx: number; dy: number; tileId?: number; autotileKind?: number };
type Brush =
  | { type: 'autotile'; autotileKind: number; cells: BrushCell[] }
  | { type: 'tile'; tileId: number; cells: BrushCell[] }
  | { type: 'tileRect'; cells: BrushCell[]; width: number; height: number };

export interface PlacementFlashCell {
  x: number;
  y: number;
  until: number;
}

interface CanvasEditorOptions {
  mode: Ref<EditorMode>;
  tool: Ref<MapTool>;
  paintMode: Ref<MapPaintMode>;
  layer: Ref<number>;
  regionId: Ref<number>;
  shadowBits: Ref<number>;
  showGrid: Ref<boolean>;
  showEvents: Ref<boolean>;
  showRegions: Ref<boolean>;
  showTileFlags: Ref<boolean>;
  tileFlags: Ref<number[]>;
  selectedEventId: Ref<number | null>;
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
  let paletteDragStart: { col: number; row: number } | null = null;
  let paletteDragEnd: { col: number; row: number } | null = null;
  let draggingEvent: { event: MvEvent; originalX: number; originalY: number; moved: boolean } | null = null;
  let panStart: { x: number; y: number; left: number; top: number } | null = null;
  let spacePressed = false;

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
    options.showEvents,
    options.showRegions,
    options.showTileFlags,
    options.tileFlags,
    options.selectedEventId,
    options.paintMode,
    options.regionId,
    options.shadowBits,
    options.placementActive,
    options.placementDirection,
    options.placementFlash,
    productLanguage,
  ], () => {
    renderMap();
    renderOverlay();
  });
  watch([options.paintMode, options.regionId, options.shadowBits, productLanguage], updateBrushInfo);

  onMounted(() => {
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);
    window.addEventListener('mouseup', finishPointerInteraction);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('keyup', onWindowKeyUp);
    window.removeEventListener('mouseup', finishPointerInteraction);
  });

  async function setMap(nextMap: MvMap, _names: string[], images: (HTMLImageElement | null)[], resetHistory = true) {
    map = nextMap;
    tilesetImages = images;
    tilesetReady.value = images.some(Boolean);
    canvasWidth.value = nextMap.width * TILE_SIZE;
    canvasHeight.value = nextMap.height * TILE_SIZE;
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
    canvasWidth.value = nextMap.width * TILE_SIZE;
    canvasHeight.value = nextMap.height * TILE_SIZE;
    renderMap();
    renderOverlay();
  }
  function clearMap() {
    map = null;
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
    const view: MvMap = { ...map, events: options.mode.value === 'event' || options.showEvents.value ? map.events : [] };
    drawMapContent(context, view, {
      tilesetImages,
      tilesetFlags: options.tileFlags.value,
      showGrid: options.mode.value === 'event' || options.showGrid.value,
      showRegions: options.showRegions.value || (options.mode.value === 'map' && options.paintMode.value === 'region'),
      showTileFlags: options.showTileFlags.value,
      selectedEventId: options.selectedEventId.value,
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
      context.fillRect(cell.x * TILE_SIZE, cell.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      context.strokeRect(cell.x * TILE_SIZE + 1, cell.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
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
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    context.save();
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    context.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
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
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    context.save();
    context.globalAlpha = 0.55;
    if (Number(image.tileId) > 0) {
      drawTile(context, tilesetImages, Number(image.tileId), px, py);
    } else if (image.characterName) {
      const bitmap = options.getCharacterImage?.(image.characterName) || null;
      const frame = bitmap ? eventCharacterFrame(bitmap, image) : null;
      if (bitmap && frame) {
        const dx = Math.round(px + TILE_SIZE / 2 - frame.sw / 2);
        const dy = Math.round(py + TILE_SIZE - frame.sh);
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
    context.fillStyle = 'rgba(99, 102, 241, .42)';
    context.fillRect(px + 10, py + 8, TILE_SIZE - 20, TILE_SIZE - 14);
    context.strokeStyle = 'rgba(255, 255, 255, .75)';
    context.lineWidth = 2;
    context.strokeRect(px + 12, py + 10, TILE_SIZE - 24, TILE_SIZE - 18);
    context.fillStyle = 'rgba(255, 255, 255, .9)';
    context.font = 'bold 14px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('EV', px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 2);
  }
  function renderPalette() {
    const canvas = paletteCanvas;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!map || !tilesetImages.some(Boolean)) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const rows = paletteRowsForTab(tileTab.value);
    canvas.width = MV_PALETTE_COLS * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;
    context.fillStyle = '#20262b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < MV_PALETTE_COLS; col += 1) {
        const pick = palettePickForCell(tileTab.value, col, row, tileSlotLoaded);
        if (!pick) continue;
        drawTile(context, tilesetImages, tileIdForPalettePreview(pick), col * TILE_SIZE, row * TILE_SIZE);
      }
    }
    drawGrid(context, MV_PALETTE_COLS, rows);
    highlightPaletteSelection(context);
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
    context.strokeRect(minCol * TILE_SIZE + 1.5, minRow * TILE_SIZE + 1.5, (maxCol - minCol + 1) * TILE_SIZE - 3, (maxRow - minRow + 1) * TILE_SIZE - 3);
    context.strokeStyle = '#111';
    context.lineWidth = 1;
    context.strokeRect(minCol * TILE_SIZE + 4.5, minRow * TILE_SIZE + 4.5, (maxCol - minCol + 1) * TILE_SIZE - 9, (maxRow - minRow + 1) * TILE_SIZE - 9);
    context.restore();
  }

  function selectTileTab(tab: TileTab) {
    if (!tileTabs.value.some((entry) => entry.tab === tab && entry.available)) return;
    tileTab.value = tab;
    renderPalette();
  }
  function onPaletteMouseDown(event: MouseEvent) {
    if (options.mode.value !== 'map' || options.paintMode.value !== 'tile') return;
    const cell = paletteCell(event);
    if (!cell) return;
    paletteDragStart = cell;
    paletteDragEnd = cell;
  }
  function onPaletteMouseMove(event: MouseEvent) {
    if (!paletteDragStart) return;
    const cell = paletteCell(event);
    if (cell) paletteDragEnd = cell;
  }
  function onPaletteMouseUp() {
    if (!paletteDragStart) return;
    finishPaletteSelection();
  }
  function finishPaletteSelection() {
    if (!paletteDragStart || !paletteDragEnd) return;
    const minCol = Math.min(paletteDragStart.col, paletteDragEnd.col);
    const maxCol = Math.max(paletteDragStart.col, paletteDragEnd.col);
    const minRow = Math.min(paletteDragStart.row, paletteDragEnd.row);
    const maxRow = Math.max(paletteDragStart.row, paletteDragEnd.row);
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
  function paletteCell(event: MouseEvent) {
    if (!paletteCanvas || !paletteCanvas.width || !paletteCanvas.height) return null;
    const rect = paletteCanvas.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) * paletteCanvas.width / rect.width / TILE_SIZE);
    const row = Math.floor((event.clientY - rect.top) * paletteCanvas.height / rect.height / TILE_SIZE);
    if (col < 0 || row < 0 || col * TILE_SIZE >= paletteCanvas.width || row * TILE_SIZE >= paletteCanvas.height) return null;
    return { col, row };
  }

  function canvasCell(event: MouseEvent) {
    const canvas = canvasRef.value;
    if (!canvas || !map) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width / TILE_SIZE);
    const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height / TILE_SIZE);
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
    if (event.button !== 0) return;
    const cell = canvasCell(event);
    if (!cell) return;
    hoverCell = cell;
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
    if (options.placementActive?.value) {
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
      const payload = cell.autotileKind != null ? { kind: 'autotile' as const, autotileKind: cell.autotileKind } : { kind: 'tile' as const, tileId: cell.tileId || 0 };
      const optimistic = cell.autotileKind != null ? TILE_ID_A1 + cell.autotileKind * 48 : cell.tileId || 0;
      pushEdit(x + cell.dx, y + cell.dy, options.layer.value, payload, optimistic);
    }
  }
  function pushEdit(x: number, y: number, layer: number, payload: Partial<TileEdit>, tileId: number) {
    if (!map || !inMap(x, y)) return;
    strokeEdits.set(`${x},${y},${layer}`, { x, y, layer, ...payload });
    map.data[layer * map.width * map.height + y * map.width + x] = tileId;
    renderMap();
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
    const localX = ((px % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const localY = ((py % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    if (localY < TILE_SIZE / 2) return localX < TILE_SIZE / 2 ? 1 : 2;
    return localX < TILE_SIZE / 2 ? 4 : 8;
  }
  function floodFillEdits(start: { x: number; y: number }) {
    if (!map || !toolReady()) return [];
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

  function toolReady() { return options.paintMode.value !== 'tile' || options.tool.value === 'eraser' || Boolean(brush); }
  function activeEditLayer() {
    if (options.paintMode.value === 'shadow') return SHADOW_LAYER;
    if (options.paintMode.value === 'region') return REGION_LAYER;
    return options.layer.value;
  }
  function activeReplacementValue() {
    if (options.tool.value === 'eraser') return 0;
    if (options.paintMode.value === 'shadow') return clampInt(options.shadowBits.value, 0, 15);
    if (options.paintMode.value === 'region') return clampInt(options.regionId.value, 0, 255);
    const cell = brush?.cells[0];
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
    } else if (!brush) {
      brushInfo.value = t('mapcanvas.brush.none');
      brushSet.value = false;
    } else if (brush.type === 'tileRect') {
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
  function onWindowKeyDown(event: KeyboardEvent) { if (event.code === 'Space' && !isFormTarget(event.target)) spacePressed = true; }
  function onWindowKeyUp(event: KeyboardEvent) { if (event.code === 'Space') spacePressed = false; }
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
    onPaletteMouseDown, onPaletteMouseMove, onPaletteMouseUp,
    onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasDoubleClick, onCanvasWheel,
    renderMap, renderOverlay, zoomIn, zoomOut, resetZoom, setZoom, undo, redo, getPlacementCell,
  };
}
