<template>
  <aside ref="workbenchRef" class="editor-workbench" :class="{ resizing, 'width-resizing': widthResizing, 'preview-mode': mode === 'preview' }" :style="workbenchStyle">
    <section v-show="mode === 'map'" class="workbench-pane palette-pane" :class="{ collapsed: !tilesOpen }" :style="palettePaneStyle">
      <header class="pane-header clickable" @click="toggleTiles">
        <strong>{{ t('editor.left.tiles') }}</strong>
        <span v-if="brushInfo" class="tile-chip">{{ brushInfo }}</span>
        <span class="pane-chevron">{{ tilesOpen ? '▾' : '▸' }}</span>
      </header>
      <div v-show="tilesOpen" class="palette-scroll">
        <canvas ref="paletteRef" class="palette-canvas" @mousedown="$emit('palette-mousedown', $event)" @mousemove="$emit('palette-mousemove', $event)" @mouseup="$emit('palette-mouseup', $event)" @mouseleave="$emit('palette-mouseleave')" @contextmenu.prevent />
        <div v-if="!tilesetReady && tileTab !== 'R'" class="pane-empty">{{ t('editor.left.tilesetMissing') }}</div>
      </div>
      <nav v-show="tilesOpen" class="tile-tabs" :aria-label="t('editor.left.tileTabs')">
        <button v-for="entry in tileTabs" :key="entry.tab" :class="{ active: entry.tab === tileTab, unavailable: !entry.available }" :disabled="mode === 'event'" @click="$emit('select-tile-tab', entry.tab)">{{ entry.label }}</button>
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

    <section v-if="mode === 'event' || mode === 'preview'" class="workbench-pane event-list-pane" :style="palettePaneStyle">
      <header class="pane-header">
        <strong>{{ t('editor.left.events') }}</strong>
        <span class="pane-count">{{ currentEvents.length }}</span>
      </header>
      <label v-if="mode === 'event'" class="event-search">
        <span aria-hidden="true">⌕</span>
        <input
          :value="eventSearchQuery"
          type="search"
          :placeholder="t('editor.left.searchEvents')"
          @input="$emit('update:event-search-query', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div v-if="mode === 'event' && eventSearchQuery.trim()" class="event-search-scope">
        <span>{{ eventSearchAllMaps ? t('editor.left.searchScopeAll') : t('editor.left.searchScopeCurrent') }}</span>
        <button v-if="!eventSearchAllMaps" type="button" @click="$emit('search-all-maps')">{{ t('editor.left.searchAllMaps') }}</button>
      </div>
      <div class="event-list" @click="clearPreviewSelectionFromBlank" @mouseleave="$emit('hover-event', null)">
        <template v-if="mode === 'event' && eventSearchQuery.trim()">
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
            :ref="(element) => setEventRowRef(event.id, element)"
            type="button"
            class="event-row"
            :class="{ active: event.id === selectedEventId, muted: mode === 'preview' && !previewEventState(event.id)?.visible }"
            @click="$emit('select-event', event.id)"
            @dblclick="mode === 'event' && $emit('open-event', event.id)"
            @mouseenter="mode === 'event' && $emit('hover-event', event.id)"
            @mouseleave="$emit('hover-event', null)"
          >
            <span class="event-row-main"><strong>{{ formatEventId(event.id) }} {{ event.name }}</strong><small>{{ previewEventCoordinates(event) }}</small></span>
            <span v-if="mode === 'preview' && previewEventStatus(event.id)" class="event-row-note preview-status">{{ previewEventStatus(event.id) }}</span>
            <span v-else-if="event.note" class="event-row-note" :title="event.note">{{ event.note }}</span>
          </button>
          <div v-if="!currentEvents.length" class="pane-empty">{{ t('editor.left.noEvents') }}</div>
        </template>
      </div>
    </section>
    <div
      v-show="mode === 'event' || mode === 'preview'"
      class="pane-resizer"
      role="separator"
      aria-orientation="horizontal"
      :title="t('editor.left.resizeEvents')"
      @dblclick="resetPaletteHeight"
      @mousedown.prevent="startResize"
    />

    <section class="workbench-pane tree-pane">
      <header class="pane-header">
        <strong>{{ t('editor.left.mapTree') }}</strong>
      </header>
      <div class="map-tree">
        <el-tree
          :data="mapTree"
          :props="{ children: 'children', label: 'name' }"
          node-key="id"
          highlight-current
          :draggable="mapTreeDraggable"
          :allow-drag="allowTreeDrag"
          :allow-drop="allowTreeDrop"
          :expand-on-click-node="false"
          :default-expanded-keys="expandedMapIds"
          :current-node-key="selectedMapId ?? undefined"
          @node-click="handleTreeNodeClick"
          @node-expand="(data: TreeNode) => $emit('node-expand', data)"
          @node-collapse="(data: TreeNode) => $emit('node-collapse', data)"
          @node-contextmenu="(event: MouseEvent, data: TreeNode) => mode !== 'preview' && $emit('node-contextmenu', event, data)"
          @node-drop="handleTreeNodeDrop"
        >
          <template #default="{ node, data }">
            <span
              class="tree-node"
              :data-ui-id="`map-tree-node-${data.id}`"
              :class="{ missing: !data.mapFileExists }"
              @dblclick.stop="toggleMapTreeNodeExpansion(node)"
            >
              <span class="node-label">{{ node.label }}</span>
              <span v-if="!data.mapFileExists" class="node-missing" :title="t('editor.left.mapFileMissing')">{{ t('editor.left.missing') }}</span>
              <span v-if="stagedMapIds.has(data.id)" class="node-staged" :title="t('editor.left.stagedTitle')">{{ t('editor.left.staged') }}</span>
            </span>
          </template>
        </el-tree>
        <div v-if="mapTreeLoading" class="pane-empty" role="status">{{ t('editor.left.loadingMaps') }}</div>
        <div v-else-if="mapTreeError" class="pane-empty map-tree-error" role="alert">
          <span>{{ mapTreeError }}</span>
          <button type="button" @click="$emit('retry-map-tree')">{{ t('editor.left.retryMaps') }}</button>
        </div>
        <div v-else-if="!mapTree.length" class="pane-empty">{{ t('editor.left.noMaps') }}</div>
      </div>
    </section>
    <div
      class="dock-resizer"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-valuemin="LEFT_DOCK_MIN_WIDTH"
      :aria-valuemax="dockViewportLimit"
      :aria-valuenow="Math.round(displayedDockWidth)"
      :aria-label="t('editor.left.resizeDock')"
      :title="t('editor.left.resizeDock')"
      @mousedown.prevent="startWidthResize"
      @keydown="resizeDockWidthWithKeyboard"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { AllowDropType, NodeDropType, RenderContentContext } from 'element-plus';
