<template>
  <header class="editor-toolbar" data-ui-id="editor-toolbar">
    <button v-for="entry in tools" :key="entry.id" type="button" class="tool-button" :data-ui-id="`editor-tool-${entry.id}`" :class="{ active: tool === entry.id }" :disabled="mode !== 'map' || busy" :title="entry.label" @click="$emit('update:tool', entry.id)">
      <component :is="entry.icon" />
    </button>
    <span class="toolbar-separator" />
    <div class="paint-mode-group" aria-label="地图绘制层">
      <button type="button" data-ui-id="editor-paint-tile" :class="{ active: paintMode === 'tile' }" :disabled="mode !== 'map' || busy" title="图块层" @click="$emit('update:paintMode', 'tile')"><Brush />图块</button>
      <button type="button" data-ui-id="editor-paint-shadow" :class="{ active: paintMode === 'shadow' }" :disabled="mode !== 'map' || busy" title="阴影层" @click="$emit('update:paintMode', 'shadow')"><Sunny />阴影</button>
      <button type="button" data-ui-id="editor-paint-region" :class="{ active: paintMode === 'region' }" :disabled="mode !== 'map' || busy" title="区域 ID 层" @click="$emit('update:paintMode', 'region')"><Grid />区域</button>
    </div>
    <div v-if="paintMode === 'shadow'" class="shadow-picker" title="阴影四象限">
      <button
        v-for="bit in shadowBitsList"
        :key="bit"
        type="button"
        :class="{ active: (shadowBits & bit) !== 0 }"
        :disabled="mode !== 'map' || busy"
        :aria-label="`shadow ${bit}`"
        @click="$emit('update:shadowBits', toggleShadowBit(shadowBits, bit))"
      />
    </div>
    <input
      v-if="paintMode === 'region'"
      class="paint-value"
      data-ui-id="editor-region-id"
      type="number"
      min="0"
      max="255"
      :value="regionId"
      :disabled="mode !== 'map' || busy"
      title="Region ID，0-255"
      @input="$emit('update:regionId', normalizeNumber(($event.target as HTMLInputElement).value, 0, 255))"
    />
    <div class="overlay-group" aria-label="地图叠层">
      <button type="button" data-ui-id="editor-overlay-regions" :class="{ active: showRegions }" :disabled="mode !== 'map' || busy" title="显示区域 ID 叠层" @click="$emit('update:showRegions', !showRegions)"><Grid />区域</button>
      <button type="button" data-ui-id="editor-overlay-tile-flags" :class="{ active: showTileFlags }" :disabled="mode !== 'map' || busy || !tileFlagsAvailable" :title="tileFlagsAvailable ? '显示通行与地形标记' : '当前 tileset 没有 flags 数据'" @click="$emit('update:showTileFlags', !showTileFlags)"><Grid />标记</button>
    </div>
    <span class="toolbar-separator" />
    <button type="button" class="tool-button" data-ui-id="editor-undo" :disabled="mode !== 'map' || busy || !undoLen" title="撤销" @click="$emit('undo')"><RefreshLeft /></button>
    <button type="button" class="tool-button" data-ui-id="editor-redo" :disabled="mode !== 'map' || busy || !redoLen" title="重做" @click="$emit('redo')"><RefreshRight /></button>
    <span class="toolbar-separator" />
    <div class="mode-group">
      <button type="button" data-ui-id="editor-mode-map" :class="{ active: mode === 'map' }" @click="$emit('update:mode', 'map')"><span class="mode-dot map" />地图</button>
      <button type="button" data-ui-id="editor-mode-event" :class="{ active: mode === 'event' }" @click="$emit('update:mode', 'event')"><span class="mode-dot event" />事件</button>
    </div>
    <template v-if="stagingDirty">
      <span class="toolbar-separator" />
      <button type="button" class="workbench-button primary" data-ui-id="editor-staging-apply" :disabled="busy" @click="$emit('apply')">应用暂存</button>
      <button type="button" class="workbench-button" data-ui-id="editor-staging-discard" :disabled="busy" @click="$emit('discard')">丢弃</button>
    </template>
  </header>
