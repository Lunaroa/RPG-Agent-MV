<template>
  <aside ref="workbenchRef" class="editor-workbench" :class="{ resizing }">
    <section v-show="mode === 'map'" class="workbench-pane palette-pane" :class="{ collapsed: !tilesOpen }" :style="palettePaneStyle">
      <header class="pane-header clickable" @click="toggleTiles">
        <strong>{{ t('editor.left.tiles') }}</strong>
        <span v-if="brushInfo" class="tile-chip">{{ brushInfo }}</span>
        <span class="pane-chevron">{{ tilesOpen ? '▾' : '▸' }}</span>
      </header>
      <div v-show="tilesOpen" class="palette-scroll">
        <canvas ref="paletteRef" class="palette-canvas" @mousedown="$emit('palette-mousedown', $event)" @mousemove="$emit('palette-mousemove', $event)" @mouseup="$emit('palette-mouseup')" @mouseleave="$emit('palette-mouseup')" />
        <div v-if="!tilesetReady" class="pane-empty">{{ t('editor.left.tilesetMissing') }}</div>
      </div>
      <nav v-show="tilesOpen" class="tile-tabs" :aria-label="t('editor.left.tileTabs')">
        <button v-for="entry in tileTabs" :key="entry.tab" :class="{ active: entry.tab === tileTab }" :disabled="!entry.available || mode === 'event' || paintMode !== 'tile'" @click="$emit('select-tile-tab', entry.tab)">{{ entry.label }}</button>
      </nav>
    </section>
    <div
      v-show="mode === 'map' && tilesOpen"
      class="pane-resizer"
      role="separator"
      aria-orientation="horizontal"
      :title="t('editor.left.resizeTiles')"
      @dblclick="resetPaletteHeight"
      @mousedown.prevent="startResize"
    />

    <section v-if="mode === 'event'" class="workbench-pane event-list-pane">
      <header class="pane-header">
        <strong>{{ t('editor.left.events') }}</strong>
        <span class="pane-count">{{ currentEvents.length }}</span>
      </header>
      <label class="event-search">
        <span aria-hidden="true">⌕</span>
        <input
          :value="eventSearchQuery"
          type="search"
          :placeholder="t('editor.left.searchEvents')"
          @input="$emit('update:event-search-query', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="event-list">
        <template v-if="eventSearchQuery.trim()">
          <button
            v-for="hit in eventSearchHits"
            :key="`${hit.mapId}:${hit.eventId}:${hit.pageIndex}:${hit.commandIndex}:${hit.matchKind}`"
            type="button"
            class="event-row search-hit"
            @dblclick="$emit('open-search-hit', hit)"
          >
            <span class="event-row-main"><strong>#{{ hit.eventId }} {{ hit.eventName }}</strong><small>{{ hit.mapName }} · {{ searchHitLocation(hit) }}</small></span>
            <span class="event-row-text">{{ hit.text }}</span>
          </button>
          <div v-if="eventSearchLoading" class="pane-empty">{{ t('editor.left.searchingEvents') }}</div>
          <div v-else-if="!eventSearchHits.length" class="pane-empty">{{ t('editor.left.noEventMatches') }}</div>
          <div v-if="eventSearchTruncated" class="pane-empty compact">{{ t('editor.left.searchTruncated') }}</div>
        </template>
        <template v-else>
          <button
            v-for="event in currentEvents"
            :key="event.id"
            type="button"
            class="event-row"
            :class="{ active: event.id === selectedEventId }"
            @click="$emit('select-event', event.id)"
            @dblclick="$emit('open-event', event.id)"
          >
            <span class="event-row-main"><strong>#{{ event.id }} {{ event.name }}</strong><small>{{ event.x }}, {{ event.y }}</small></span>
          </button>
          <div v-if="!currentEvents.length" class="pane-empty">{{ t('editor.left.noEvents') }}</div>
        </template>
      </div>
    </section>

    <section class="workbench-pane tree-pane">
      <header class="pane-header">
        <strong>{{ t('editor.left.mapTree') }}</strong>
      </header>
      <div class="map-tree">
        <el-tree
          :data="mapTree"
          :props="{ children: 'children', label: 'name' }"
          node-key="id"
          draggable
          highlight-current
          :default-expanded-keys="expandedMapIds"
          :current-node-key="selectedMapId ?? undefined"
          @node-click="$emit('node-click', $event)"
          @node-expand="(data: TreeNode) => $emit('node-expand', data)"
          @node-collapse="(data: TreeNode) => $emit('node-collapse', data)"
          @node-contextmenu="(event: MouseEvent, data: TreeNode) => $emit('node-contextmenu', event, data)"
          :allow-drop="allowTreeDrop"
          @node-drop="onTreeNodeDrop"
        >
          <template #default="{ node, data }">
            <span class="tree-node">
              <span class="node-label">{{ node.label }}</span>
              <span v-if="stagedMapIds.has(data.id)" class="node-staged" :title="t('editor.left.stagedTitle')">{{ t('editor.left.staged') }}</span>
            </span>
          </template>
        </el-tree>
        <div v-if="!mapTree.length" class="pane-empty">{{ t('editor.left.noMaps') }}</div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EditorEventListItem, EditorEventSearchHit, EditorMode, MapPaintMode, PaletteTab, TileTab, TreeNode } from '../editor/editorTypes';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { useWorkspaceStore } from '../../stores/workspace';