import type { EditorEventListItem, EditorEventSearchHit, EditorMode, PaletteTab, PaletteTabId, TreeNode } from '../editor/editorTypes';
import type { MapPreviewEventState } from '@contract/types';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { useWorkspaceStore } from '../../stores/workspace';
import { useI18n } from '../../i18n';
import { projectMapTreeMove } from '../../utils/mapTreeDragPreview';
import { isPrimaryMapTreeNodeClick, toggleMapTreeNodeExpansion } from '../../utils/mapTreeNodeInteraction';
import {
  clampPaletteHeight,
  DEFAULT_LEFT_DOCK_WIDTH,
  computeMaxPaletteHeight,
  LEFT_DOCK_MAX_WIDTH,
  LEFT_DOCK_MIN_WIDTH,
  PALETTE_MIN_OPEN_HEIGHT,
  PALETTE_RESET_HEIGHT,
} from '../../utils/workspaceSettings';

const props = defineProps<{
  mode: EditorMode;
  tileTabs: PaletteTab[];
  tileTab: PaletteTabId;
  tilesetReady: boolean;
  brushInfo: string;
  brushSet: boolean;
  mapTree: TreeNode[];
  mapTreeLoading: boolean;
  mapTreeError: string;
  mapTreeDraggable: boolean;
  selectedMapId: number | null;
  stagedMapIds: Set<number>;
  expandedMapIds: number[];
  currentEvents: EditorEventListItem[];
  selectedEventId: number | null;
  eventSearchQuery: string;
  eventSearchHits: EditorEventSearchHit[];
  eventSearchLoading: boolean;
  eventSearchTruncated: boolean;
  eventSearchAllMaps: boolean;
  previewEventStates: MapPreviewEventState[];
}>();

