<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorEnemyCatalogEntry, EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import { normalizeTroopMembers, type MvTroopMember } from '../../utils/rmmvDatabaseEditor';
import { rotateHuePixelsLikeMv } from '../../utils/rmmvHue';
import { enemyBattlerAssetKind } from '../../utils/rmmvBattleAssets.ts';

const WIDTH = 816;
const HEIGHT = 624;

const props = defineProps<{
  modelValue: unknown[];
  catalog: EditorProjectCatalog | null;
  battleback1Name: string;
  battleback2Name: string;
  selectedIndex: number;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MvTroopMember[]];
  'update:selectedIndex': [value: number];
}>();

const { t } = useI18n();
const canvas = ref<HTMLCanvasElement | null>(null);
const errors = ref<string[]>([]);
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const hueCache = new Map<string, HTMLCanvasElement>();
let renderVersion = 0;
let memberBounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];
let drag: { index: number; startX: number; startY: number; originalX: number; originalY: number } | null = null;

watch(
  () => [
    props.modelValue,
    props.catalog?.project,
    props.catalog?.battle.sideView,
    props.battleback1Name,
    props.battleback2Name,
    props.selectedIndex,
  ],
  () => void renderFormation(),
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  renderVersion += 1;
});

async function renderFormation(preview?: MvTroopMember[]): Promise<void> {
  const version = ++renderVersion;
  await nextTick();
  const target = canvas.value;
  const context = target?.getContext('2d', { willReadFrequently: true });
  if (!target || !context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#171b20';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const nextErrors: string[] = [];

  await drawBattleback(context, 'battlebacks1', props.battleback1Name, nextErrors);
  await drawBattleback(context, 'battlebacks2', props.battleback2Name, nextErrors);
  if (version !== renderVersion) return;

  const members = preview || normalizeTroopMembers(props.modelValue);
  const bounds: typeof memberBounds = [];
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const enemy = props.catalog?.enemies.find((entry) => entry.id === member.enemyId);
    const image = await loadEnemyImage(enemy, nextErrors);
    if (version !== renderVersion) return;
    const width = image?.width || 64;
    const height = image?.height || 64;
    const left = Math.round(member.x - width / 2);
    const top = Math.round(member.y - height);
    bounds[index] = { left, top, right: left + width, bottom: top + height };
    if (image) {
      context.save();
      context.globalAlpha = member.hidden ? 0.48 : 1;
      context.drawImage(image, left, top);
      context.restore();
    } else {
      drawMissingEnemy(context, member, enemy?.name || `#${member.enemyId}`);
    }
    if (index === props.selectedIndex) drawSelection(context, bounds[index]);
    if (member.hidden) drawHiddenMark(context, member.x, member.y);
  }
  memberBounds = bounds;
  errors.value = [...new Set(nextErrors)];
}

async function drawBattleback(
  context: CanvasRenderingContext2D,
  kind: 'battlebacks1' | 'battlebacks2',
  name: string,
  nextErrors: string[],
): Promise<void> {
  if (!name) return;
  const asset = props.catalog?.assets[kind].find((entry) => entry.name === name);
  if (!asset) {
    nextErrors.push(t('db.troopMissingBattleback', { name, kind }));
    return;
  }
  const image = await load(asset.url);
  if (!image) {
    nextErrors.push(t('db.troopMissingBattleback', { name, kind }));
    return;
  }
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
}

async function loadEnemyImage(
  enemy: EditorEnemyCatalogEntry | undefined,
  nextErrors: string[],
): Promise<HTMLImageElement | HTMLCanvasElement | null> {
  if (!enemy || !enemy.battlerName) {
    nextErrors.push(t('db.troopMissingEnemyGraphic', { name: enemy?.name || t('story.unnamed') }));
    return null;
  }
  const kind = enemyBattlerAssetKind(props.catalog?.battle.sideView === true);
  const asset = props.catalog?.assets[kind].find((entry) => entry.name === enemy.battlerName);
  if (!asset) {
    nextErrors.push(t('db.troopMissingEnemyGraphic', { name: enemy.battlerName }));
    return null;
  }
  const image = await load(asset.url);
  if (!image) {
    nextErrors.push(t('db.troopMissingEnemyGraphic', { name: enemy.battlerName }));
    return null;
  }
  const hue = ((Math.trunc(enemy.battlerHue) % 360) + 360) % 360;
  if (!hue) return image;
  const key = `${asset.url}|${hue}`;
  const cached = hueCache.get(key);
  if (cached) return cached;
  const tinted = document.createElement('canvas');
  tinted.width = image.width;
  tinted.height = image.height;
  const context = tinted.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  rotateHueLikeMv(context, image.width, image.height, hue);
  hueCache.set(key, tinted);
  return tinted;
}

function load(url: string): Promise<HTMLImageElement | null> {
  if (!props.loadImage) return Promise.resolve(null);
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = props.loadImage(url);
  imageCache.set(url, promise);
  return promise;
}

