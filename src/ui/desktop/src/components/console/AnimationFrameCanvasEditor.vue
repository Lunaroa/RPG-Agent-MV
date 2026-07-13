<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  appendAnimationFrame,
  appendAnimationFrameCell,
  duplicateAnimationFrame,
  MV_ANIMATION_BLEND_MODES,
  MV_ANIMATION_CELL_FIELDS,
  normalizeAnimationFrames,
  removeAnimationFrame,
  removeAnimationFrameCell,
  setAnimationFrameCellValue,
} from '../../utils/rmmvDatabaseEditor';
import { localizeDatabaseLabel, localizeDatabaseOptions } from '../../utils/rmmvDatabaseLocalization';
import { rotateHuePixelsLikeMv } from '../../utils/rmmvHue';

const WIDTH = 816;
const HEIGHT = 624;
const CELL_SIZE = 192;
const PALETTE_CELL = 44;
const PALETTE_COLUMNS = 5;
const PALETTE_ROWS_PER_SHEET = 20;

const props = defineProps<{
  modelValue: unknown;
  catalog: EditorProjectCatalog | null;
  animation1Name: string;
  animation1Hue: number;
  animation2Name: string;
  animation2Hue: number;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const { language, t } = useI18n();
const canvas = ref<HTMLCanvasElement | null>(null);
const paletteCanvas = ref<HTMLCanvasElement | null>(null);
const selectedFrameIndex = ref(0);
const selectedCellIndex = ref(0);
const errors = ref<string[]>([]);
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const hueCache = new Map<string, HTMLCanvasElement>();
let renderVersion = 0;
let drag: { cellIndex: number; startX: number; startY: number; originalX: number; originalY: number } | null = null;

const frames = computed(() => normalizeAnimationFrames(props.modelValue));
const selectedFrame = computed(() => frames.value[selectedFrameIndex.value] || []);
const selectedCell = computed(() => selectedFrame.value[selectedCellIndex.value] || null);
const blendModes = computed(() => localizeDatabaseOptions(MV_ANIMATION_BLEND_MODES, language.value));
const hasPluginCellData = computed(() => (
  Array.isArray(props.modelValue)
  && props.modelValue.some((frame) => (
    Array.isArray(frame) && frame.some((cell) => Array.isArray(cell) && cell.length > MV_ANIMATION_CELL_FIELDS.length)
  ))
));

watch(
  () => [
    props.modelValue,
    props.catalog?.project,
    props.animation1Name,
    props.animation1Hue,
    props.animation2Name,
    props.animation2Hue,
    selectedFrameIndex.value,
    selectedCellIndex.value,
  ],
  () => {
    clampSelection();
    void renderCanvas();
    void renderPalette();
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  renderVersion += 1;
});

function clampSelection(): void {
  selectedFrameIndex.value = Math.min(Math.max(0, selectedFrameIndex.value), Math.max(0, frames.value.length - 1));
  selectedCellIndex.value = Math.min(Math.max(0, selectedCellIndex.value), Math.max(0, selectedFrame.value.length - 1));
}

function chooseFrame(index: number): void {
  selectedFrameIndex.value = Math.min(Math.max(0, index), Math.max(0, frames.value.length - 1));
  selectedCellIndex.value = 0;
}

function chooseCell(index: number): void {
  selectedCellIndex.value = Math.min(Math.max(0, index), Math.max(0, selectedFrame.value.length - 1));
}

function addFrame(): void {
  const next = appendAnimationFrame(props.modelValue);
  emit('update:modelValue', next);
  selectedFrameIndex.value = Math.max(0, next.length - 1);
  selectedCellIndex.value = 0;
}

function duplicateFrame(): void {
  if (!frames.value.length) return;
  const next = duplicateAnimationFrame(props.modelValue, selectedFrameIndex.value);
  emit('update:modelValue', next);
  selectedFrameIndex.value = Math.min(next.length - 1, selectedFrameIndex.value + 1);
  selectedCellIndex.value = 0;
}

function deleteFrame(): void {
  if (!frames.value.length) return;
  const next = removeAnimationFrame(props.modelValue, selectedFrameIndex.value);
  emit('update:modelValue', next);
  selectedFrameIndex.value = Math.min(selectedFrameIndex.value, Math.max(0, next.length - 1));
  selectedCellIndex.value = 0;
}

function addCell(): void {
  if (!frames.value.length) return;
  const next = appendAnimationFrameCell(props.modelValue, selectedFrameIndex.value);
  emit('update:modelValue', next);
  selectedCellIndex.value = Math.max(0, (next[selectedFrameIndex.value]?.length || 1) - 1);
}

function deleteCell(): void {
  if (!selectedCell.value) return;
  const next = removeAnimationFrameCell(props.modelValue, selectedFrameIndex.value, selectedCellIndex.value);
  emit('update:modelValue', next);
  selectedCellIndex.value = Math.min(selectedCellIndex.value, Math.max(0, (next[selectedFrameIndex.value]?.length || 1) - 1));
}

function updateCell(fieldIndex: number, value: unknown): void {
  if (!selectedCell.value) return;
  emit('update:modelValue', setAnimationFrameCellValue(
    props.modelValue,
    selectedFrameIndex.value,
    selectedCellIndex.value,
    fieldIndex,
    Number(value),
  ));
}

function toggleMirror(event: Event): void {
  updateCell(5, (event.target as HTMLInputElement).checked ? 1 : 0);
}

async function renderCanvas(previewFrame?: number[][]): Promise<void> {
  const version = ++renderVersion;
  await nextTick();
  const target = canvas.value;
  const context = target?.getContext('2d', { willReadFrequently: true });
  if (!target || !context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  drawCanvasBackground(context);
  const nextErrors: string[] = [];
  const sheets = await Promise.all([
    loadSheet(0, nextErrors),
    loadSheet(1, nextErrors),
  ]);
  if (version !== renderVersion) return;
  const cells = previewFrame || selectedFrame.value;
  for (let index = 0; index < cells.length; index += 1) {
    drawCell(context, cells[index], sheets, index === selectedCellIndex.value);
  }
  errors.value = [...new Set(nextErrors)];
}

function drawCanvasBackground(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.save();
  context.strokeStyle = 'rgba(157, 170, 184, .09)';
  context.lineWidth = 1;
  for (let x = 24; x < WIDTH; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();
  }
  for (let y = 24; y < HEIGHT; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(245, 184, 75, .4)';
  context.beginPath();
  context.moveTo(WIDTH / 2, 0);
  context.lineTo(WIDTH / 2, HEIGHT);
  context.moveTo(0, HEIGHT / 2);
  context.lineTo(WIDTH, HEIGHT / 2);
  context.stroke();
  context.restore();
}

function drawCell(
  context: CanvasRenderingContext2D,
  cell: number[],
  sheets: Array<HTMLImageElement | HTMLCanvasElement | null>,
  selected: boolean,
): void {
  const pattern = cell[0];
  if (pattern < 0 || pattern > 199) return;
  const localPattern = pattern % 100;
  const sheet = sheets[Math.floor(pattern / 100)];
  if (!sheet) return;
  const scale = cell[3] / 100;
  const sourceX = (localPattern % PALETTE_COLUMNS) * CELL_SIZE;
  const sourceY = Math.floor(localPattern / PALETTE_COLUMNS) * CELL_SIZE;
  context.save();
  context.translate(WIDTH / 2 + cell[1], HEIGHT / 2 + cell[2]);
  context.rotate(cell[4] * Math.PI / 180);
  context.scale(cell[5] ? -scale : scale, scale);
  context.globalAlpha = cell[6] / 255;
  context.globalCompositeOperation = blendOperation(cell[7]);
  context.drawImage(sheet, sourceX, sourceY, CELL_SIZE, CELL_SIZE, -CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE);
  if (selected) {
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = '#f5b84b';
    context.lineWidth = Math.max(1, 2 / Math.max(scale, .01));
    context.setLineDash([8 / Math.max(scale, .01), 5 / Math.max(scale, .01)]);
    context.strokeRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE);
  }
  context.restore();
}

function blendOperation(mode: number): GlobalCompositeOperation {
  if (mode === 1) return 'lighter';
  if (mode === 2) return 'multiply';
  if (mode === 3) return 'screen';
  return 'source-over';
}

async function loadSheet(index: 0 | 1, nextErrors: string[]): Promise<HTMLImageElement | HTMLCanvasElement | null> {
  const name = index === 0 ? props.animation1Name : props.animation2Name;
  const hue = index === 0 ? props.animation1Hue : props.animation2Hue;
  const isNeeded = selectedFrame.value.some((cell) => cell[0] >= index * 100 && cell[0] < (index + 1) * 100);
  if (!name) {
    if (isNeeded) nextErrors.push(t('db.animationSheetUnassigned', { sheet: index + 1 }));
    return null;
  }
  const asset = props.catalog?.assets.animations.find((entry) => entry.name === name);
  if (!asset) {
    nextErrors.push(t('db.animationSheetMissing', { name }));
    return null;
  }
  const image = await load(asset.url);
  if (!image) {
    nextErrors.push(t('db.animationSheetMissing', { name }));
    return null;
  }
  const normalizedHue = ((Math.trunc(hue) % 360) + 360) % 360;
  if (!normalizedHue) return image;
  const key = `${asset.url}|${normalizedHue}`;
  const cached = hueCache.get(key);
  if (cached) return cached;
  const tinted = document.createElement('canvas');
  tinted.width = image.width;
  tinted.height = image.height;
  const context = tinted.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  rotateHuePixelsLikeMv(imageData.data, normalizedHue);
  context.putImageData(imageData, 0, 0);
  hueCache.set(key, tinted);
  return tinted;
}

function load(url: string): Promise<HTMLImageElement | null> {
  if (!props.loadImage) return Promise.resolve(null);
  const cached = imageCache.get(url);
  if (cached) return cached;
  const result = props.loadImage(url).catch(() => null);
  imageCache.set(url, result);
  return result;
}

function pointerPosition(event: PointerEvent): { x: number; y: number } {
  const bounds = canvas.value!.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * WIDTH / bounds.width,
    y: (event.clientY - bounds.top) * HEIGHT / bounds.height,
  };
}

function hitTest(x: number, y: number): number {
  for (let index = selectedFrame.value.length - 1; index >= 0; index -= 1) {
    const cell = selectedFrame.value[index];
    if (cell[0] < 0 || cell[0] > 199) continue;
    const scale = Math.max(.01, cell[3] / 100);
    const dx = x - (WIDTH / 2 + cell[1]);
    const dy = y - (HEIGHT / 2 + cell[2]);
    const angle = -cell[4] * Math.PI / 180;
    const localX = (Math.cos(angle) * dx - Math.sin(angle) * dy) / scale;
    const localY = (Math.sin(angle) * dx + Math.cos(angle) * dy) / scale;
    if (Math.abs(localX) <= CELL_SIZE / 2 && Math.abs(localY) <= CELL_SIZE / 2) return index;
  }
  return -1;
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const point = pointerPosition(event);
  const index = hitTest(point.x, point.y);
  if (index < 0) return;
  chooseCell(index);
  const cell = selectedFrame.value[index];
  drag = { cellIndex: index, startX: point.x, startY: point.y, originalX: cell[1], originalY: cell[2] };
  canvas.value?.setPointerCapture(event.pointerId);
}

function previewDrag(event: PointerEvent): void {
  if (!drag) return;
  const point = pointerPosition(event);
  const preview = selectedFrame.value.map((cell) => [...cell]);
  preview[drag.cellIndex][1] = clamp(Math.round(drag.originalX + point.x - drag.startX), -408, 408);
  preview[drag.cellIndex][2] = clamp(Math.round(drag.originalY + point.y - drag.startY), -312, 312);
  void renderCanvas(preview);
}

function finishDrag(event: PointerEvent): void {
  if (!drag) return;
  const current = drag;
  drag = null;
  const point = pointerPosition(event);
  const x = clamp(Math.round(current.originalX + point.x - current.startX), -408, 408);
  const y = clamp(Math.round(current.originalY + point.y - current.startY), -312, 312);
  if (x === current.originalX && y === current.originalY) {
    void renderCanvas();
    return;
  }
  const withX = setAnimationFrameCellValue(props.modelValue, selectedFrameIndex.value, current.cellIndex, 1, x);
  emit('update:modelValue', setAnimationFrameCellValue(withX, selectedFrameIndex.value, current.cellIndex, 2, y));
}

function cancelDrag(): void {
  if (!drag) return;
  drag = null;
  void renderCanvas();
}

async function renderPalette(): Promise<void> {
  await nextTick();
  const target = paletteCanvas.value;
  const context = target?.getContext('2d', { willReadFrequently: true });
  if (!target || !context) return;
  context.clearRect(0, 0, target.width, target.height);
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, target.width, target.height);
  const nextErrors: string[] = [];
  const sheets = await Promise.all([loadSheet(0, nextErrors), loadSheet(1, nextErrors)]);
  for (let pattern = 0; pattern < 200; pattern += 1) {
    const sheetIndex = Math.floor(pattern / 100);
    const sheetPattern = pattern % 100;
    const x = (sheetPattern % PALETTE_COLUMNS) * PALETTE_CELL;
    const y = (sheetIndex * PALETTE_ROWS_PER_SHEET + Math.floor(sheetPattern / PALETTE_COLUMNS)) * PALETTE_CELL;
    const sheet = sheets[sheetIndex];
    if (sheet) {
      context.drawImage(
        sheet,
        (sheetPattern % PALETTE_COLUMNS) * CELL_SIZE,
        Math.floor(sheetPattern / PALETTE_COLUMNS) * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE,
        x,
        y,
        PALETTE_CELL,
        PALETTE_CELL,
      );
    }
    context.strokeStyle = selectedCell.value?.[0] === pattern ? '#f5b84b' : 'rgba(157, 170, 184, .25)';
    context.lineWidth = selectedCell.value?.[0] === pattern ? 3 : 1;
    context.strokeRect(x + .5, y + .5, PALETTE_CELL - 1, PALETTE_CELL - 1);
  }
}