const workbenchUi = useWorkbenchUiStore();
const workspaceStore = useWorkspaceStore();
const { t } = useI18n();
const emit = defineEmits<{
  'palette-ready': [canvas: HTMLCanvasElement];
  'palette-mousedown': [event: MouseEvent];
  'palette-mousemove': [event: MouseEvent];
  'palette-mouseup': [event: MouseEvent];
  'palette-mouseleave': [];
  'select-tile-tab': [tab: PaletteTabId];
  'node-click': [node: TreeNode];
  'node-expand': [node: TreeNode];
  'node-collapse': [node: TreeNode];
  'node-contextmenu': [event: MouseEvent, node: TreeNode];
  'node-drop': [source: TreeNode, target: TreeNode, position: 'before' | 'after' | 'inside'];
  'retry-map-tree': [];
  'update:event-search-query': [query: string];
  'search-all-maps': [];
  'select-event': [eventId: number | null];
  'hover-event': [eventId: number | null];
  'open-event': [eventId: number];
  'open-search-hit': [hit: EditorEventSearchHit];
}>();

const workbenchRef = ref<HTMLElement>();
const paletteRef = ref<HTMLCanvasElement>();
const eventRowRefs = new Map<number, HTMLElement>();
const resizing = ref(false);
const widthResizing = ref(false);
const dockViewportLimit = ref(LEFT_DOCK_MAX_WIDTH);
const workbenchHeight = ref(0);
let resizeStart: { y: number; height: number } | null = null;
let widthResizeStart: { x: number; width: number } | null = null;
let workbenchResizeObserver: ResizeObserver | null = null;

const tilesOpen = computed(() => workbenchUi.leftDockTilesOpen);
const displayedPaletteHeight = computed(() => {
  const max = workbenchHeight.value > 0
    ? computeMaxPaletteHeight(workbenchHeight.value)
    : PALETTE_RESET_HEIGHT;
  return Math.max(PALETTE_MIN_OPEN_HEIGHT, Math.min(max, workbenchUi.leftDockPaletteHeight));
});
const palettePaneStyle = computed(() => (
  props.mode === 'event' || tilesOpen.value ? { flex: `0 0 ${displayedPaletteHeight.value}px` } : undefined
));
const displayedDockWidth = computed(() => Math.min(workbenchUi.leftDockWidth, dockViewportLimit.value));
const workbenchStyle = computed(() => ({
  width: `${displayedDockWidth.value}px`,
  minWidth: `${displayedDockWidth.value}px`,
  flex: `0 0 ${displayedDockWidth.value}px`,
}));
const previewEventStateMap = computed(() => new Map(props.previewEventStates.map((state) => [state.id, state])));

function previewEventState(eventId: number) { return previewEventStateMap.value.get(eventId); }
function previewEventCoordinates(event: EditorEventListItem): string {
  const state = props.mode === 'preview' ? previewEventState(event.id) : null;
  return `${state?.x ?? event.x}, ${state?.y ?? event.y}`;
}
function previewEventStatus(eventId: number): string {
  const state = previewEventState(eventId);
  if (!state?.active) return t('editor.preview.eventInactive');
  if (state.hiddenReason === 'erased') return t('editor.preview.eventErased');
  if (state.hiddenReason === 'transparent') return t('editor.preview.eventTransparent');
  if (state.hiddenReason === 'no-graphic') return t('editor.preview.eventNoGraphic');
  if (!state.visible) return t('editor.preview.eventHidden');
  return '';
}