function pointerPosition(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = canvas.value!.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * WIDTH / rect.width),
    y: Math.round((event.clientY - rect.top) * HEIGHT / rect.height),
  };
}

function hitTest(x: number, y: number): number {
  for (let index = memberBounds.length - 1; index >= 0; index -= 1) {
    const bounds = memberBounds[index];
    if (bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) return index;
  }
  return -1;
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const point = pointerPosition(event);
  const index = hitTest(point.x, point.y);
  if (index < 0) return;
  const member = normalizeTroopMembers(props.modelValue)[index];
  if (!member) return;
  emit('update:selectedIndex', index);
  drag = { index, startX: point.x, startY: point.y, originalX: member.x, originalY: member.y };
  canvas.value?.setPointerCapture(event.pointerId);
}

function previewDrag(event: PointerEvent): void {
  if (!drag) return;
  const point = pointerPosition(event);
  const members = normalizeTroopMembers(props.modelValue);
  members[drag.index] = {
    ...members[drag.index],
    x: clamp(drag.originalX + point.x - drag.startX, 0, WIDTH),
    y: clamp(drag.originalY + point.y - drag.startY, 0, HEIGHT),
  };
  void renderFormation(members);
}

function finishDrag(event: PointerEvent): void {
  if (!drag) return;
  const current = drag;
  drag = null;
  const point = pointerPosition(event);
  const members = normalizeTroopMembers(props.modelValue);
  members[current.index] = {
    ...members[current.index],
    x: clamp(current.originalX + point.x - current.startX, 0, WIDTH),
    y: clamp(current.originalY + point.y - current.startY, 0, HEIGHT),
  };
  emit('update:modelValue', members);
}

function cancelDrag(event: PointerEvent): void {
  if (!drag) return;
  drag = null;
  const target = canvas.value;
  if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  void renderFormation();
}

function toggleHidden(event: MouseEvent): void {
  event.preventDefault();
  const point = pointerPosition(event);
  const index = hitTest(point.x, point.y);
  if (index < 0) return;
  const members = normalizeTroopMembers(props.modelValue);
  members[index] = { ...members[index], hidden: !members[index].hidden };
  emit('update:selectedIndex', index);
  emit('update:modelValue', members);
}

function drawSelection(context: CanvasRenderingContext2D, bounds: { left: number; top: number; right: number; bottom: number }): void {
  context.save();
  context.strokeStyle = '#f5b84b';
  context.lineWidth = 3;
  context.setLineDash([8, 5]);
  context.strokeRect(bounds.left - 5, bounds.top - 5, bounds.right - bounds.left + 10, bounds.bottom - bounds.top + 10);
  context.restore();
}

function drawMissingEnemy(context: CanvasRenderingContext2D, member: MvTroopMember, label: string): void {
  context.save();
  context.fillStyle = '#3b2024';
  context.strokeStyle = '#d76c75';
  context.lineWidth = 2;
  context.fillRect(member.x - 32, member.y - 64, 64, 64);
  context.strokeRect(member.x - 32, member.y - 64, 64, 64);
  context.fillStyle = '#ffe8e8';
  context.font = '12px sans-serif';
  context.textAlign = 'center';
  context.fillText(label.slice(0, 10), member.x, member.y - 28);
  context.restore();
}

function drawHiddenMark(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.fillStyle = 'rgba(10, 12, 15, .82)';
  context.fillRect(x - 30, y + 5, 60, 18);
  context.fillStyle = '#d6dbe1';
  context.font = '11px sans-serif';
  context.textAlign = 'center';
  context.fillText(t('db.hidden'), x, y + 18);
  context.restore();
}

function rotateHueLikeMv(context: CanvasRenderingContext2D, width: number, height: number, offset: number): void {
  const imageData = context.getImageData(0, 0, width, height);
  rotateHuePixelsLikeMv(imageData.data, offset);
  context.putImageData(imageData, 0, 0);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
</script>

<template>
  <div class="troop-formation">
    <canvas
      ref="canvas"
      :width="WIDTH"
      :height="HEIGHT"
      :aria-label="t('db.troopFormationCanvas')"
      @pointerdown="startDrag"
      @pointermove="previewDrag"
      @pointerup="finishDrag"
      @pointercancel="cancelDrag"
      @contextmenu="toggleHidden"
    />
    <div v-if="errors.length" class="formation-errors" role="alert">
      <span v-for="message in errors" :key="message">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.troop-formation {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.troop-formation canvas {
  display: block;
  width: 100%;
  aspect-ratio: 816 / 624;
  border: 1px solid var(--console-border, #4a5058);
  border-radius: 3px;
  background: #171b20;
  cursor: crosshair;
  touch-action: none;
}
.formation-errors {
  display: grid;
  gap: 3px;
  color: var(--el-color-danger);
  font-size: 11px;
}
</style>
