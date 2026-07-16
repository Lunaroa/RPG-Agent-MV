<template>
  <div class="tileset-flag-canvas-editor" data-ui-id="tileset-flag-editor">
    <div class="flag-tool-strip" role="toolbar" :aria-label="t('db.tileFlagTools')">
      <button
        v-for="tool in tools"
        :key="tool.key"
        type="button"
        :class="{ active: mode === tool.key }"
        :aria-pressed="mode === tool.key"
        :data-ui-id="`tileset-flag-mode-${tool.key}`"
        :title="tool.label"
        @click="mode = tool.key"
      >
        <span class="tool-symbol" aria-hidden="true">{{ tool.symbol }}</span>
        <span>{{ tool.label }}</span>
      </button>
    </div>

    <div class="sheet-strip" role="tablist" :aria-label="t('db.tileFlagSheets')">
      <button
        v-for="sheet in sheets"
        :key="sheet.key"
        type="button"
        role="tab"
        :aria-selected="selectedSheetKey === sheet.key"
        :class="{ active: selectedSheetKey === sheet.key }"
        :data-ui-id="`tileset-flag-sheet-${sheet.key}`"
        @click="selectedSheetKey = sheet.key"
      >
        {{ sheet.key }}
      </button>
    </div>

    <div class="canvas-frame" :class="{ unavailable: currentImageState !== 'ready' }">
      <div v-if="currentImageState !== 'ready'" class="canvas-state" role="status">
        <strong>{{ currentSheet.key }}</strong>
        <span>{{ imageStateMessage }}</span>
      </div>
      <canvas
        v-show="currentImageState === 'ready'"
        ref="canvasRef"
        :width="currentSheet.columns * tileSize"
        :height="currentSheet.rows * tileSize"
        :style="canvasStyle"
        role="application"
        tabindex="0"
        :aria-label="canvasAriaLabel"
        :data-ui-id="`tileset-flag-canvas-${currentSheet.key}`"
        @pointerdown="beginPointerPaint"
        @pointermove="continuePointerPaint"
        @pointerup="finishPointerPaint"
        @pointercancel="cancelPointerPaint"
        @contextmenu.prevent
        @keydown="handleCanvasKeydown"
      />
    </div>

    <div class="flag-editor-status" aria-live="polite">
      <span class="selection-status" data-ui-id="tileset-flag-selection">{{ selectionStatus }}</span>
      <span class="mode-hint">{{ modeHint }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import type { EditorProjectCatalog } from '../../api/client';
import { drawTile } from '../../composables/useMapRenderer';
import { useI18n } from '../../i18n';
import {
  MV_TILESET_FLAG_BITS,
  MV_TILESET_SHEETS,
  applyMvTilesetFlagEdit,
  inspectMvTilesetFlagCell,
  mvTilesetFlagCell,
  mvTilesetSheet,
  nextMvTilesetPassage,
  nextMvTilesetTerrainTag,
  type MvTilesetAggregate,
  type MvTilesetDirectionBit,
  type MvTilesetFlagCell,
  type MvTilesetFlagEdit,
  type MvTilesetFlagCellState,
  type MvTilesetMarkerBit,
  type MvTilesetSheetKey,
} from '../../utils/rmmvTilesetFlags';

type FlagMode = 'passage' | 'direction' | 'ladder' | 'bush' | 'counter' | 'damage' | 'terrain';
type ImageState = 'empty' | 'loading' | 'missing' | 'failed' | 'ready';
type PointerHit = { row: number; column: number; localX: number; localY: number };
type ToolDefinition = { key: FlagMode; symbol: string; label: string };
type DragPaint = {
  pointerId: number;
  flags: unknown[];
  edit: MvTilesetFlagEdit;
  visited: Set<string>;
  changed: boolean;
};

const props = defineProps<{
  tilesetNames: readonly unknown[];
  flags: readonly unknown[];
  catalog: EditorProjectCatalog | null;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ 'update:flags': [flags: unknown[]] }>();
const { t } = useI18n();
const DISPLAY_TILE_SIZE = 28;
const tileSize = computed(() => Math.max(1, Number(props.catalog?.tileSize) || 48));

const sheets = MV_TILESET_SHEETS;
const selectedSheetKey = ref<MvTilesetSheetKey>('A1');
const mode = ref<FlagMode>('passage');
const selectedRow = ref(0);
const selectedColumn = ref(0);
const selectedDirection = ref<MvTilesetDirectionBit>(MV_TILESET_FLAG_BITS.down);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const imageStates = ref<ImageState[]>(Array.from({ length: 9 }, () => 'empty'));
const imageRevision = ref(0);
let tilesetImages: (HTMLImageElement | null)[] = Array.from({ length: 9 }, () => null);
let imageRequest = 0;
let dragPaint: DragPaint | null = null;

const tools = computed<ToolDefinition[]>(() => [
  { key: 'passage', symbol: '○×', label: t('db.tileFlagPassage') },
  { key: 'direction', symbol: '↕', label: t('db.tileFlagDirection') },
  { key: 'ladder', symbol: '⇅', label: t('db.tileFlagLadder') },
  { key: 'bush', symbol: '♣', label: t('db.tileFlagBush') },
  { key: 'counter', symbol: '◆', label: t('db.tileFlagCounter') },
  { key: 'damage', symbol: '⚠', label: t('db.tileFlagDamage') },
  { key: 'terrain', symbol: '7', label: t('db.tileFlagTerrain') },
]);

const currentSheet = computed(() => mvTilesetSheet(selectedSheetKey.value));
const currentImageState = computed(() => imageStates.value[currentSheet.value.imageIndex] || 'empty');
const currentImageName = computed(() => String(props.tilesetNames[currentSheet.value.imageIndex] || '').trim());
const selectedCell = computed(() => mvTilesetFlagCell(selectedSheetKey.value, selectedRow.value, selectedColumn.value));
const canvasStyle = computed(() => ({
  width: `${currentSheet.value.columns * DISPLAY_TILE_SIZE}px`,
  height: `${currentSheet.value.rows * DISPLAY_TILE_SIZE}px`,
}));
const canvasAriaLabel = computed(() => t('db.tileFlagCanvasAria', {
  sheet: currentSheet.value.key,
  mode: tools.value.find((tool) => tool.key === mode.value)?.label || mode.value,
}));
const imageStateMessage = computed(() => {
  if (currentImageState.value === 'loading') return t('db.tileFlagImageLoading');
  if (currentImageState.value === 'empty') return t('db.tileFlagImageEmpty');
  if (currentImageState.value === 'missing') return t('db.tileFlagImageMissing', { name: currentImageName.value });
  return t('db.tileFlagImageFailed', { name: currentImageName.value });
});
const modeHint = computed(() => {
  if (currentImageState.value !== 'ready') return t('db.tileFlagUnavailableHint');
  if (mode.value === 'direction' && !currentSheet.value.directionalEditable) return t('db.tileFlagAutotileDirectionHint');
  if (mode.value === 'passage') return t('db.tileFlagPassageHint');
  if (mode.value === 'direction') return t('db.tileFlagDirectionHint');
  if (mode.value === 'terrain') return t('db.tileFlagTerrainHint');
  return t('db.tileFlagToggleHint');
});
const selectionStatus = computed(() => {
  const cell = selectedCell.value;
  const state = inspectMvTilesetFlagCell(activeFlags(), cell);
  const first = cell.tileIds[0];
  const last = cell.tileIds[cell.tileIds.length - 1];
  const tile = first === last ? String(first) : `${first}–${last}`;
  return t('db.tileFlagSelection', {
    sheet: cell.sheet.key,
    tile,
    value: stateLabel(state, cell),
  });
});
const imageSignature = computed(() => {
  const names = Array.from({ length: 9 }, (_, index) => String(props.tilesetNames[index] || ''));
  const assets = (props.catalog?.assets.tilesets || []).map((asset) => `${asset.name}:${asset.fileName}:${asset.url}`);
  return JSON.stringify([props.catalog?.project || '', names, assets]);
});

watch(imageSignature, () => void loadTilesetImages(), { immediate: true });
watch(
  [selectedSheetKey, mode, selectedRow, selectedColumn, imageRevision, tileSize, () => props.flags],
  () => void nextTick(paintCanvas),
);
watch(selectedSheetKey, () => {
  selectedRow.value = 0;
  selectedColumn.value = 0;
});

onBeforeUnmount(() => {
  imageRequest += 1;
  dragPaint = null;
});

async function loadTilesetImages(): Promise<void> {
  const request = ++imageRequest;
  const nextImages: (HTMLImageElement | null)[] = Array.from({ length: 9 }, () => null);
  const nextStates: ImageState[] = Array.from({ length: 9 }, (_, index) => (
    String(props.tilesetNames[index] || '').trim() ? 'loading' : 'empty'
  ));
  tilesetImages = nextImages;
  imageStates.value = [...nextStates];

  await Promise.all(Array.from({ length: 9 }, async (_, index) => {
    const name = String(props.tilesetNames[index] || '').trim();
    if (!name) return;
    const asset = findTilesetAsset(name);
    if (!asset) {
      nextStates[index] = 'missing';
      return;
    }
    if (!props.loadImage) {
      nextStates[index] = 'failed';
      return;
    }
    try {
      const image = await props.loadImage(asset.url);
      nextImages[index] = image;
      nextStates[index] = image ? 'ready' : 'failed';
    } catch {
      nextStates[index] = 'failed';
    }
  }));

  if (request !== imageRequest) return;
  tilesetImages = nextImages;
  imageStates.value = [...nextStates];
  imageRevision.value += 1;
  await nextTick();
  paintCanvas();
}

function findTilesetAsset(name: string) {
  return (props.catalog?.assets.tilesets || []).find((asset) => (
    asset.name === name
    || asset.fileName === name
    || asset.fileName.replace(/\.[^.]+$/, '') === name
  ));
}

function activeFlags(): readonly unknown[] {
  return dragPaint?.flags || props.flags || [];
}

function paintCanvas(): void {
  const canvas = canvasRef.value;
  if (!canvas || currentImageState.value !== 'ready') return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const sheet = currentSheet.value;
  const flags = activeFlags();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  for (let row = 0; row < sheet.rows; row += 1) {
    for (let column = 0; column < sheet.columns; column += 1) {
      const x = column * tileSize.value;
      const y = row * tileSize.value;
      drawChecker(context, x, y, row, column);
      const cell = mvTilesetFlagCell(sheet.key, row, column);
      drawTile(context, tilesetImages, cell.representativeTileId, x, y, tileSize.value);
      drawModeOverlay(context, cell, inspectMvTilesetFlagCell(flags, cell), x, y);
    }
  }
  drawCellGrid(context, sheet.columns, sheet.rows);
  context.save();
  context.strokeStyle = '#f7a36a';
  context.lineWidth = 3;
  context.strokeRect(selectedColumn.value * tileSize.value + 1.5, selectedRow.value * tileSize.value + 1.5, tileSize.value - 3, tileSize.value - 3);
  context.restore();
}

function drawChecker(context: CanvasRenderingContext2D, x: number, y: number, row: number, column: number): void {
  context.fillStyle = (row + column) % 2 === 0 ? '#d8d5ce' : '#c7c3bb';
  context.fillRect(x, y, tileSize.value, tileSize.value);
}

function drawCellGrid(context: CanvasRenderingContext2D, columns: number, rows: number): void {
  context.save();
  context.strokeStyle = 'rgba(20, 25, 29, .28)';
  context.lineWidth = 1;
  context.beginPath();
  for (let column = 0; column <= columns; column += 1) {
    context.moveTo(column * tileSize.value + 0.5, 0);
    context.lineTo(column * tileSize.value + 0.5, rows * tileSize.value);
  }
  for (let row = 0; row <= rows; row += 1) {
    context.moveTo(0, row * tileSize.value + 0.5);
    context.lineTo(columns * tileSize.value, row * tileSize.value + 0.5);
  }
  context.stroke();
  context.restore();
}

function drawModeOverlay(
  context: CanvasRenderingContext2D,
  cell: MvTilesetFlagCell,
  state: MvTilesetFlagCellState,
  x: number,
  y: number,
): void {
  if (mode.value === 'passage') {
    const token = state.passage === 'mixed'
      ? '!'
      : state.passage === 'passable'
        ? '○'
        : state.passage === 'blocked'
          ? '×'
          : '☆';
    const color = state.passage === 'passable' ? '#d7ffdc' : state.passage === 'blocked' ? '#ffcfca' : '#ffe8a3';
    drawOverlayToken(context, x, y, token, color);
    if (cell.fixedPassage) drawFixedMark(context, x, y);
    return;
  }
  if (mode.value === 'direction') {
    if (cell.sheet.directionalEditable) drawDirectionOverlay(context, x, y, state);
    return;
  }
  if (mode.value === 'terrain') {
    drawOverlayToken(context, x, y, state.terrainTag === 'mixed' ? '!' : String(state.terrainTag), '#d9f0ff');
    return;
  }
  const value = markerState(state);
  if (value === true) drawOverlayToken(context, x, y, toolSymbol(mode.value), '#f5f1e8');
  else if (value === 'mixed') drawOverlayToken(context, x, y, '!', '#ffe8a3');
}

function drawOverlayToken(context: CanvasRenderingContext2D, x: number, y: number, token: string, color: string): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 29px "JetBrains Mono", monospace';
  context.lineWidth = 5;
  context.strokeStyle = 'rgba(19, 24, 28, .76)';
  context.strokeText(token, x + tileSize.value / 2, y + tileSize.value / 2 + 1);
  context.fillStyle = color;
  context.fillText(token, x + tileSize.value / 2, y + tileSize.value / 2 + 1);
  context.restore();
}

