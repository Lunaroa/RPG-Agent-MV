<template>
  <teleport to="body">
    <div v-if="visible" class="ulds-panel-overlay" :data-editor-dialog-layer="LAYER_Z.eventEditor" :style="{ zIndex: LAYER_Z.eventEditor }">
      <section
        class="ulds-panel editor-modal-shell"
        role="dialog"
        aria-labelledby="ulds-panel-title"
        :style="panelStyle"
        data-ui-id="ulds-panel"
      >
        <header class="ulds-title-bar" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
          <h3 id="ulds-panel-title" class="editor-modal-title">{{ t('editor.ulds.title') }}<small v-if="mapName"> · {{ mapName }}</small></h3>
          <button type="button" class="editor-modal-close" :aria-label="t('editor.ulds.closeTitle')" :title="t('eventcmd.close')" @click="emit('close')"> × </button>
        </header>
        <div class="ulds-body">
          <div class="ulds-table" role="table" :aria-label="t('editor.ulds.title')">
            <div class="ulds-row ulds-head" role="row">
              <span class="c-name">{{ t('editor.ulds.name') }}</span>
              <span class="c-num">X</span>
              <span class="c-num">Y</span>
              <span class="c-num">Z</span>
              <span class="c-num">{{ t('editor.ulds.scaleX') }}</span>
              <span class="c-num">{{ t('editor.ulds.scaleY') }}</span>
              <span class="c-blend">{{ t('editor.ulds.blend') }}</span>
              <span class="c-num">{{ t('editor.ulds.opacity') }}</span>
              <span class="c-loop">{{ t('editor.ulds.loop') }}</span>
              <span class="c-ops" />
            </div>
            <div v-if="!draft.length" class="ulds-empty">{{ t('editor.ulds.empty') }}</div>
            <div v-for="(row, index) in draft" :key="index" class="ulds-row" role="row" data-ui-id="ulds-layer-row">
              <span class="c-name">
                <input
                  v-model="row.name"
                  data-ui-id="ulds-layer-name"
                  :title="row.name"
                  @change="commitRow"
                />
                <span v-if="row.path" class="ulds-path-suffix" :title="`img/${row.path}`">{{ row.path }}</span>
                <button type="button" class="ulds-mini-btn" :title="t('editor.ulds.pickImage')" @click="openPicker(index)">…</button>
              </span>
              <span class="c-num"><input v-model="row.x" :placeholder="t('editor.ulds.coordPlaceholder')" @change="commitCell(row, 'x')" /></span>
              <span class="c-num"><input v-model="row.y" :placeholder="t('editor.ulds.coordPlaceholder')" @change="commitCell(row, 'y')" /></span>
              <span class="c-num"><input v-model="row.z" placeholder="0.5" @change="commitCell(row, 'z')" /></span>
              <span class="c-num"><input v-model="row['scale.x']" placeholder="1" @change="commitCell(row, 'scale.x')" /></span>
              <span class="c-num"><input v-model="row['scale.y']" placeholder="1" @change="commitCell(row, 'scale.y')" /></span>
              <span class="c-blend">
                <input
                  v-if="isExpression(row.blendMode)"
                  class="ulds-expr"
                  :value="String(row.blendMode)"
                  disabled
                  :title="t('editor.ulds.expressionHint')"
                />
                <select v-else :value="staticUldsNumber(row.blendMode, 0)" @change="setBlendMode(row, $event)">
                  <option :value="0">{{ t('editor.ulds.blend0') }}</option>
                  <option :value="1">{{ t('editor.ulds.blend1') }}</option>
                  <option :value="2">{{ t('editor.ulds.blend2') }}</option>
                  <option :value="3">{{ t('editor.ulds.blend3') }}</option>
                </select>
              </span>
              <span class="c-num"><input v-model="row.opacity" placeholder="255" @change="commitCell(row, 'opacity')" /></span>
              <span class="c-loop">
                <input
                  v-if="isLoopExpression(row.loop)"
                  class="ulds-expr"
                  :value="String(row.loop)"
                  disabled
                  :title="t('editor.ulds.expressionHint')"
                />
                <input v-else type="checkbox" :checked="staticUldsBoolean(row.loop, false)" data-ui-id="ulds-layer-loop" @change="setLoop(row, $event)" />
              </span>
              <span class="c-ops">
                <button type="button" class="ulds-mini-btn" :disabled="index === 0" :title="t('editor.ulds.moveUp')" @click="moveRow(index, -1)">↑</button>
                <button type="button" class="ulds-mini-btn" :disabled="index === draft.length - 1" :title="t('editor.ulds.moveDown')" @click="moveRow(index, 1)">↓</button>
                <button type="button" class="ulds-mini-btn danger" :title="t('editor.ulds.deleteRow')" @click="deleteRow(index)">✕</button>
              </span>
            </div>
          </div>
        </div>
        <footer class="ulds-footer">
          <button type="button" class="editor-btn" data-ui-id="ulds-layer-add" @click="addRow">{{ t('editor.ulds.addLayer') }}</button>
          <span v-if="dirty" class="ulds-dirty" data-ui-id="ulds-dirty-dot" :title="t('editor.ulds.dirtyHint')">{{ t('editor.ulds.unsaved') }}</span>
          <span class="ulds-spacer" />
          <button type="button" class="editor-btn" @click="emit('close')">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" data-ui-id="ulds-save" :disabled="!dirty || saving" @click="emit('save')">{{ t('editor.ulds.save') }}</button>
        </footer>
      </section>
    </div>
    <ImageAssetPickerDialog ref="picker" :catalog="catalog" :load-image="loadImage" @commit="onPickerCommit" />
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import { useI18n } from '../../i18n';
import type { EditorProjectCatalog } from '../../api/client';
import { staticUldsBoolean, staticUldsNumber, type UldsLayerRecord } from '@contract/ulds';