function toggleTiles() {
  workbenchUi.setLeftDockTilesOpen(!workbenchUi.leftDockTilesOpen);
}

function handleTreeNodeClick(data: TreeNode, _node: unknown, _component: unknown, event?: MouseEvent): void {
  if (!isPrimaryMapTreeNodeClick(event?.detail)) return;
  emit('node-click', data);
}

type ElementTreeNode = RenderContentContext['node'];
type TreeMovePosition = 'before' | 'after' | 'inside';

function allowTreeDrag(): boolean {
  return props.mapTreeDraggable;
}

function allowTreeDrop(draggingNode: ElementTreeNode, dropNode: ElementTreeNode, type: AllowDropType): boolean {
  if (!props.mapTreeDraggable) return false;
  return projectMapTreeMove(
    props.mapTree,
    Number((draggingNode.data as TreeNode).id),
    Number((dropNode.data as TreeNode).id),
    allowDropTypeToPosition(type),
  ).valid;
}

function handleTreeNodeDrop(
  draggingNode: ElementTreeNode,
  dropNode: ElementTreeNode,
  type: Exclude<NodeDropType, 'none'>,
): void {
  emit(
    'node-drop',
    draggingNode.data as TreeNode,
    dropNode.data as TreeNode,
    nodeDropTypeToPosition(type),
  );
}

function allowDropTypeToPosition(type: AllowDropType): TreeMovePosition {
  if (type === 'prev') return 'before';
  if (type === 'next') return 'after';
  return 'inside';
}

function nodeDropTypeToPosition(type: Exclude<NodeDropType, 'none'>): TreeMovePosition {
  return type === 'inner' ? 'inside' : type;
}

function searchHitLocation(hit: EditorEventSearchHit): string {
  if (hit.pageIndex == null) {
    if (hit.matchKind === 'id') return t('editor.left.match.id');
    if (hit.matchKind === 'name') return t('editor.left.match.name');
    return t('editor.left.match.note');
  }
  return t('editor.left.commandLocation', { page: hit.pageIndex + 1, command: (hit.commandIndex ?? 0) + 1 });
}

function formatEventId(eventId: number): string {
  return String(Math.max(0, Math.floor(eventId))).padStart(3, '0');
}

function setEventRowRef(eventId: number, element: unknown): void {
  if (element instanceof HTMLElement) eventRowRefs.set(eventId, element);
  else eventRowRefs.delete(eventId);
}

function clearPreviewSelectionFromBlank(event: MouseEvent): void {
  if (props.mode !== 'preview') return;
  if ((event.target as Element | null)?.closest('.event-row')) return;
  emit('select-event', null);
}

watch(() => [props.selectedEventId, props.currentEvents, props.eventSearchQuery] as const, async ([eventId, _events, query]) => {
  if (eventId == null || query.trim()) return;
  await nextTick();
  eventRowRefs.get(eventId)?.scrollIntoView({ block: 'nearest' });
});

function updateDockViewportLimit(): void {
  const available = workbenchRef.value?.parentElement?.clientWidth || window.innerWidth;
  const centerSafeLimit = Math.floor(available - 390);
  dockViewportLimit.value = Math.max(
    LEFT_DOCK_MIN_WIDTH,
    Math.min(LEFT_DOCK_MAX_WIDTH, Math.floor(available * .42), centerSafeLimit),
  );
}

function startWidthResize(event: MouseEvent): void {
  updateDockViewportLimit();
  widthResizing.value = true;
  widthResizeStart = { x: event.clientX, width: displayedDockWidth.value };
  workbenchUi.setLeftDockWidth(displayedDockWidth.value);
  document.addEventListener('mousemove', resizeDockWidth);
  document.addEventListener('mouseup', stopWidthResize);
}