function drawFixedMark(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.fillStyle = 'rgba(19, 24, 28, .78)';
  context.fillRect(x + tileSize.value - 13, y + 2, 10, 10);
  context.strokeStyle = '#ffe8a3';
  context.lineWidth = 1.5;
  context.strokeRect(x + tileSize.value - 11, y + 5, 6, 5);
  context.restore();
}

function drawDirectionOverlay(context: CanvasRenderingContext2D, x: number, y: number, state: MvTilesetFlagCellState): void {
  const entries: Array<{ token: string; value: MvTilesetAggregate<boolean>; dx: number; dy: number }> = [
    { token: '↑', value: state.upBlocked, dx: 24, dy: 10 },
    { token: '→', value: state.rightBlocked, dx: 38, dy: 24 },
    { token: '↓', value: state.downBlocked, dx: 24, dy: 39 },
    { token: '←', value: state.leftBlocked, dx: 10, dy: 24 },
  ];
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 16px "JetBrains Mono", monospace';
  context.lineWidth = 3;
  for (const entry of entries) {
    if (entry.value === true) continue;
    const token = entry.value === 'mixed' ? '?' : entry.token;
    context.strokeStyle = 'rgba(19, 24, 28, .78)';
    context.strokeText(token, x + entry.dx, y + entry.dy);
    context.fillStyle = entry.value === 'mixed' ? '#ffe8a3' : '#e7f7ff';
    context.fillText(token, x + entry.dx, y + entry.dy);
  }
  context.restore();
}

