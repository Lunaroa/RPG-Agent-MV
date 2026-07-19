<template>
  <header class="editor-toolbar" data-ui-id="editor-toolbar">
    <div class="mode-group">
      <button type="button" data-ui-id="editor-mode-map" :class="{ active: mode === 'map' }" :aria-pressed="mode === 'map'" @click="$emit('update:mode', 'map')"><Grid />{{ t('editor.toolbar.mapMode') }}</button>
      <button type="button" data-ui-id="editor-mode-event" :class="{ active: mode === 'event' }" :aria-pressed="mode === 'event'" @click="$emit('update:mode', 'event')"><Location />{{ t('editor.toolbar.eventMode') }}</button>
    </div>
    <template v-if="mode === 'map'">
      <span class="toolbar-separator" />
      <button v-for="entry in tools" :key="entry.id" type="button" class="tool-button" :data-ui-id="`editor-tool-${entry.id}`" :class="{ active: paintMode !== 'shadow' && tool === entry.id }" :disabled="busy" :title="entry.label" @click="$emit('select-tool', entry.id)">
        <component :is="entry.icon" />
      </button>
      <button type="button" class="tool-button" data-ui-id="editor-tool-shadow" :class="{ active: paintMode === 'shadow' }" :disabled="busy" :title="t('editor.toolbar.shadowLayer')" @click="$emit('select-shadow')"><Sunny /></button>
      <span class="toolbar-separator" />
      <div v-if="supportsLayerSelection && paintMode === 'tile'" class="layer-mode-group" :aria-label="t('editor.toolbar.layerSelection')">
        <button
          v-for="entry in layerEntries"
          :key="entry.value"
          type="button"
          :data-ui-id="`editor-layer-${entry.value}`"
          :class="{ active: layer === entry.value }"
          :disabled="busy"
          :title="entry.title"
          @click="$emit('update:layer', entry.value)"
        >{{ entry.label }}</button>
      </div>
      <div v-if="paintMode === 'shadow'" class="shadow-picker" :title="t('editor.toolbar.shadowQuadrants')">
        <button
          v-for="bit in shadowBitsList"
          :key="bit"
          type="button"
          :class="{ active: (shadowBits & bit) !== 0 }"
          :disabled="busy"
          :aria-label="`shadow ${bit}`"
          @click="$emit('update:shadowBits', toggleShadowBit(shadowBits, bit))"
        />
      </div>
      <div v-if="paintMode === 'tile'" class="overlay-group" :aria-label="t('editor.toolbar.overlays')">
        <button type="button" data-ui-id="editor-overlay-tile-flags" :class="{ active: showTileFlags }" :disabled="busy || !tileFlagsAvailable" :title="tileFlagsAvailable ? t('editor.toolbar.showFlags') : t('editor.toolbar.flagsMissing')" @click="$emit('update:showTileFlags', !showTileFlags)"><Grid />{{ t('editor.toolbar.flags') }}</button>
      </div>
      <span class="toolbar-separator" />
      <button type="button" class="tool-button" data-ui-id="editor-undo" :disabled="busy || !undoLen" :title="t('editor.toolbar.undo')" @click="$emit('undo')"><RefreshLeft /></button>
      <button type="button" class="tool-button" data-ui-id="editor-redo" :disabled="busy || !redoLen" :title="t('editor.toolbar.redo')" @click="$emit('redo')"><RefreshRight /></button>
    </template>
    <div v-if="stagingDirty" class="staging-actions">
      <button type="button" class="workbench-button primary" data-ui-id="editor-staging-apply" :disabled="busy" @click="$emit('apply')">{{ t('editor.toolbar.applyStaging') }}</button>
      <button type="button" class="workbench-button" data-ui-id="editor-staging-discard" :disabled="busy" @click="$emit('discard')">{{ t('editor.toolbar.discard') }}</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Crop, Delete, EditPen, Grid, Location, MagicStick, RefreshLeft, RefreshRight, Sunny } from '@element-plus/icons-vue';