import { useI18n } from '../../i18n';
import {
  clampPaletteHeight,
  computeMaxPaletteHeight,
  PALETTE_MIN_OPEN_HEIGHT,
  PALETTE_MIN_TREE_HEIGHT,
  PALETTE_RESET_HEIGHT,
} from '../../utils/workspaceSettings';

defineProps<{
  mode: EditorMode;
  paintMode: MapPaintMode;
  tileTabs: PaletteTab[];
  tileTab: TileTab;
  tilesetReady: boolean;
  brushInfo: string;
  brushSet: boolean;
  mapTree: TreeNode[];
  selectedMapId: number | null;
  stagedMapIds: Set<number>;
  expandedMapIds: number[];
  currentEvents: EditorEventListItem[];
  selectedEventId: number | null;
  eventSearchQuery: string;
  eventSearchHits: EditorEventSearchHit[];
  eventSearchLoading: boolean;
  eventSearchTruncated: boolean;
}>();

const workbenchUi = useWorkbenchUiStore();
const workspaceStore = useWorkspaceStore();
const { t } = useI18n();
const emit = defineEmits<{
  'palette-ready': [canvas: HTMLCanvasElement];
  'palette-mousedown': [event: MouseEvent];
  'palette-mousemove': [event: MouseEvent];
  'palette-mouseup': [];
  'select-tile-tab': [tab: TileTab];
  'node-click': [node: TreeNode];
  'node-expand': [node: TreeNode];
  'node-collapse': [node: TreeNode];
  'node-contextmenu': [event: MouseEvent, node: TreeNode];
  'node-drop': [source: TreeNode, target: TreeNode, position: 'before' | 'after' | 'inside'];
  'update:event-search-query': [query: string];
  'select-event': [eventId: number];
  'open-event': [eventId: number];
  'open-search-hit': [hit: EditorEventSearchHit];
}>();

const workbenchRef = ref<HTMLElement>();
const paletteRef = ref<HTMLCanvasElement>();
const resizing = ref(false);
let resizeStart: { y: number; height: number } | null = null;

const tilesOpen = computed(() => workbenchUi.leftDockTilesOpen);
const palettePaneStyle = computed(() => (
  tilesOpen.value ? { flex: `0 0 ${workbenchUi.leftDockPaletteHeight}px` } : undefined
));

function toggleTiles() {
  workbenchUi.setLeftDockTilesOpen(!workbenchUi.leftDockTilesOpen);
}

function nodeContains(root: TreeNode, mapId: number): boolean {
  return root.id === mapId || Boolean(root.children?.some((child) => nodeContains(child, mapId)));
}

function allowTreeDrop(
  draggingNode: { data: TreeNode },
  dropNode: { data: TreeNode },
): boolean {
  return draggingNode.data.id !== dropNode.data.id && !nodeContains(draggingNode.data, dropNode.data.id);
}