function beginPointerPaint(event: PointerEvent): void {
  if ((event.button !== 0 && event.button !== 2) || currentImageState.value !== 'ready') return;
  if (mode.value === 'direction' && !currentSheet.value.directionalEditable) return;
  const hit = pointerHit(event);
  if (!hit) return;
  event.preventDefault();
  canvasRef.value?.focus();
  selectHit(hit);
  const cell = mvTilesetFlagCell(selectedSheetKey.value, hit.row, hit.column);
  const direction = mode.value === 'direction' ? directionFromHit(hit) : selectedDirection.value;
  selectedDirection.value = direction;
  const origin = [...(props.flags || [])];
  const edit = buildEdit(origin, cell, event.button === 2, direction);
  if (!edit) return;
  const next = applyEditToCell(origin, cell, edit);
  dragPaint = {
    pointerId: event.pointerId,
    flags: next,
    edit,
    visited: new Set([cellKey(cell)]),
    changed: !sameFlags(origin, next),
  };
  canvasRef.value?.setPointerCapture(event.pointerId);
  paintCanvas();
}

function continuePointerPaint(event: PointerEvent): void {
  if (!dragPaint || dragPaint.pointerId !== event.pointerId) return;
  const hit = pointerHit(event);
  if (!hit) return;
  selectHit(hit);
  const cell = mvTilesetFlagCell(selectedSheetKey.value, hit.row, hit.column);
  const key = cellKey(cell);
  if (dragPaint.visited.has(key)) return;
  dragPaint.visited.add(key);
  const next = applyEditToCell(dragPaint.flags, cell, dragPaint.edit);
  dragPaint.changed ||= !sameFlags(dragPaint.flags, next);
  dragPaint.flags = next;
  paintCanvas();
}