function resizeDockWidth(event: MouseEvent): void {
  if (!widthResizeStart) return;
  const width = widthResizeStart.width + event.clientX - widthResizeStart.x;
  workbenchUi.setLeftDockWidth(Math.max(LEFT_DOCK_MIN_WIDTH, Math.min(dockViewportLimit.value, width)));
}

function stopWidthResize(): void {
  if (!widthResizeStart) return;
  widthResizeStart = null;
  widthResizing.value = false;
  document.removeEventListener('mousemove', resizeDockWidth);
  document.removeEventListener('mouseup', stopWidthResize);
  workspaceStore.markLeftDockWidthPersisted(workbenchUi.leftDockWidth);
}

function resizeDockWidthWithKeyboard(event: KeyboardEvent): void {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  updateDockViewportLimit();
  const width = event.key === 'Home'
    ? LEFT_DOCK_MIN_WIDTH
    : event.key === 'End'
      ? dockViewportLimit.value
      : displayedDockWidth.value + direction * 16;
  workbenchUi.setLeftDockWidth(Math.max(LEFT_DOCK_MIN_WIDTH, Math.min(dockViewportLimit.value, width)));
  workspaceStore.markLeftDockWidthPersisted(workbenchUi.leftDockWidth);
}

function startResize(event: MouseEvent) {
  if (props.mode === 'map' && !tilesOpen.value) return;
  resizing.value = true;
  resizeStart = { y: event.clientY, height: displayedPaletteHeight.value };
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
  const available = workbenchHeight.value || workbenchRef.value?.clientHeight || 0;
  return computeMaxPaletteHeight(available);
}

function clampPaletteHeightLocal(height: number): number {
  const available = workbenchHeight.value || workbenchRef.value?.clientHeight || 0;
  const max = available > 0 ? computeMaxPaletteHeight(available) : PALETTE_RESET_HEIGHT;
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
  stopWidthResize();
  workbenchResizeObserver?.disconnect();
  workbenchResizeObserver = null;
  window.removeEventListener('resize', updateDockViewportLimit);
});

onMounted(() => {
  updateDockViewportLimit();
  window.addEventListener('resize', updateDockViewportLimit);
  if (workbenchRef.value) {
    workbenchHeight.value = workbenchRef.value.clientHeight;
    workbenchResizeObserver = new ResizeObserver((entries) => {
      workbenchHeight.value = Math.floor(entries[0]?.contentRect.height || 0);
    });
    workbenchResizeObserver.observe(workbenchRef.value);
  }
  if (!workspaceStore.leftDockWidthPersisted) {
    workspaceStore.markLeftDockWidthPersisted(Math.min(DEFAULT_LEFT_DOCK_WIDTH, dockViewportLimit.value));
  }
  if (paletteRef.value) emit('palette-ready', paletteRef.value);
  void nextTick(() => {
    applyInitialPaletteHeightIfNeeded();
  });
});
</script>