function choosePattern(event: MouseEvent): void {
  if (!selectedCell.value) return;
  const target = paletteCanvas.value;
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * target.width / bounds.width;
  const y = (event.clientY - bounds.top) * target.height / bounds.height;
  const column = Math.floor(x / PALETTE_CELL);
  const row = Math.floor(y / PALETTE_CELL);
  if (column < 0 || column >= PALETTE_COLUMNS || row < 0 || row >= PALETTE_ROWS_PER_SHEET * 2) return;
  const sheet = row >= PALETTE_ROWS_PER_SHEET ? 1 : 0;
  updateCell(0, sheet * 100 + (row % PALETTE_ROWS_PER_SHEET) * PALETTE_COLUMNS + column);
}

function fieldLabel(index: number): string {
  return localizeDatabaseLabel(MV_ANIMATION_CELL_FIELDS[index].label, language.value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
</script>

<template>
  <div class="animation-editor">
    <div class="frame-toolbar">
      <div class="frame-strip" :aria-label="t('db.animationFrames')">
        <button
          v-for="(_frame, index) in frames"
          :key="`frame-${index}`"
          type="button"
          :class="{ active: selectedFrameIndex === index }"
          @click="chooseFrame(index)"
        >
          {{ index + 1 }}
        </button>
      </div>
      <span>{{ frames.length }} / 200</span>
      <button type="button" :disabled="frames.length >= 200" @click="addFrame">{{ t('db.addFrame') }}</button>
      <button type="button" :disabled="!frames.length || frames.length >= 200" @click="duplicateFrame">{{ t('db.duplicateFrame') }}</button>
      <button type="button" class="danger" :disabled="!frames.length" @click="deleteFrame">{{ t('db.deleteFrame') }}</button>
    </div>

    <div v-if="!frames.length" class="empty-note">{{ t('db.noAnimFrames') }}</div>
    <template v-else>
      <div class="cell-toolbar">
        <div class="cell-strip">
          <button
            v-for="(cell, index) in selectedFrame"
            :key="`cell-${index}`"
            type="button"
            :class="{ active: selectedCellIndex === index }"
            @click="chooseCell(index)"
          >
            {{ index + 1 }}<small>#{{ cell[0] }}</small>
          </button>
        </div>
        <span>{{ selectedFrame.length }} / 16</span>
        <button type="button" :disabled="selectedFrame.length >= 16" @click="addCell">{{ t('db.addCell') }}</button>
        <button type="button" class="danger" :disabled="!selectedCell" @click="deleteCell">{{ t('cmdList.delete') }}</button>
      </div>

      <div class="canvas-workspace">
        <div class="canvas-column">
          <canvas
            ref="canvas"
            :width="WIDTH"
            :height="HEIGHT"
            :aria-label="t('db.animationCanvas')"
            @pointerdown="startDrag"
            @pointermove="previewDrag"
            @pointerup="finishDrag"
            @pointercancel="cancelDrag"
          />
          <div v-if="errors.length" class="animation-errors" role="alert">
            <span v-for="message in errors" :key="message">{{ message }}</span>
          </div>
        </div>

        <aside v-if="selectedCell" class="cell-controls">
          <label>
            <span>{{ fieldLabel(0) }}</span>
            <input type="number" min="-1" max="199" :value="selectedCell[0]" @input="updateCell(0, ($event.target as HTMLInputElement).value)" />
          </label>
          <details class="pattern-palette">
            <summary>{{ t('db.chooseAnimationPattern') }}</summary>
            <div class="palette-scroll">
              <canvas
                ref="paletteCanvas"
                :width="PALETTE_COLUMNS * PALETTE_CELL"
                :height="PALETTE_ROWS_PER_SHEET * 2 * PALETTE_CELL"
                @click="choosePattern"
              />
            </div>
          </details>
          <div class="control-grid">
            <label><span>{{ fieldLabel(1) }}</span><input type="number" min="-408" max="408" :value="selectedCell[1]" @input="updateCell(1, ($event.target as HTMLInputElement).value)" /></label>
            <label><span>{{ fieldLabel(2) }}</span><input type="number" min="-312" max="312" :value="selectedCell[2]" @input="updateCell(2, ($event.target as HTMLInputElement).value)" /></label>
            <label><span>{{ fieldLabel(3) }} %</span><input type="number" min="20" max="800" :value="selectedCell[3]" @input="updateCell(3, ($event.target as HTMLInputElement).value)" /></label>
            <label><span>{{ fieldLabel(4) }} °</span><input type="number" min="-360" max="360" :value="selectedCell[4]" @input="updateCell(4, ($event.target as HTMLInputElement).value)" /></label>
            <label><span>{{ fieldLabel(6) }}</span><input type="number" min="0" max="255" :value="selectedCell[6]" @input="updateCell(6, ($event.target as HTMLInputElement).value)" /></label>
            <label>
              <span>{{ fieldLabel(7) }}</span>
              <select :value="selectedCell[7]" @change="updateCell(7, ($event.target as HTMLSelectElement).value)">
                <option v-for="option in blendModes" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>
          <label class="mirror"><input type="checkbox" :checked="selectedCell[5] === 1" @change="toggleMirror" /> {{ fieldLabel(5) }}</label>
          <small>{{ t('db.animationDragHint') }}</small>
        </aside>
      </div>
    </template>

    <small v-if="hasPluginCellData" class="plugin-note">{{ t('db.pluginAnimationCellReadonly') }}</small>
  </div>
</template>

<style scoped>
.animation-editor { display: grid; gap: 8px; min-width: 0; }
.frame-toolbar, .cell-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.frame-toolbar > span, .cell-toolbar > span { color: var(--el-text-color-secondary); font-size: 10px; white-space: nowrap; }
.frame-strip, .cell-strip { display: flex; flex: 1 0 100%; gap: 3px; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
.frame-strip button { min-width: 34px; padding: 4px 6px; }
.cell-strip button { display: grid; min-width: 42px; padding: 3px 5px; line-height: 1.1; }
.cell-strip small { color: var(--el-text-color-secondary); font-size: 9px; }
.frame-strip button.active, .cell-strip button.active { color: var(--el-color-primary); border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); }
.canvas-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; align-items: start; }
.canvas-column { min-width: 0; }
.canvas-column > canvas { display: block; width: 100%; aspect-ratio: 816 / 624; border: 1px solid var(--console-border, #3c424a); border-radius: 5px; cursor: move; image-rendering: auto; }
.cell-controls { display: grid; gap: 7px; }
.cell-controls label { display: grid; gap: 3px; }
.cell-controls label > span { color: var(--el-text-color-secondary); font-size: 10px; }
.cell-controls input, .cell-controls select { width: 100%; min-width: 0; }
.control-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cell-controls .mirror { display: flex; align-items: center; gap: 6px; color: var(--el-text-color-secondary); font-size: 11px; }
.cell-controls .mirror input { width: auto; }
.cell-controls > small { color: var(--el-text-color-secondary); font-size: 10px; }
.pattern-palette { border-top: 1px solid var(--console-border, #3c424a); border-bottom: 1px solid var(--console-border, #3c424a); padding: 6px 0; }
.pattern-palette summary { color: var(--el-text-color-secondary); cursor: pointer; font-size: 11px; }
.palette-scroll { max-height: 290px; margin-top: 6px; overflow: auto; background: #171a1f; }
.palette-scroll canvas { display: block; width: 100%; height: auto; cursor: crosshair; image-rendering: auto; }
.animation-errors { display: grid; gap: 2px; padding: 5px 7px; color: var(--el-color-danger); font-size: 10px; }
.plugin-note { padding: 5px 7px; border: 1px dashed var(--console-border, #3c424a); border-radius: 4px; color: var(--el-text-color-secondary); font-size: 10px; }
button.danger { color: var(--el-color-danger); }
</style>