const props = defineProps<{
  visible: boolean;
  mapName: string;
  /** Parsed from the map note; the panel edits a copy and streams it back for live preview. */
  layers: UldsLayerRecord[];
  dirty: boolean;
  saving: boolean;
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  'update:layers': [layers: UldsLayerRecord[]];
}>();

const { t } = useI18n();
const draft = ref<UldsLayerRecord[]>([]);
const picker = ref<InstanceType<typeof ImageAssetPickerDialog>>();
let pickingIndex = -1;
type UldsAssetKind = keyof EditorProjectCatalog['assets'];

/** img/ buckets offered by the picker; parallaxes is the plugin default (no `path` key). */
const ULDS_PATH_BUCKETS = ['parallaxes', 'pictures', 'tilesets', 'battlebacks1', 'battlebacks2', 'characters', 'faces'] as const;

watch(() => [props.visible, props.mapName, props.layers] as const, ([visible], previous) => {
  if (!visible) return;
  const [wasVisible, , previousLayers] = previous || [];
  // Re-seed only on open or when the saved note changes underneath (post-save reload);
  // while the draft is dirty an external note change must not clobber it.
  if (wasVisible && (previousLayers === props.layers || props.dirty)) return;
  draft.value = props.layers.map((layer) => ({ ...layer }));
}, { immediate: true });

// v-model on inputs mutates draft rows directly; numeric-looking cell values are
// normalized on change so the note keeps numbers as numbers.
function commitCell(row: UldsLayerRecord, key: string) {
  const raw = row[key];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') delete row[key];
    else if (/^-?\d+(\.\d+)?$/.test(trimmed)) (row as Record<string, unknown>)[key] = Number(trimmed);
    else (row as Record<string, unknown>)[key] = trimmed;
  } else if (raw == null) {
    delete row[key];
  }
  commitRow();
}
// Numeric-looking strings are constants; anything else (game variables, arithmetic)
// is a runtime expression the panel must not overwrite with a constant control.
function isExpression(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '' && !/^-?\d+(\.\d+)?$/.test(value.trim());
}
function isLoopExpression(value: unknown): boolean {
  return isExpression(value) && value !== 'true' && value !== 'false';
}
function setBlendMode(row: UldsLayerRecord, event: Event) {
  row.blendMode = Number((event.target as HTMLSelectElement).value);
  commitRow();
}
function setLoop(row: UldsLayerRecord, event: Event) {
  row.loop = (event.target as HTMLInputElement).checked;
  commitRow();
}
function commitRow() {
  emit('update:layers', draft.value.map((layer) => ({ ...layer })));
}
function addRow() {
  draft.value.push({ name: '', x: 0, y: 0 });
  commitRow();
}
function deleteRow(index: number) {
  draft.value.splice(index, 1);
  commitRow();
}
function moveRow(index: number, delta: -1 | 1) {
  const target = index + delta;
  if (target < 0 || target >= draft.value.length) return;
  const [row] = draft.value.splice(index, 1);
  draft.value.splice(target, 0, row);
  commitRow();
}
function openPicker(index: number) {
  const row = draft.value[index];
  if (!row) return;
  pickingIndex = index;
  const bucket = (row.path && ULDS_PATH_BUCKETS.includes(row.path as typeof ULDS_PATH_BUCKETS[number]) ? row.path : 'parallaxes') as UldsAssetKind;
  picker.value?.open({ asset: bucket, mode: 'plain', name: row.name || '' });
}
function onPickerCommit(selection: { asset: UldsAssetKind; name: string }) {
  if (pickingIndex < 0 || !selection.name) return;
  const row = draft.value[pickingIndex];
  if (!row) return;
  row.name = selection.name;
  if (selection.asset !== 'parallaxes') row.path = selection.asset;
  else delete row.path;
  commitRow();
}