<style scoped>
.editor-workbench {
  position: relative;
  padding: 0 6px 8px 0;
  background: var(--app-bg-page);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dock-resizer{position:absolute;top:0;right:0;bottom:0;width:8px;z-index:2;cursor:col-resize;outline:0}.dock-resizer::before{content:"";position:absolute;top:8px;right:2px;bottom:8px;width:2px;border-radius:999px;background:transparent;transition:background-color var(--app-dur) var(--app-ease)}.dock-resizer:hover::before,.dock-resizer:focus-visible::before,.editor-workbench.width-resizing .dock-resizer::before{background:var(--app-accent)}.editor-workbench.width-resizing{user-select:none}
.workbench-pane { min-height: 0; display: flex; flex-direction: column; overflow: hidden; border:1px solid var(--app-border); border-radius:6px; background:var(--app-bg); box-shadow:none; }
.palette-pane { flex:0 0 214px; }
.palette-pane.collapsed { flex:0 0 30px; }
.tree-pane { flex:1 1 auto; }
.event-list-pane { flex:0 0 214px; }
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
.pane-count{min-width:20px;padding:1px 5px;border-radius:2px;background:var(--app-bg-soft);color:var(--app-ink-soft);font-size:10px;text-align:center}.event-search{height:28px;margin:4px;display:flex;align-items:center;gap:5px;padding:0 6px;border:1px solid var(--app-border);border-radius:2px;background:var(--app-bg);color:var(--app-ink-muted)}.event-search:focus-within{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}.event-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--app-ink);font:inherit;font-size:11px}.event-search-scope{min-height:24px;margin:0 4px 3px;display:flex;align-items:center;justify-content:space-between;gap:5px;color:var(--app-ink-muted);font-size:9px}.event-search-scope button{min-height:22px;padding:0 6px;border:1px solid var(--app-border);border-radius:2px;background:var(--app-bg);color:var(--app-accent);font:inherit;font-size:9px;cursor:pointer}.event-search-scope button:hover{background:var(--app-accent-soft)}.event-search-scope button:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}.event-list{min-height:0;flex:1;overflow:auto;padding:1px 3px 4px}.event-row{width:100%;min-height:25px;padding:3px 5px;display:flex;flex-direction:column;align-items:stretch;gap:1px;border:0;border-radius:1px;background:transparent;color:var(--app-ink);text-align:left;cursor:pointer}.event-row:hover,.event-row.active{background:var(--app-bg-sunken)}.event-row.active{box-shadow:inset 2px 0 0 var(--app-accent)}.event-row.muted{opacity:.52}.event-row.muted.active{opacity:.82}.event-row:focus-visible{outline:2px solid var(--app-accent);outline-offset:-2px}.event-row-main{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}.event-row-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600}.event-row-main small,.event-row-text,.event-row-note{color:var(--app-ink-muted);font-size:9px}.event-row-text,.event-row-note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-row-note{display:block}.preview-status{color:#b76858}.search-hit{min-height:34px;border-bottom:1px solid var(--app-border)}.pane-empty.compact{padding-top:4px;padding-bottom:4px}
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
.tile-tabs button.unavailable { color: var(--app-ink-muted); }
.tile-tabs button.unavailable::after { content:'·'; margin-left:2px; color:var(--app-warn); }
.tile-tabs button:disabled { cursor: not-allowed; opacity: .48; }
.palette-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; margin:0; background: var(--app-bg-sunken); }
.palette-canvas { display: block; width:auto; max-width:100%; height:auto; cursor: default; image-rendering: pixelated; }
.map-tree { flex: 1; overflow: auto; padding: 2px 3px 6px; background: repeating-linear-gradient(to bottom, transparent 0, transparent 22px, var(--app-bg-soft) 22px, var(--app-bg-soft) 44px); background-attachment: local; background-origin: content-box; }
.tree-node { position:relative; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 5px; overflow: hidden; cursor:grab; }
.preview-mode .tree-node{cursor:pointer}
.tree-node:active { cursor:grabbing; }
.node-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color:var(--app-ink); font-size: 12px; line-height:1; }
.node-staged { flex:0 0 auto; padding: 1px 4px; border-radius: 4px; background: var(--app-warn-soft); color: var(--app-warn); font-size: 9px; font-weight:600; }
.tree-node.missing .node-label { color: var(--app-danger); text-decoration: line-through; text-decoration-thickness: 1px; }
.node-missing { flex:0 0 auto; padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, var(--app-danger) 11%, transparent); color: var(--app-danger); font-size: 9px; font-weight:650; }
.pane-empty { padding: 10px; color: var(--app-ink-muted); font-size: 12px; }
.map-tree-error { display: grid; gap: 8px; color: var(--app-danger); }
.map-tree-error button { justify-self: start; padding: 3px 8px; border: 1px solid var(--app-border); border-radius: 3px; background: var(--app-bg); color: var(--app-accent); font: inherit; cursor: pointer; }
.map-tree-error button:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 1px; }
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