</template>

<script setup lang="ts">
import { Brush, Crop, Delete, Grid, MagicStick, RefreshLeft, RefreshRight, Sunny } from '@element-plus/icons-vue';
import type { EditorMode, MapPaintMode, MapTool } from './editorTypes';
defineProps<{mode:EditorMode;tool:MapTool;paintMode:MapPaintMode;regionId:number;shadowBits:number;showRegions:boolean;showTileFlags:boolean;tileFlagsAvailable:boolean;zoom:number;undoLen:number;redoLen:number;busy:boolean;stagingDirty:boolean}>();
defineEmits<{'update:mode':[EditorMode];'update:tool':[MapTool];'update:paintMode':[MapPaintMode];'update:regionId':[number];'update:shadowBits':[number];'update:showRegions':[boolean];'update:showTileFlags':[boolean];undo:[];redo:[];'zoom-in':[];'zoom-out':[];'reset-zoom':[];apply:[];discard:[]}>();
const tools:{id:MapTool;label:string;icon:typeof Brush}[]=[
  {id:'pencil',label:'画笔',icon:Brush},{id:'rect',label:'矩形',icon:Crop},{id:'ellipse',label:'椭圆',icon:Crop},
  {id:'fill',label:'填充',icon:MagicStick},{id:'eraser',label:'橡皮',icon:Delete},
];
const shadowBitsList = [1, 2, 4, 8] as const;
function toggleShadowBit(current:number,bit:number){return Math.max(0,Math.min(15,Math.floor(current)^bit));}
function normalizeNumber(value:string,min:number,max:number){const number=Number(value);if(!Number.isFinite(number))return min;return Math.max(min,Math.min(max,Math.floor(number)));}
</script>

<style scoped>
.editor-toolbar{height:46px;flex:0 0 46px;padding:0 10px;background:var(--app-bg);display:flex;align-items:center;gap:4px}.toolbar-separator{width:1px;height:16px;margin:0 3px;background:var(--app-border)}.tool-button{width:28px;height:28px;display:grid;place-items:center;border:1px solid transparent;border-radius:var(--app-radius-sm);background:transparent;color:var(--app-ink-soft);cursor:pointer}.tool-button:hover:not(:disabled),.tool-button.active{background:var(--app-bg-soft);color:var(--app-ink);box-shadow:var(--app-shadow-1)}.tool-button:disabled{opacity:.38;cursor:not-allowed}.tool-button :deep(svg){width:14px;height:14px}.mode-group,.paint-mode-group,.overlay-group{display:flex;gap:2px;padding:2px;border-radius:var(--app-radius-md);background:var(--app-bg-sunken)}.mode-group button,.paint-mode-group button,.overlay-group button{height:24px;padding:0 10px;display:flex;align-items:center;gap:5px;border:0;border-radius:var(--app-radius-sm);background:transparent;color:var(--app-ink-soft);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.mode-group button.active,.paint-mode-group button.active,.overlay-group button.active{background:var(--app-bg);color:var(--app-ink);box-shadow:var(--app-shadow-1)}.mode-group button:disabled,.paint-mode-group button:disabled,.overlay-group button:disabled{cursor:not-allowed;opacity:.42}.paint-mode-group button :deep(svg),.overlay-group button :deep(svg){width:13px;height:13px}.paint-value{width:52px;height:24px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);color:var(--app-ink);font:600 11px var(--app-font-mono);padding:0 4px}.paint-value:disabled{opacity:.5}.shadow-picker{width:28px;height:28px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;padding:2px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-sunken)}.shadow-picker button{min-width:0;border:0;border-radius:2px;background:transparent;cursor:pointer}.shadow-picker button.active{background:rgba(0,0,0,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}.shadow-picker button:disabled{cursor:not-allowed;opacity:.45}.mode-dot{width:7px;height:7px;border-radius:2px}.mode-dot.map{background:var(--app-ok)}.mode-dot.event{background:var(--app-accent)}
</style>