function onTreeNodeDrop(
  draggingNode: { data: TreeNode },
  dropNode: { data: TreeNode },
  dropType: 'before' | 'after' | 'inner',
): void {
  emit('node-drop', draggingNode.data, dropNode.data, dropType === 'inner' ? 'inside' : dropType);
}

function searchHitLocation(hit: EditorEventSearchHit): string {
  if (hit.pageIndex == null) {
    if (hit.matchKind === 'id') return t('editor.left.match.id');
    if (hit.matchKind === 'name') return t('editor.left.match.name');
    return t('editor.left.match.note');
  }
  return t('editor.left.commandLocation', { page: hit.pageIndex + 1, command: (hit.commandIndex ?? 0) + 1 });
}

function startResize(event: MouseEvent) {
  if (!tilesOpen.value) return;
  resizing.value = true;
  resizeStart = { y: event.clientY, height: workbenchUi.leftDockPaletteHeight };
  document.addEventListener('mousemove', resizePalette);
  document.addEventListener('mouseup', stopResize);
}

function resizePalette(event: MouseEvent) {
  if (!resizeStart) return;
  workbenchUi.setLeftDockPaletteHeight(clampPaletteHeightLocal(resizeStart.height + event.clientY - resizeStart.y));
}

function stopResize() {
  if (!resizeStart) return;
  resizeStart = null;
  resizing.value = false;
  document.removeEventListener('mousemove', resizePalette);
  document.removeEventListener('mouseup', stopResize);
}

function maxPaletteHeightForWorkbench(): number {
  const available = workbenchRef.value?.clientHeight || 0;
  return computeMaxPaletteHeight(available);
}

function clampPaletteHeightLocal(height: number): number {
  const available = workbenchRef.value?.clientHeight || 0;
  const max = available > 0
    ? Math.max(PALETTE_MIN_OPEN_HEIGHT, available - PALETTE_MIN_TREE_HEIGHT - 8)
    : 520;
  return clampPaletteHeight(Math.max(PALETTE_MIN_OPEN_HEIGHT, Math.min(max, height)));
}

function resetPaletteHeight() {
  workbenchUi.setLeftDockPaletteHeight(clampPaletteHeightLocal(PALETTE_RESET_HEIGHT));
}

function applyInitialPaletteHeightIfNeeded(): void {
  if (workspaceStore.paletteHeightPersisted) return;
  const maxHeight = clampPaletteHeightLocal(maxPaletteHeightForWorkbench());
  workspaceStore.markPaletteHeightPersisted(maxHeight);
}

onUnmounted(() => {
  stopResize();
});

onMounted(() => {
  if (paletteRef.value) emit('palette-ready', paletteRef.value);
  void nextTick(() => {
    applyInitialPaletteHeightIfNeeded();
  });
});
</script>