// Modeless drag: the panel starts docked to the right edge of the window.
const panelPosition = shallowRef<{ x: number; y: number } | null>(null);
let dragOffset: { x: number; y: number } | null = null;
const panelStyle = computed(() => {
  if (!panelPosition.value) return {};
  return { left: `${panelPosition.value.x}px`, top: `${panelPosition.value.y}px`, right: 'auto' };
});
function onDragStart(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return;
  const panel = (event.currentTarget as HTMLElement).parentElement!;
  const rect = panel.getBoundingClientRect();
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (!panelPosition.value) panelPosition.value = { x: rect.left, y: rect.top };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function onDragMove(event: PointerEvent) {
  if (!dragOffset || !panelPosition.value) return;
  panelPosition.value = {
    x: Math.min(Math.max(0, event.clientX - dragOffset.x), window.innerWidth - 120),
    y: Math.min(Math.max(0, event.clientY - dragOffset.y), window.innerHeight - 48),
  };
}
function onDragEnd() { dragOffset = null; }
</script>

<style scoped>
.ulds-panel-overlay { position: fixed; inset: 0; pointer-events: none; z-index: var(--editor-dialog-layer, 2100); }
.ulds-panel {
  pointer-events: auto;
  position: absolute;
  top: 64px;
  right: 16px;
  width: min(860px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  max-height: min(560px, calc(100vh - 96px));
  background: var(--app-bg);
  border: 1px solid var(--app-border-strong);
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .28);
}
.ulds-title-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--app-border);
  cursor: move;
  touch-action: none;
  user-select: none;
}
.ulds-title-bar small { color: var(--app-ink-soft); font-weight: 400; }
.ulds-body { flex: 1 1 auto; overflow: auto; padding: 4px 6px; }
.ulds-table { display: flex; flex-direction: column; font-size: 11px; }
.ulds-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.6fr) 72px 72px 52px 56px 56px 76px 52px 34px 76px;
  gap: 2px;
  align-items: center;
  padding: 1px 0;
}
.ulds-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--app-bg);
  color: var(--app-ink-soft);
  font-weight: 600;
  border-bottom: 1px solid var(--app-border);
  padding-bottom: 3px;
}
.c-name { display: flex; align-items: center; gap: 2px; min-width: 0; }
.c-name input { flex: 1 1 auto; min-width: 0; }
.c-ops { display: flex; gap: 2px; justify-content: flex-end; }
.c-num input, .c-name input { width: 100%; box-sizing: border-box; }
.c-blend select, .c-blend input, .c-loop input.ulds-expr { width: 100%; box-sizing: border-box; }
.ulds-path-suffix { flex: 0 0 auto; color: var(--app-ink-soft); font-size: 10px; }
.c-loop { text-align: center; }
.ulds-row input, .ulds-row select {
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--app-border);
  border-radius: 2px;
  background: var(--app-bg-sunken, #fff);
  color: var(--app-ink);
  font: inherit;
  font-size: 11px;
}
.ulds-row input[type='checkbox'] { height: auto; }
.ulds-row input.ulds-expr { color: var(--app-ink-soft); font-style: italic; cursor: not-allowed; }
.ulds-empty { padding: 18px 0; text-align: center; color: var(--app-ink-soft); }
.ulds-mini-btn {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid var(--app-border);
  border-radius: 2px;
  background: transparent;
  color: var(--app-ink-soft);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.ulds-mini-btn:hover:not(:disabled) { background: var(--app-bg-sunken); color: var(--app-ink); }
.ulds-mini-btn:disabled { opacity: .35; cursor: default; }
.ulds-mini-btn.danger:hover { border-color: #dc2626; color: #dc2626; }
.ulds-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--app-border);
}
.ulds-spacer { flex: 1 1 auto; }
.ulds-dirty { color: #d97706; font-size: 11px; }
</style>