import type { EditorMode, MapLayerSelection, MapPaintMode, MapTool } from './editorTypes';
import EllipseToolIcon from './EllipseToolIcon.vue';
import { useI18n } from '../../i18n';
defineProps<{mode:EditorMode;tool:MapTool;paintMode:MapPaintMode;layer:MapLayerSelection;supportsLayerSelection:boolean;shadowBits:number;showTileFlags:boolean;tileFlagsAvailable:boolean;zoom:number;undoLen:number;redoLen:number;busy:boolean;stagingDirty:boolean}>();
defineEmits<{'update:mode':[EditorMode];'update:layer':[MapLayerSelection];'update:shadowBits':[number];'update:showTileFlags':[boolean];'select-tool':[MapTool];'select-shadow':[];undo:[];redo:[];'zoom-in':[];'zoom-out':[];'reset-zoom':[];apply:[];discard:[]}>();
const { t } = useI18n();
const tools = computed<{ id: MapTool; label: string; icon: typeof EditPen }[]>(() => [
  { id: 'pencil', label: t('editor.toolbar.tool.pencil'), icon: EditPen },
  { id: 'rect', label: t('editor.toolbar.tool.rect'), icon: Crop },
  { id: 'ellipse', label: t('editor.toolbar.tool.ellipse'), icon: EllipseToolIcon },
  { id: 'fill', label: t('editor.toolbar.tool.fill'), icon: MagicStick },
  { id: 'eraser', label: t('editor.toolbar.tool.eraser'), icon: Delete },
]);
const shadowBitsList = [1, 2, 4, 8] as const;
const layerEntries = computed<Array<{ value: MapLayerSelection; label: string; title: string }>>(() => [
  { value: 'auto', label: t('editor.toolbar.layerAutoShort'), title: t('editor.toolbar.layerAuto') },
  ...([0, 1, 2, 3] as const).map((value) => ({ value, label: String(value + 1), title: t('editor.toolbar.layerNumber', { number: value + 1 }) })),
]);
function toggleShadowBit(current:number,bit:number){return Math.max(0,Math.min(15,Math.floor(current)^bit));}
</script>

<style scoped>
.editor-toolbar{height:42px;flex:0 0 42px;padding:0 8px;border-bottom:1px solid var(--app-border);background:var(--app-bg);display:flex;align-items:center;gap:3px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.editor-toolbar>*{flex-shrink:0}.editor-toolbar::-webkit-scrollbar{height:3px}.editor-toolbar::-webkit-scrollbar-thumb{background:var(--app-border);border-radius:999px}.toolbar-separator{width:1px;height:20px;margin:0 4px;background:var(--app-border)}.tool-button{width:28px;height:28px;display:grid;place-items:center;border:1px solid transparent;border-radius:2px;background:transparent;color:var(--app-ink-soft);cursor:pointer}.tool-button:hover:not(:disabled),.tool-button.active{border-color:var(--app-border-strong);background:var(--app-bg-sunken);color:var(--app-ink);box-shadow:inset 0 1px 0 rgba(255,255,255,.45)}.tool-button:disabled{opacity:.38;cursor:not-allowed}.tool-button :deep(svg){width:15px;height:15px}.mode-group,.overlay-group,.layer-mode-group{display:flex;gap:1px;padding:0;background:transparent}.mode-group button,.overlay-group button,.layer-mode-group button{height:28px;padding:0 8px;display:flex;align-items:center;gap:5px;border:1px solid transparent;border-radius:2px;background:transparent;color:var(--app-ink-soft);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.mode-group button :deep(svg){width:15px;height:15px}.layer-mode-group button{min-width:26px;padding:0 6px}.mode-group button:hover,.overlay-group button:hover,.layer-mode-group button:hover,.overlay-group button.active,.layer-mode-group button.active{border-color:var(--app-border-strong);background:var(--app-bg-sunken);color:var(--app-ink);box-shadow:inset 0 1px 0 rgba(255,255,255,.45)}.mode-group button.active{border-color:var(--app-accent);background:var(--app-accent);color:#fff;box-shadow:none}.mode-group button.active:hover{border-color:var(--app-accent-hover);background:var(--app-accent-hover);color:#fff}.mode-group button:focus-visible,.overlay-group button:focus-visible,.layer-mode-group button:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}.mode-group button:disabled,.overlay-group button:disabled,.layer-mode-group button:disabled{cursor:not-allowed;opacity:.42}.overlay-group button :deep(svg){width:14px;height:14px}.shadow-picker{width:28px;height:28px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;padding:2px;border:1px solid var(--app-border);border-radius:2px;background:var(--app-bg-sunken)}.shadow-picker button{min-width:0;border:0;border-radius:1px;background:transparent;cursor:pointer}.shadow-picker button.active{background:rgba(0,0,0,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}.shadow-picker button:disabled{cursor:not-allowed;opacity:.45}
.staging-actions{margin-left:auto;display:flex;align-items:center;gap:4px;padding-left:8px}
</style>