<style scoped>
.editor-workbench {
  width: 214px;
  min-width: 214px;
  padding: 0 6px 8px 0;
  background: var(--app-bg-page);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.workbench-pane { min-height: 0; display: flex; flex-direction: column; overflow: hidden; border:1px solid var(--app-border); border-radius:6px; background:var(--app-bg); box-shadow:none; }
.palette-pane { flex:0 0 214px; }
.palette-pane.collapsed { flex:0 0 30px; }
.tree-pane { flex:1 1 auto; }
.event-list-pane { flex:0 0 min(42%, 300px); margin-bottom:8px; }
.pane-resizer {
  height: 8px;
  flex: 0 0 8px;
  position: relative;
  cursor: row-resize;
}
.pane-resizer::before {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  top: 3px;
  height: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background-color var(--app-dur) var(--app-ease);
}
.pane-resizer:hover::before,
.editor-workbench.resizing .pane-resizer::before {
  background: var(--app-border-strong);
}
.editor-workbench.resizing {
  user-select: none;
}
.tree-pane {
  --app-border: #cac4b6;
  --app-border-strong: #b3ab9c;
  --app-bg-soft: #e6e2d9;
  --app-bg-sunken: #d9d3c7;
  --app-ink-soft: #5c5649;
  --app-ink-muted: #7d776b;
}
.pane-header {
  min-height: 30px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  border-bottom: 1px solid var(--app-border);
  color: var(--app-ink);
  font-size: 13px;
  font-weight: 700;
}
.pane-header.clickable{cursor:pointer}.pane-chevron{color:var(--app-ink-muted);font-size:12px}.tile-chip{margin-left:auto;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 6px;border-radius:4px;background:var(--app-bg-soft);color:var(--app-ink-soft);font-size:10px;font-weight:600}
.pane-count{min-width:20px;padding:1px 5px;border-radius:4px;background:var(--app-bg-soft);color:var(--app-ink-soft);font-size:10px;text-align:center}.event-search{height:30px;margin:5px;display:flex;align-items:center;gap:5px;padding:0 7px;border:1px solid var(--app-border);border-radius:5px;background:var(--app-bg-sunken);color:var(--app-ink-muted)}.event-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--app-ink);font:inherit;font-size:11px}.event-list{min-height:0;flex:1;overflow:auto;padding:0 4px 5px}.event-row{width:100%;min-height:34px;padding:5px 6px;display:flex;flex-direction:column;align-items:stretch;gap:2px;border:0;border-radius:4px;background:transparent;color:var(--app-ink);text-align:left;cursor:pointer}.event-row:hover,.event-row.active{background:var(--app-bg-sunken)}.event-row.active{box-shadow:inset 3px 0 0 var(--app-accent)}.event-row-main{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}.event-row-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.event-row-main small,.event-row-text{color:var(--app-ink-muted);font-size:9px}.event-row-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.search-hit{border-bottom:1px solid var(--app-border)}.pane-empty.compact{padding-top:4px;padding-bottom:4px}
.tile-tabs { display: flex; gap: 1px; padding: 3px; border-top:1px solid var(--app-border); background: var(--app-bg); }
.tile-tabs button {
  min-width: 0;
  flex: 1;
  padding: 3px 0;
  border: 0;
  border-radius: 4px;
  background: var(--app-bg);
  color: var(--app-ink-muted);
  cursor: pointer;
  font-size: 11px;
}
.tile-tabs button.active { background: var(--app-bg-soft); color: var(--app-ink); font-weight:700; }
.tile-tabs button:disabled { cursor: not-allowed; opacity: .48; }
.palette-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; margin:0; background: var(--app-bg-sunken); }
.palette-canvas { display: block; width:100%; height:auto; cursor: crosshair; image-rendering: pixelated; }
.map-tree { flex: 1; overflow: auto; padding: 2px 3px 6px; background: repeating-linear-gradient(to bottom, transparent 0, transparent 22px, var(--app-bg-soft) 22px, var(--app-bg-soft) 44px); background-attachment: local; background-origin: content-box; }
.tree-node { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 5px; overflow: hidden; }
.node-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color:var(--app-ink); font-size: 12px; line-height:1; }
.node-staged { flex:0 0 auto; padding: 1px 4px; border-radius: 4px; background: var(--app-warn-soft); color: var(--app-warn); font-size: 9px; font-weight:600; }
.pane-empty { padding: 10px; color: var(--app-ink-muted); font-size: 12px; }
.map-tree :deep(.el-tree) { background: transparent; color: var(--app-ink); --el-tree-node-hover-bg-color: var(--app-bg-soft); }
/* 缩进改由嵌套 children 的 margin 累积承担（覆盖 el-tree 内联 padding-left），
   使每一层 children 都能画出一条引导竖线，深层嵌套可顺线回溯父级。 */
.map-tree :deep(.el-tree-node__content) { height:22px; min-height:22px; padding-left:8px !important; padding-right:3px; border-radius:4px; color:var(--app-ink); }
.map-tree :deep(.el-tree-node__children) { margin-left:10px; border-left:1px solid var(--app-border-strong); }
.map-tree :deep(.el-tree-node__content:hover) { background:var(--app-bg-sunken); }
.map-tree :deep(.el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content) { background:var(--app-accent-soft); color:var(--app-accent); font-weight:700; box-shadow: inset 3px 0 0 var(--app-accent); }
.map-tree :deep(.el-tree-node__expand-icon) { color:var(--app-ink-soft); font-size:11px; }
.map-tree :deep(.el-tree-node__expand-icon.is-leaf) { color:transparent; }
</style>