function finishPointerPaint(event: PointerEvent): void {
  if (!dragPaint || dragPaint.pointerId !== event.pointerId) return;
  const completed = dragPaint;
  dragPaint = null;
  if (canvasRef.value?.hasPointerCapture(event.pointerId)) canvasRef.value.releasePointerCapture(event.pointerId);
  if (completed.changed) emit('update:flags', completed.flags);
  void nextTick(paintCanvas);
}

function cancelPointerPaint(event: PointerEvent): void {
  if (!dragPaint || dragPaint.pointerId !== event.pointerId) return;
  dragPaint = null;
  void nextTick(paintCanvas);
}

function handleCanvasKeydown(event: KeyboardEvent): void {
  const sheet = currentSheet.value;
  if (event.key === 'ArrowUp') selectedRow.value = Math.max(0, selectedRow.value - 1);
  else if (event.key === 'ArrowDown') selectedRow.value = Math.min(sheet.rows - 1, selectedRow.value + 1);
  else if (event.key === 'ArrowLeft') selectedColumn.value = Math.max(0, selectedColumn.value - 1);
  else if (event.key === 'ArrowRight') selectedColumn.value = Math.min(sheet.columns - 1, selectedColumn.value + 1);
  else if (event.key === 'Enter' || event.key === ' ') {
    if (currentImageState.value !== 'ready' || (mode.value === 'direction' && !sheet.directionalEditable)) return;
    const origin = [...(props.flags || [])];
    const edit = buildEdit(origin, selectedCell.value, event.shiftKey, selectedDirection.value);
    if (!edit) return;
    const next = applyEditToCell(origin, selectedCell.value, edit);
    if (!sameFlags(origin, next)) emit('update:flags', next);
  } else return;
  event.preventDefault();
  void nextTick(paintCanvas);
}

function buildEdit(
  flags: readonly unknown[],
  cell: MvTilesetFlagCell,
  reverse: boolean,
  direction: MvTilesetDirectionBit,
): MvTilesetFlagEdit | null {
  const state = inspectMvTilesetFlagCell(flags, cell);
  if (mode.value === 'passage') {
    return {
      kind: 'passage',
      value: cell.fixedPassage || nextMvTilesetPassage(state.passage, cell.sheet.allowsStar, reverse),
    };
  }
  if (mode.value === 'direction') {
    if (!cell.sheet.directionalEditable) return null;
    const current = directionState(state, direction);
    return { kind: 'direction', bit: direction, blocked: current !== true };
  }
  if (mode.value === 'terrain') {
    return { kind: 'terrain', value: nextMvTilesetTerrainTag(state.terrainTag, reverse) };
  }
  const bit = markerBit(mode.value);
  if (!bit) return null;
  return { kind: 'marker', bit, enabled: markerState(state) !== true };
}

function applyEditToCell(flags: readonly unknown[], cell: MvTilesetFlagCell, edit: MvTilesetFlagEdit): unknown[] {
  if (edit.kind === 'passage' && cell.fixedPassage && edit.value !== cell.fixedPassage) return [...flags];
  return applyMvTilesetFlagEdit(flags, cell, edit);
}

function pointerHit(event: PointerEvent): PointerHit | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  const column = Math.floor(x / tileSize.value);
  const row = Math.floor(y / tileSize.value);
  if (column < 0 || row < 0 || column >= currentSheet.value.columns || row >= currentSheet.value.rows) return null;
  return { row, column, localX: x % tileSize.value, localY: y % tileSize.value };
}

function selectHit(hit: PointerHit): void {
  selectedRow.value = hit.row;
  selectedColumn.value = hit.column;
}

function directionFromHit(hit: PointerHit): MvTilesetDirectionBit {
  const dx = hit.localX - tileSize.value / 2;
  const dy = hit.localY - tileSize.value / 2;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? MV_TILESET_FLAG_BITS.left : MV_TILESET_FLAG_BITS.right;
  if (Math.abs(dy) > 0) return dy < 0 ? MV_TILESET_FLAG_BITS.up : MV_TILESET_FLAG_BITS.down;
  return selectedDirection.value;
}

function directionState(state: MvTilesetFlagCellState, bit: MvTilesetDirectionBit): MvTilesetAggregate<boolean> {
  if (bit === MV_TILESET_FLAG_BITS.up) return state.upBlocked;
  if (bit === MV_TILESET_FLAG_BITS.right) return state.rightBlocked;
  if (bit === MV_TILESET_FLAG_BITS.left) return state.leftBlocked;
  return state.downBlocked;
}

function markerBit(value: FlagMode): MvTilesetMarkerBit | null {
  if (value === 'ladder') return MV_TILESET_FLAG_BITS.ladder;
  if (value === 'bush') return MV_TILESET_FLAG_BITS.bush;
  if (value === 'counter') return MV_TILESET_FLAG_BITS.counter;
  if (value === 'damage') return MV_TILESET_FLAG_BITS.damage;
  return null;
}

function markerState(state: MvTilesetFlagCellState): MvTilesetAggregate<boolean> {
  if (mode.value === 'ladder') return state.ladder;
  if (mode.value === 'bush') return state.bush;
  if (mode.value === 'counter') return state.counter;
  if (mode.value === 'damage') return state.damage;
  return false;
}

function toolSymbol(value: FlagMode): string {
  return tools.value.find((tool) => tool.key === value)?.symbol || '';
}

function stateLabel(state: MvTilesetFlagCellState, cell: MvTilesetFlagCell): string {
  if (mode.value === 'passage') {
    if (state.passage === 'mixed') return t('db.tileFlagMixed');
    if (cell.fixedPassage && state.passage !== 'star') return t('db.tileFlagFixedNeedsRepair');
    if (state.passage === 'passable') return t('db.tileFlagPassable');
    if (state.passage === 'blocked') return t('db.tileFlagBlocked');
    return t('db.tileFlagStar');
  }
  if (mode.value === 'direction') {
    if (!cell.sheet.directionalEditable) return t('db.tileFlagAutomatic');
    const arrows = [
      state.upBlocked === false ? '↑' : '',
      state.rightBlocked === false ? '→' : '',
      state.downBlocked === false ? '↓' : '',
      state.leftBlocked === false ? '←' : '',
    ].join('');
    if ([state.upBlocked, state.rightBlocked, state.downBlocked, state.leftBlocked].includes('mixed')) return t('db.tileFlagMixed');
    return arrows || t('db.tileFlagNoDirection');
  }
  if (mode.value === 'terrain') return state.terrainTag === 'mixed' ? t('db.tileFlagMixed') : String(state.terrainTag);
  const value = markerState(state);
  return value === 'mixed' ? t('db.tileFlagMixed') : value ? t('db.tileFlagEnabled') : t('db.tileFlagDisabled');
}

function cellKey(cell: MvTilesetFlagCell): string {
  return `${cell.sheet.key}:${cell.row}:${cell.column}`;
}

function sameFlags(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}
</script>

<style scoped>
.tileset-flag-canvas-editor {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.flag-tool-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.flag-tool-strip button,
.sheet-strip button {
  min-width: 0;
  border: 1px solid var(--app-border);
  border-radius: 5px;
  background: var(--app-bg);
  color: var(--app-ink);
  cursor: pointer;
}

.flag-tool-strip button {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 2px;
  align-items: center;
  min-height: 34px;
  padding: 3px 6px;
  font-size: 11px;
  text-align: left;
}

.flag-tool-strip button:hover,
.sheet-strip button:hover {
  border-color: color-mix(in srgb, var(--app-accent) 45%, var(--app-border));
  color: var(--app-ink);
}

.flag-tool-strip button.active,
.sheet-strip button.active {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
  color: var(--app-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 20%, transparent);
}

.tool-symbol {
  font-family: "JetBrains Mono", monospace;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
}

.sheet-strip {
  display: grid;
  grid-template-columns: repeat(9, minmax(28px, 1fr));
  gap: 3px;
}

.sheet-strip button {
  min-height: 27px;
  padding: 2px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 700;
}

.canvas-frame {
  min-height: 86px;
  max-height: 460px;
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background-color: #cbc7bf;
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, .32) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, .32) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, .32) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, .32) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.canvas-frame.unavailable {
  display: grid;
  place-items: center;
}

canvas {
  display: block;
  max-width: none;
  image-rendering: pixelated;
  touch-action: none;
  user-select: none;
  cursor: crosshair;
  outline: none;
}

canvas:focus-visible {
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--app-accent) 72%, transparent);
}

.canvas-state {
  display: grid;
  justify-items: center;
  gap: 4px;
  max-width: 320px;
  padding: 20px;
  color: var(--app-ink-muted);
  font-size: 12px;
  text-align: center;
}

.canvas-state strong {
  color: var(--app-ink);
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
}

.flag-editor-status {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--app-ink-muted);
  font-size: 11px;
  line-height: 1.35;
}

.selection-status {
  overflow: hidden;
  color: var(--app-ink);
  font-family: "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-hint {
  min-height: 15px;
}

@media (max-width: 1120px) {
  .flag-tool-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
