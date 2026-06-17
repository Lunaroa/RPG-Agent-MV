<template>
  <div class="editor-view">
    <EditorToolbar
      v-model:mode="mode"
      v-model:tool="tool"
      v-model:paint-mode="paintMode"
      v-model:region-id="regionId"
      v-model:shadow-bits="shadowBits"
      v-model:show-regions="showRegions"
      v-model:show-tile-flags="showTileFlags"
      :tile-flags-available="tileFlagsAvailable"
      :zoom="zoom"
      :undo-len="undoLen"
      :redo-len="redoLen"
      :busy="busy"
      :staging-dirty="stagingDirty"
      @undo="undo"
      @redo="redo"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
      @apply="applyStaging"
      @discard="discardStaging"
    />

    <div class="editor-body" :style="editorBodyStyle">
      <LeftDock
        :mode="mode"
        :paint-mode="paintMode"
        :tile-tabs="tileTabs"
        :tile-tab="tileTab"
        :tileset-ready="tilesetReady"
        :brush-info="brushInfo"
        :brush-set="brushSet"
        :map-tree="mapTree"
        :selected-map-id="selectedMapId"
        :staged-map-ids="stagedMapIds"
        :expanded-map-ids="expandedMapIds"
        @palette-ready="setPaletteCanvas"
        @palette-mousedown="onPaletteMouseDown"
        @palette-mousemove="onPaletteMouseMove"
        @palette-mouseup="onPaletteMouseUp"
        @select-tile-tab="selectTileTab"
        @node-click="handleNodeClick"
        @node-expand="onTreeNodeExpand"
        @node-collapse="onTreeNodeCollapse"
        @node-contextmenu="onTreeContextMenu"
      />

      <div class="center-col">
        <main class="editor-stage">
          <div v-if="selectedMapId == null" class="empty-state">
            <el-empty description="当前工程还没有地图">
              <div class="empty-actions">
                <el-button type="primary" @click="openCreateProperties(0)">新建地图</el-button>
              </div>
            </el-empty>
          </div>
          <div
            v-else
            :ref="setScrollElement"
            class="canvas-scroll"
            :class="{ panning: isPanning }"
            @wheel="onCanvasWheel"
          >
            <div class="canvas-stack" :style="{ width: `${canvasWidth * zoom}px`, height: `${canvasHeight * zoom}px` }">
              <canvas
                :ref="setCanvasElement"
                class="map-canvas"
                :width="canvasWidth"
                :height="canvasHeight"
                @mousedown="onCanvasMouseDown"
                @mousemove="onCanvasMouseMove"
                @mouseleave="onCanvasMouseLeave"
                @dblclick="onCanvasDoubleClick"
                @contextmenu.prevent="onCanvasContextMenu"
              />
              <canvas :ref="setOverlayElement" class="overlay-canvas" :width="canvasWidth" :height="canvasHeight" />
            </div>
          </div>
            <div v-if="selectedMapId != null" class="canvas-zoom">
              <button type="button" title="缩小" @click="zoomOut">−</button>
              <button type="button" title="重置缩放" @click="resetZoom">{{ Math.round(zoom * 100) }}%</button>
              <button type="button" title="放大" @click="zoomIn">+</button>
            </div>
            <span v-if="selectedMapId != null" class="canvas-mode-chip">{{ mode === 'map' ? mapPaintModeLabel : '事件模式' }}</span>
        </main>

        <BottomPanel
          :mode="mode"
          :catalog="editorCatalog"
          :current-map-id="selectedMapId"
          @select="onPlacementSelect"
          @place="onPlacementPlace"
          @reject="onPlacementReject"
          @back-chat="goBackToChatPlacement"
        />
      </div>
    </div>

    <MapPropertiesDialog
      :visible="propertiesDialogOpen"
      :mode="propertiesDialogMode"
      :form="properties"
      :tilesets="tilesets"
      :catalog="editorCatalog"
      :load-image="loadImage"
      :parent-label="propertiesParentLabel"
      :busy="busy"
      @close="closePropertiesDialog"
      @save="saveProperties"
    />
    <EventEditorDialog
      ref="eventDialogRef"
      :visible="eventDialogOpen"
      :draft="eventDraft"
      :saving="eventSaving"
      :map-id="selectedMapId"
      :system-data="systemData"
      :catalog="editorCatalog"
      :tileset-images="currentTilesetImages"
      :load-image="loadImage"
      :overview="eventOverview"
      @close="closeEventEditor"
      @save="saveEvent"
    />

    <teleport to="body">
      <div v-if="treeContext.visible" class="ctx-mask" @mousedown.self="closeTreeContext" @contextmenu.prevent="closeTreeContext">
        <ul class="ctx-menu" :style="{ left: `${treeContext.x}px`, top: `${treeContext.y}px` }">
          <li @click="ctxEditProperties">编辑属性...</li>
          <li @click="ctxNewMapUnder">在此图下新建...</li>
          <li class="ctx-sep" />
          <li :class="{ disabled: !stagedMapIds.has(treeContext.mapId) }" @click="ctxApplyMap">应用该地图暂存</li>
          <li :class="{ disabled: !stagedMapIds.has(treeContext.mapId) }" @click="ctxDiscardMap">丢弃该地图暂存</li>
          <li class="ctx-sep" />
          <li @click="ctxCopyMap">复制</li>
          <li :class="{ disabled: mapClipboard == null }" @click="ctxPasteMap">粘贴</li>
          <li class="ctx-danger" @click="ctxDeleteMap">删除</li>
        </ul>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="canvasContext.visible" class="ctx-mask" @mousedown.self="closeCanvasContext" @contextmenu.prevent="closeCanvasContext">
        <ul class="ctx-menu canvas-menu" :style="{ left: `${canvasContext.x}px`, top: `${canvasContext.y}px` }">
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxEditEvent">编辑...<span class="ctx-shortcut">Enter</span></li>
          <li :class="{ disabled: canvasContext.eventId != null }" @click="ctxNewEvent">新建...</li>
          <li class="ctx-sep" />
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxCutEvent">剪切<span class="ctx-shortcut">Ctrl+X</span></li>
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxCopyEvent">复制<span class="ctx-shortcut">Ctrl+C</span></li>
          <li :class="{ disabled: !eventClipboard || canvasContext.eventId != null }" @click="ctxPasteEvent">粘贴<span class="ctx-shortcut">Ctrl+V</span></li>
          <li :class="{ disabled: canvasContext.eventId == null }" class="ctx-danger" @click="ctxDeleteEvent">删除<span class="ctx-shortcut">Del</span></li>
          <li class="ctx-sep" />
          <li class="ctx-has-sub" :class="{ disabled: canvasContext.eventId != null }" @mouseenter="quickCreateHover = true" @mouseleave="quickCreateHover = false">
            快速创建事件<span class="ctx-arrow">▶</span>
            <ul v-show="quickCreateHover" class="ctx-submenu">
              <li @click="quickCreate('transfer')">传送...</li>
              <li @click="quickCreate('door')">门...</li>
              <li @click="quickCreate('treasure')">宝箱</li>
              <li @click="quickCreate('inn')">旅馆</li>
            </ul>
          </li>
          <li class="ctx-sep" />
          <li @click="ctxSetSystemPosition('player')">设置玩家初始位置</li>
          <li @click="ctxSetSystemPosition('boat')">设置小船位置</li>
          <li @click="ctxSetSystemPosition('ship')">设置大船位置</li>
          <li @click="ctxSetSystemPosition('airship')">设置飞艇位置</li>
        </ul>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { LAYER_Z } from '../constants/layerZIndex';
import { useRoute, useRouter } from 'vue-router';
import EditorToolbar from '../components/editor/EditorToolbar.vue';
import LeftDock from '../components/layout/LeftDock.vue';
import EventEditorDialog from '../components/editor/EventEditorDialog.vue';
import MapPropertiesDialog from '../components/editor/MapPropertiesDialog.vue';
import BottomPanel from '../components/editor/BottomPanel.vue';
import type { EditorMode, EditorStatusKind, MapPaintMode, MapPropertiesForm, MapTool, TreeNode } from '../components/editor/editorTypes';
import { eventRegistry, events as eventsApi, maps as mapsApi, projectAssets, resolveAssetUrl, storyPages, type EditorProjectCatalog, type MapTreeNode, type RmmvAudioSettings, type RmmvMapEncounter, type RmmvMapProperties, type RmmvSystemPositionTarget, type StoryEventOverview, type TilesetSummary } from '../api/client';
import { useMapCanvasEditor, type PlacementFlashCell } from '../composables/useMapCanvasEditor';
import { clone, defaultEvent, quickEventTemplate, type MvEditorEvent, type MvEventImage, type QuickEventType } from '../composables/useEventEditor';
import {
  EDITOR_DEFAULT_ZOOM,
  readEditorWorkspaceSelection,
  readEditorZoom,
  writeEditorWorkspaceSelection,
} from '../composables/useEditorWorkspaceState';
import { useSessionStream } from '../composables/useSessionStream';
import { useEventPlacementAskStore, type PlacementListEvent } from '../stores/eventPlacementAsk';
import { useWorkbenchUiStore } from '../stores/workbenchUi';
import { useProjectStore } from '../stores/project';
import { placeContractAtCell } from '../composables/usePlacementAtCell';
import type { MvEvent, MvMap } from '../composables/useMapRenderer';
import { isPlacedStatus } from '../utils/placementStatus';
import { canActivatePlacementOnMap } from '../utils/placementMapPolicy';
import { placementValidityHint, validatePlacementCell } from '../utils/placementCellValidity';
import { registerEditorUiControlHandler, type EditorUiControlState } from '../utils/uiControl';

interface ApiError extends Error { status?: number }
type EditableMap = MvMap & Partial<RmmvMapProperties> & Record<string, unknown>;

const route = useRoute();
const router = useRouter();
const eventPlacementAsk = useEventPlacementAskStore();
const workbenchUi = useWorkbenchUiStore();
const projectStore = useProjectStore();

// 聊天浮层盖住的是顶部工具栏（满宽不挤压）；地图区按浮层宽度右移让出可见空间。
const editorBodyStyle = computed(() => {
  const reserve = workbenchUi.agentPanelOpen ? Math.max(0, workbenchUi.agentPanelWidth - 10) : 0;
  return { paddingRight: `${reserve}px` };
});
const { syncPlacementEventPatch } = useSessionStream();
const placementFocus = computed(() => eventPlacementAsk.activeFocus);
const placementSession = computed(() => eventPlacementAsk.activeSession);
const placementEvents = computed(() => eventPlacementAsk.placeableEvents);
const placementSelectedEvent = computed(() => {
  const id = eventPlacementAsk.placingContractId || eventPlacementAsk.activeContractId;
  return placementEvents.value.find((e) => e.contractId === id) || null;
});
const placementActive = computed(() => {
  const placingId = eventPlacementAsk.placingContractId;
  const item = placementSelectedEvent.value;
  return Boolean(
    placingId
    && item?.contractId === placingId
    && !isPlacedStatus(item.status)
    && canActivatePlacementOnMap(selectedMapId.value),
  );
});
const PLACEMENT_DIRECTIONS = [2, 4, 6, 8] as const;
const EDITOR_COMMAND_EVENT = 'agent-rpg:editor-command';
const placementDirection = ref<number>(2);
const placementFlash = ref<PlacementFlashCell | null>(null);
const tilesetFlags = ref<number[]>([]);
const contextMenuZ = String(LAYER_Z.contextMenu);
const mapTree = ref<TreeNode[]>([]);
const expandedMapIds = ref<number[]>([]);
const tilesets = ref<TilesetSummary[]>([]);
const selectedMapId = ref<number | null>(null);
const mode = ref<EditorMode>('map');
const tool = ref<MapTool>('pencil');
const paintMode = ref<MapPaintMode>('tile');
const regionId = ref(1);
const shadowBits = ref(15);
const layer = ref(0);
const showGrid = ref(true);
const showEvents = ref(true);
const showRegions = ref(false);
const showTileFlags = ref(false);
const busy = ref(false);
const statusText = ref('');
const statusKind = ref<EditorStatusKind>('');
const stagingDirty = ref(false);
const stagedMapIds = ref(new Set<number>());
const selectedEventId = ref<number | null>(null);
const currentMapName = ref('');
const propertiesDialogOpen = ref(false);
const propertiesDialogMode = ref<'create' | 'edit'>('edit');
const properties = reactive<MapPropertiesForm>(defaultMapPropertiesForm());
const eventDialogOpen = ref(false);
const eventDialogRef = ref<InstanceType<typeof EventEditorDialog>>();
const eventDraft = ref<MvEditorEvent | null>(null);
const eventOverview = ref<StoryEventOverview | null>(null);
const eventSaving = ref(false);
const mapClipboard = ref<number | null>(null);
const eventClipboard = ref<{ eventId: number; data: MvEditorEvent } | null>(null);
const quickCreateHover = ref(false);
const treeContext = reactive({ visible: false, x: 0, y: 0, mapId: 0 });
const canvasContext = reactive({ visible: false, x: 0, y: 0, cellX: 0, cellY: 0, eventId: null as number | null });
const systemData = ref<{ switches: string[]; variables: string[] } | null>(null);
const editorCatalog = ref<EditorProjectCatalog | null>(null);
const currentTilesetImages = shallowRef<(HTMLImageElement | null)[]>([]);

let currentMap: EditableMap | null = null;
let unregisterUiControlHandler: (() => void) | null = null;
const characterImages = new Map<string, HTMLImageElement | null>();
const characterAssetUrls = new Map<string, string>();

function getPlacementCellValidity(x: number, y: number) {
  return validatePlacementCell(currentMap, tilesetFlags.value, x, y);
}

function getPlacementPreviewImage(): MvEventImage {
  return {
    tileId: 0,
    characterName: '',
    direction: placementDirection.value,
    pattern: 1,
    characterIndex: 0,
  };
}

function rotatePlacementDirection(deltaY: number) {
  const list = [...PLACEMENT_DIRECTIONS];
  let idx = list.indexOf(placementDirection.value as typeof PLACEMENT_DIRECTIONS[number]);
  if (idx < 0) idx = 0;
  idx = (idx + (deltaY < 0 ? 1 : -1) + list.length) % list.length;
  placementDirection.value = list[idx];
  setStatus(`朝向 ${placementDirection.value}`, 'busy');
}

const canvasEditor = useMapCanvasEditor({
  mode,
  tool,
  paintMode,
  regionId,
  shadowBits,
  layer,
  showGrid,
  showEvents,
  showRegions,
  showTileFlags,
  tileFlags: tilesetFlags,
  selectedEventId,
  busy,
  placementActive,
  placementDirection,
  placementFlash,
  getPlacementPreviewImage,
  getPlacementCellValidity: getPlacementCellValidity,
  onPlacementClick: (cell) => { void runPlacementAt(cell); },
  onPlacementWheel: rotatePlacementDirection,
  postTiles: async (edits) => {
    if (mode.value !== 'map') throw new Error('事件模式禁止修改地图图块');
    if (selectedMapId.value == null) throw new Error('没有选中的地图');
    return mapsApi.postTiles(selectedMapId.value, edits, projectStore.currentProject);
  },
  reloadMap: reloadCurrentMap,
  selectEvent,
  moveEvent,
  openEvent: openEventEditor,
  newEvent: openNewEventAt,
  setStatus,
  getCharacterImage: (name) => characterImages.get(name) || null,
});
const {
  canvasWidth, canvasHeight, zoom, cursorText, tilesetReady, tileTab, tileTabs,
  brushInfo, brushSet, undoLen, redoLen, isPanning,
  setMap, replaceMap, clearMap, setPaletteCanvas, setCanvasElement, setOverlayElement, setScrollElement, selectTileTab, canvasCell, eventAtCell,
  onPaletteMouseDown, onPaletteMouseMove, onPaletteMouseUp,
  onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasDoubleClick, onCanvasWheel,
  renderMap, renderOverlay, zoomIn, zoomOut, resetZoom, setZoom, undo, redo, getPlacementCell,
} = canvasEditor;

const placementStatusHint = computed(() => {
  const cell = getPlacementCell();
  const validity = cell && currentMap
    ? validatePlacementCell(currentMap, tilesetFlags.value, cell.x, cell.y)
    : { valid: false, reason: '将鼠标移到目标格子上' };
  return placementValidityHint(validity, cell);
});

const selectedMapLabel = computed(() => selectedMapId.value == null ? '未选择地图' : `MAP ${String(selectedMapId.value).padStart(3, '0')} · ${currentMapName.value || '未命名地图'}`);
const propertiesParentLabel = computed(() => properties.parentId ? `MAP ${properties.parentId} · ${findTreeNode(properties.parentId)?.name || '未命名地图'}` : '根目录');
const tileFlagsAvailable = computed(() => tilesetFlags.value.some((flag) => Number.isInteger(flag)));
const mapPaintModeLabel = computed(() => {
  if (paintMode.value === 'shadow') return `阴影 ${shadowBits.value}`;
  if (paintMode.value === 'region') return `区域 ${regionId.value}`;
  return '图块模式';
});

const zoomControls = { zoomIn, zoomOut, resetZoom };

onMounted(async () => {
  unregisterUiControlHandler = registerEditorUiControlHandler({
    openEventEditor: openEventEditorByUiControl,
    getState: getUiControlState,
  });
  workbenchUi.bindEditorZoomControls(zoomControls);
  workbenchUi.setEditorZoom(zoom.value);
  if (projectStore.currentProject) {
    const saved = readEditorWorkspaceSelection(projectStore.currentProject);
    if (saved) mode.value = saved.mode;
    setZoom(saved?.zoom ?? EDITOR_DEFAULT_ZOOM);
    if (saved?.expandedMapIds?.length) expandedMapIds.value = [...saved.expandedMapIds];
    await refreshPlacementQueueFromRegistry();
    await Promise.all([loadTree(), loadEditorCatalog()]);
    await openPreferredMap(saved?.mapId);
    if (saved?.tileTab) selectTileTab(saved.tileTab);
    ensureTreeExpandedForSelection();
    await applyPlacementFocusFromRoute();
    await applyRouteEventFocus();
  }
  window.addEventListener('keydown', onEditorKeyDown);
  window.addEventListener(EDITOR_COMMAND_EVENT, onEditorCommand as EventListener);
});
onUnmounted(() => {
  unregisterUiControlHandler?.();
  unregisterUiControlHandler = null;
  workbenchUi.clearEditorZoomControls(zoomControls);
  workbenchUi.clearStatusBar();
  window.removeEventListener('keydown', onEditorKeyDown);
  window.removeEventListener(EDITOR_COMMAND_EVENT, onEditorCommand as EventListener);
});
watch(mode, persistWorkspaceSelection);
watch(tileTab, persistWorkspaceSelection);
watch(zoom, (value) => {
  workbenchUi.setEditorZoom(value);
  persistWorkspaceSelection();
});
watch(() => route.query.mapId, () => { void applyPlacementFocusFromRoute(); });
watch(() => [route.query.mapId, route.query.eventId], () => { void applyRouteEventFocus(); });
watch(placementFocus, (focus) => {
  if (!focus) return;
  mode.value = 'event';
  setStatus(placementStatusHint.value, 'busy');
});

watch(placementActive, (active) => {
  if (active) mode.value = 'event';
});

watch(placementStatusHint, (hint) => {
  if (placementActive.value) setStatus(hint, 'busy');
});
watch(tileFlagsAvailable, (available) => {
  if (!available) showTileFlags.value = false;
});

/* ---- Sync status bar data to global store ---- */
watch(selectedMapLabel, (v) => { workbenchUi.sbMapLabel = v; });
watch(mode, (v) => { workbenchUi.sbMode = v; });
watch(cursorText, (v) => { workbenchUi.sbCursor = v; });
watch(zoom, (v) => { workbenchUi.sbZoom = Math.round(v * 100); });
watch(stagingDirty, (v) => { workbenchUi.sbStagingDirty = v; });
watch(placementActive, (v) => { workbenchUi.sbPlacementActive = v; });
watch(placementStatusHint, (v) => { workbenchUi.sbPlacementHint = v; });
watch(statusText, (v) => { workbenchUi.sbStatusText = v; });
watch(statusKind, (v) => { workbenchUi.sbStatusKind = v; });

watch(() => projectStore.currentProject, async () => {
  selectedMapId.value = null;
  mapTree.value = [];
  tilesets.value = [];
  editorCatalog.value = null;
  if (!projectStore.currentProject) {
    expandedMapIds.value = [];
    setZoom(EDITOR_DEFAULT_ZOOM);
    return;
  }
  const saved = readEditorWorkspaceSelection(projectStore.currentProject);
  if (saved) mode.value = saved.mode;
  setZoom(saved?.zoom ?? EDITOR_DEFAULT_ZOOM);
  if (saved?.expandedMapIds?.length) expandedMapIds.value = [...saved.expandedMapIds];
  await refreshPlacementQueueFromRegistry();
  await Promise.all([loadTree(), loadEditorCatalog()]);
  await openPreferredMap(saved?.mapId);
  if (saved?.tileTab) selectTileTab(saved.tileTab);
  ensureTreeExpandedForSelection();
});

async function loadTree() {
  try {
    const [index, tilesetPayload] = await Promise.all([mapsApi.tree(projectStore.currentProject), mapsApi.tilesets(projectStore.currentProject)]);
    mapTree.value = buildTree(index.maps);
    if (editorCatalog.value) editorCatalog.value = { ...editorCatalog.value, maps: index.maps };
    tilesets.value = tilesetPayload.tilesets;
    await refreshStagingStatus();
  } catch (error) { ElMessage.error(`加载地图树失败：${(error as Error).message}`); }
}
function buildTree(flat: MapTreeNode[]) {
  const nodes = new Map<number, TreeNode>();
  for (const item of flat) nodes.set(item.id, { ...item, children: [] });
  const roots: TreeNode[] = [];
  for (const item of nodes.values()) {
    const parent = item.parentId ? nodes.get(item.parentId) : null;
    if (parent) parent.children!.push(item);
    else roots.push(item);
  }
  for (const item of nodes.values()) if (!item.children!.length) delete item.children;
  return roots;
}
function findTreeNode(mapId: number): TreeNode | undefined {
  const visit = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === mapId) return node;
      const child = node.children && visit(node.children);
      if (child) return child;
    }
  };
  return visit(mapTree.value);
}
async function handleNodeClick(node: TreeNode) { await loadMap(node.id); }
async function openPreferredMap(savedMapId?: number) {
  const routeMapId = Number(route.query.mapId);
  const candidates = [...new Set([
    ...(Number.isInteger(routeMapId) && routeMapId > 0 ? [routeMapId] : []),
    ...(savedMapId ? [savedMapId] : []),
    ...flattenTree(mapTree.value).map((node) => node.id),
  ])];
  for (const mapId of candidates) if (await loadMap(mapId, { quiet: true })) return true;
  if (mapTree.value.length) ElMessage.error('工程中没有可加载的地图，请检查地图文件。');
  return false;
}

async function applyPlacementFocusFromRoute() {
  if (!placementFocus.value) return;
  setStatus(placementStatusHint.value, 'busy');
}

async function applyRouteEventFocus() {
  const routeMapId = Number(route.query.mapId);
  const routeEventId = Number(route.query.eventId);
  if (!Number.isInteger(routeMapId) || routeMapId <= 0) return;
  if (!Number.isInteger(routeEventId) || routeEventId <= 0) return;
  if (selectedMapId.value !== routeMapId) {
    const loaded = await loadMap(routeMapId, { quiet: true });
    if (!loaded) return;
  }
  const eventExists = currentMap?.events?.some((item) => item?.id === routeEventId);
  if (!eventExists) {
    selectedEventId.value = null;
    renderMap();
    return;
  }
  selectedEventId.value = routeEventId;
  renderMap();
}

function patchPlacementEvent(
  contractId: string,
  patch: Partial<PlacementListEvent>,
) {
  const focus = placementFocus.value;
  if (!focus) return;
  const updated = syncPlacementEventPatch(focus.askId, contractId, patch as Record<string, unknown>);
  if (updated?.events) {
    eventPlacementAsk.syncEventsFromAsk(updated.events as unknown as PlacementListEvent[]);
  }
  eventPlacementAsk.markEventPlaced(contractId, patch);
}

function onPlacementSelect(contractId: string) {
  eventPlacementAsk.selectContract(contractId);
}

function onPlacementPlace(contractId: string) {
  const item = placementEvents.value.find((e) => e.contractId === contractId);
  if (!item || isPlacedStatus(item.status)) return;
  eventPlacementAsk.startPlacing(contractId);
  mode.value = 'event';
  setStatus(placementStatusHint.value, 'busy');
}

interface RejectUndoEntry { event: PlacementListEvent; index: number; previousStatus?: string }
const rejectUndoStack = ref<RejectUndoEntry[]>([]);

// 拒绝不弹确认（批量拒绝时太烦），即时移除 + 后台落状态；误点用 Ctrl+Z 撤回上一条。
async function onPlacementReject(contractId: string) {
  const index = placementEvents.value.findIndex((e) => e.contractId === contractId);
  const item = index >= 0 ? placementEvents.value[index] : null;
  if (!item || isPlacedStatus(item.status)) return;
  const snapshot: PlacementListEvent = { ...item };
  const name = item.eventName || contractId;
  eventPlacementAsk.removeEvent(contractId);
  let previousStatus: string | undefined;
  try {
    const res = await eventRegistry.reject(projectStore.currentProject, contractId, { reason: '用户在放置编排中拒绝' });
    previousStatus = res?.previousStatus;
  } catch (error) {
    // 注册表里没有该契约（如未登记的临时事件）时照常本地移除，仅记录告警。
    console.warn('[placement] reject contract failed', error);
  }
  rejectUndoStack.value.push({ event: snapshot, index, previousStatus });
  setStatus(`已拒绝「${name}」 · Ctrl+Z 撤回`, 'saved');
}

async function undoLastReject() {
  const entry = rejectUndoStack.value.pop();
  if (!entry) return;
  eventPlacementAsk.restoreEvent(entry.event, entry.index);
  try {
    await eventRegistry.unreject(
      projectStore.currentProject,
      entry.event.contractId,
      entry.previousStatus ? { status: entry.previousStatus } : {},
    );
  } catch (error) {
    console.warn('[placement] unreject contract failed', error);
  }
  setStatus(`已撤回拒绝「${entry.event.eventName || entry.event.contractId}」`, 'saved');
}

async function runPlacementAt(cell: { x: number; y: number }) {
  const focus = placementFocus.value;
  const selected = placementSelectedEvent.value;
  const mapId = selectedMapId.value;
  if (!focus || !selected || isPlacedStatus(selected.status) || mapId == null || !canActivatePlacementOnMap(mapId)) return;
  const validity = validatePlacementCell(currentMap, tilesetFlags.value, cell.x, cell.y);
  if (!validity.valid) {
    ElMessage.warning(validity.reason || '无法在此格放置');
    return;
  }
  busy.value = true;
  try {
    const result = await placeContractAtCell({
      focus,
      mapId,
      cell,
      applyContractPages: true,
    });
    if (!result) return;
    await reloadCurrentMap();
    selectedEventId.value = result.eventId;
    renderMap();
    placementFlash.value = { x: cell.x, y: cell.y, until: Date.now() + 1200 };
    renderOverlay();
    window.setTimeout(() => {
      if (placementFlash.value && placementFlash.value.until <= Date.now()) {
        placementFlash.value = null;
        renderOverlay();
      }
    }, 1250);
    patchPlacementEvent(focus.contractId, {
      status: 'placed',
      targetMapId: mapId,
      placedEventId: result.eventId,
      x: cell.x,
      y: cell.y,
    });
    await refreshPlacementQueueFromRegistry();
    const suffix = result.usedContractPatch ? '（已应用契约指令）' : result.shellOnly ? '（空壳，待 agent 补写指令）' : '（已预填骨架）';
    ElMessage.success(`已放置 ${focus.eventName} @ (${cell.x}, ${cell.y})${suffix}`);
    setStatus('放置完成，可继续选择其他事件', 'saved');
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('请先选择 RPG Maker MV 项目')) {
      ElMessage.warning(message);
      return;
    }
    ElMessage.error(message.startsWith('无法放置') || message.startsWith('放置失败') ? message : `放置失败：${message}`);
  } finally {
    busy.value = false;
  }
}

async function refreshPlacementQueueFromRegistry() {
  try {
    await eventPlacementAsk.refreshFromRegistry(projectStore.currentProject);
  } catch (error) {
    console.error('[event-placement] registry refresh failed', error);
    ElMessage.error(`事件放置列表刷新失败：${(error as Error).message}`);
  }
}

function goBackToChatPlacement() {
  router.push('/workbench');
  workbenchUi.setAgentPanelOpen(true);
}

function stopPlacementMode() {
  eventPlacementAsk.stopPlacing();
  setStatus('已取消放置', 'saved');
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children || [])]);
}
function persistWorkspaceSelection() {
  if (selectedMapId.value == null) return;
  writeEditorWorkspaceSelection(projectStore.currentProject, {
    mapId: selectedMapId.value,
    mode: mode.value,
    zoom: readEditorZoom(zoom.value),
    expandedMapIds: expandedMapIds.value,
    tileTab: tileTab.value,
  });
}

function ancestorMapIdsFor(nodes: TreeNode[], mapId: number): number[] {
  const visit = (list: TreeNode[], path: number[]): number[] | null => {
    for (const node of list) {
      if (node.id === mapId) return path;
      if (node.children?.length) {
        const found = visit(node.children, [...path, node.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(nodes, []) ?? [];
}

function ensureTreeExpandedForSelection() {
  if (expandedMapIds.value.length || selectedMapId.value == null) return;
  expandedMapIds.value = ancestorMapIdsFor(mapTree.value, selectedMapId.value);
  persistWorkspaceSelection();
}

function onTreeNodeExpand(node: TreeNode) {
  if (expandedMapIds.value.includes(node.id)) return;
  expandedMapIds.value = [...expandedMapIds.value, node.id];
  persistWorkspaceSelection();
}

function onTreeNodeCollapse(node: TreeNode) {
  const next = expandedMapIds.value.filter((id) => id !== node.id);
  if (next.length === expandedMapIds.value.length) return;
  expandedMapIds.value = next;
  persistWorkspaceSelection();
}
async function loadEditorCatalog() {
  try {
    const catalog = await projectAssets.editorCatalog(projectStore.currentProject);
    editorCatalog.value = catalog;
    characterAssetUrls.clear();
    for (const asset of catalog.assets.characters) characterAssetUrls.set(asset.name, asset.url);
  } catch (error) {
    ElMessage.warning(`事件资源列表加载失败：${(error as Error).message}`);
  }
}
async function loadMap(mapId: number, options: { quiet?: boolean } = {}) {
  busy.value = true;
  setStatus('加载地图…', 'busy');
  try {
    const payload = await mapsApi.get(mapId, projectStore.currentProject);
    const nextMap = payloadToMap(payload.map);
    const names = payload.tileset?.tilesetNames || [];
    const images = await preloadTileset(payload.tileset?.imageUrls || []);
    selectedMapId.value = mapId;
    currentMap = nextMap;
    selectedEventId.value = null;
    systemData.value = payload.system || null;
    currentMapName.value = String(payload.info.name || '');
    tilesetFlags.value = Array.isArray(payload.tileset?.flags) ? payload.tileset.flags : [];
    setPropertiesFromMap(currentMapName.value, nextMap, Number(payload.info.parentId || 0));
    stagingDirty.value = isStagingDirty(payload.staging);
    await setMap(nextMap, names, images, true);
    currentTilesetImages.value = images;
    await preloadEventCharacters(nextMap);
    renderMap();
    await refreshStagingStatus();
    persistWorkspaceSelection();
    setStatus('已加载', 'saved');
    return true;
  } catch (error) {
    setStatus(`加载失败：${(error as Error).message}`, 'error');
    if (!options.quiet) ElMessage.error(`加载地图失败：${(error as Error).message}`);
    return false;
  } finally { busy.value = false; }
}
async function reloadCurrentMap() {
  if (selectedMapId.value == null) return;
  const payload = await mapsApi.get(selectedMapId.value, projectStore.currentProject);
  currentMap = payloadToMap(payload.map);
  systemData.value = payload.system || null;
  stagingDirty.value = isStagingDirty(payload.staging);
  replaceMap(currentMap);
  await preloadEventCharacters(currentMap);
  renderMap();
  await refreshStagingStatus();
}
function payloadToMap(payload: { width: number; height: number; tilesetId: number; data: number[]; events: unknown[]; [key: string]: unknown }): EditableMap {
  return { ...payload, width: payload.width, height: payload.height, tilesetId: payload.tilesetId, data: payload.data, events: payload.events as (MvEvent | null)[] };
}
async function preloadTileset(urls: (string | null)[]) {
  const resolved = await Promise.all(urls.map((url) => url ? resolveAssetUrl(url) : Promise.resolve(null)));
  return Promise.all(resolved.map((url) => url ? loadImage(url) : Promise.resolve(null)));
}
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
async function preloadEventCharacters(map: MvMap) {
  const names = new Set<string>();
  for (const event of map.events || []) for (const page of event?.pages || []) if (page.image?.characterName) names.add(page.image.characterName);
  await Promise.all([...names].map(loadCharacterImage));
}
async function loadCharacterImage(name: string) {
  if (!name || characterImages.has(name)) return characterImages.get(name) || null;
  const url = characterAssetUrls.get(name);
  if (!url) {
    characterImages.set(name, null);
    return null;
  }
  const image = await loadImage(await resolveAssetUrl(url));
  characterImages.set(name, image);
  return image;
}
function isStagingDirty(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const staging = value as Record<string, unknown>;
  return Boolean(staging.staged || staging.dirty || staging.hasChanges || staging.updatedAt);
}
async function refreshStagingStatus() {
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject) as { staged?: boolean; maps?: number[] };
    stagedMapIds.value = new Set((status.maps || []).filter(Number.isFinite));
    stagingDirty.value = Boolean(status.staged) || stagedMapIds.value.size > 0;
  } catch { /* staging status does not block the editor */ }
}

function defaultAudio(name = ''): RmmvAudioSettings {
  return { name, volume: 90, pitch: 100, pan: 0 };
}
function normalizeAudioForm(value: unknown): RmmvAudioSettings {
  const source = value && typeof value === 'object' ? value as Partial<RmmvAudioSettings> : {};
  return {
    name: String(source.name || ''),
    volume: Number(source.volume ?? 90),
    pitch: Number(source.pitch ?? 100),
    pan: Number(source.pan ?? 0),
  };
}
function defaultMapPropertiesForm(): MapPropertiesForm {
  return {
    name: '',
    displayName: '',
    width: 17,
    height: 13,
    tilesetId: 1,
    parentId: 0,
    scrollType: 0,
    specifyBattleback: false,
    battleback1Name: '',
    battleback2Name: '',
    autoplayBgm: false,
    bgm: defaultAudio(),
    autoplayBgs: false,
    bgs: defaultAudio(),
    disableDashing: false,
    parallaxName: '',
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxSx: 0,
    parallaxSy: 0,
    parallaxShow: false,
    encounterStep: 30,
    encounterListText: '[]',
    note: '',
  };
}
function setPropertiesFromMap(name: string, map: Partial<EditableMap>, parentId: number) {
  Object.assign(properties, {
    ...defaultMapPropertiesForm(),
    name,
    displayName: String(map.displayName || ''),
    width: Number(map.width || 17),
    height: Number(map.height || 13),
    tilesetId: Number(map.tilesetId || 1),
    parentId,
    scrollType: Number(map.scrollType || 0),
    specifyBattleback: Boolean(map.specifyBattleback),
    battleback1Name: String(map.battleback1Name || ''),
    battleback2Name: String(map.battleback2Name || ''),
    autoplayBgm: Boolean(map.autoplayBgm),
    bgm: normalizeAudioForm(map.bgm),
    autoplayBgs: Boolean(map.autoplayBgs),
    bgs: normalizeAudioForm(map.bgs),
    disableDashing: Boolean(map.disableDashing),
    parallaxName: String(map.parallaxName || ''),
    parallaxLoopX: Boolean(map.parallaxLoopX),
    parallaxLoopY: Boolean(map.parallaxLoopY),
    parallaxSx: Number(map.parallaxSx || 0),
    parallaxSy: Number(map.parallaxSy || 0),
    parallaxShow: Boolean(map.parallaxShow),
    encounterStep: Number(map.encounterStep || 30),
    encounterListText: JSON.stringify(Array.isArray(map.encounterList) ? map.encounterList : [], null, 2),
    note: String(map.note || ''),
  });
}
function mapPropertiesPayload(): Record<string, unknown> {
  let encounterList: RmmvMapEncounter[] = [];
  try {
    const parsed = properties.encounterListText.trim() ? JSON.parse(properties.encounterListText) : [];
    if (!Array.isArray(parsed)) throw new Error('encounterList must be an array');
    encounterList = parsed as RmmvMapEncounter[];
  } catch (error) {
    throw new Error(`遭遇列表 JSON 无效：${(error as Error).message}`);
  }
  return {
    name: properties.name,
    displayName: properties.displayName,
    width: properties.width,
    height: properties.height,
    tilesetId: properties.tilesetId,
    parentId: properties.parentId,
    scrollType: properties.scrollType,
    specifyBattleback: properties.specifyBattleback,
    battleback1Name: properties.battleback1Name,
    battleback2Name: properties.battleback2Name,
    autoplayBgm: properties.autoplayBgm,
    bgm: { ...properties.bgm },
    autoplayBgs: properties.autoplayBgs,
    bgs: { ...properties.bgs },
    disableDashing: properties.disableDashing,
    parallaxName: properties.parallaxName,
    parallaxLoopX: properties.parallaxLoopX,
    parallaxLoopY: properties.parallaxLoopY,
    parallaxSx: properties.parallaxSx,
    parallaxSy: properties.parallaxSy,
    parallaxShow: properties.parallaxShow,
    encounterList,
    encounterStep: properties.encounterStep,
    note: properties.note,
  };
}
function openCreateProperties(parentId: number) {
  setPropertiesFromMap('新地图', { width: 17, height: 13, tilesetId: tilesets.value[0]?.id || 1, encounterStep: 30 }, parentId);
  propertiesDialogMode.value = 'create';
  propertiesDialogOpen.value = true;
}
function closePropertiesDialog() { propertiesDialogOpen.value = false; }
async function openEditProperties(mapId = selectedMapId.value) {
  if (mapId == null) return;
  if (selectedMapId.value !== mapId) await loadMap(mapId);
  if (currentMap) setPropertiesFromMap(currentMapName.value, currentMap, Number(findTreeNode(mapId)?.parentId || 0));
  propertiesDialogMode.value = 'edit';
  propertiesDialogOpen.value = true;
}
async function saveProperties() {
  busy.value = true;
  try {
    const payload = mapPropertiesPayload();
    if (propertiesDialogMode.value === 'create') {
      const result = await mapsApi.create(payload, projectStore.currentProject) as { mapId: number };
      propertiesDialogOpen.value = false;
      await loadTree();
      if (result.mapId) await loadMap(result.mapId);
      ElMessage.success('已新建地图（暂存）');
    } else if (selectedMapId.value != null) {
      await mapsApi.updateProperties(selectedMapId.value, payload, projectStore.currentProject);
      propertiesDialogOpen.value = false;
      await loadTree();
      await loadMap(selectedMapId.value);
      ElMessage.success('属性已保存（暂存）');
    }
  } catch (error) { ElMessage.error(`保存属性失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}

async function applyStaging() {
  busy.value = true;
  try {
    await mapsApi.applyProjectStaging(projectStore.currentProject);
    if (selectedMapId.value != null) await reloadCurrentMap();
    await refreshStagingStatus();
    ElMessage.success('暂存已应用到工程');
  } catch (error) {
    const err = error as ApiError;
    ElMessage.error(err.status === 409 ? '应用失败：暂存与工程文件存在冲突，请先处理冲突。' : `应用失败：${err.message}`);
  } finally { busy.value = false; }
}
async function discardStaging() {
  busy.value = true;
  try {
    await mapsApi.discardProjectStaging(projectStore.currentProject);
    if (selectedMapId.value != null && !await loadMap(selectedMapId.value, { quiet: true })) {
      clearCurrentMap();
      await loadTree();
      await openPreferredMap();
    }
    await refreshStagingStatus();
    ElMessage.success('暂存已丢弃');
  } catch (error) { ElMessage.error(`丢弃失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function applyOneMap(mapId: number) {
  busy.value = true;
  try {
    await mapsApi.applyMapStaging(mapId, projectStore.currentProject);
    if (selectedMapId.value === mapId) await reloadCurrentMap();
    await loadTree();
    ElMessage.success(`已应用 MAP ${mapId} 到工程`);
  } catch (error) { ElMessage.error(`应用失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function discardOneMap(mapId: number) {
  try { await ElMessageBox.confirm(`确定丢弃 MAP ${mapId} 的暂存改动？`, '丢弃暂存', { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await mapsApi.discardMapStaging(mapId, projectStore.currentProject);
    if (selectedMapId.value === mapId && !await loadMap(mapId, { quiet: true })) {
      clearCurrentMap();
      await loadTree();
      await openPreferredMap();
    }
    await loadTree();
    ElMessage.success(`已丢弃 MAP ${mapId} 暂存`);
  } catch (error) { ElMessage.error(`丢弃失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}

function onTreeContextMenu(event: MouseEvent, node: TreeNode) { event.preventDefault(); Object.assign(treeContext, { visible: true, x: event.clientX, y: event.clientY, mapId: node.id }); }
function closeTreeContext() { treeContext.visible = false; }
async function ctxEditProperties() { const id = treeContext.mapId; closeTreeContext(); await openEditProperties(id); }
function ctxNewMapUnder() { const id = treeContext.mapId; closeTreeContext(); openCreateProperties(id); }
function ctxCopyMap() { mapClipboard.value = treeContext.mapId; setStatus(`已复制 MAP ${treeContext.mapId}`, 'saved'); closeTreeContext(); }
async function ctxPasteMap() {
  if (mapClipboard.value == null) return;
  const parentId = treeContext.mapId;
  closeTreeContext();
  busy.value = true;
  try {
    const result = await mapsApi.duplicate(mapClipboard.value, parentId, projectStore.currentProject) as { mapId: number };
    await loadTree();
    if (result.mapId) await loadMap(result.mapId);
    ElMessage.success(`已粘贴为 MAP ${result.mapId}（暂存）`);
  } catch (error) { ElMessage.error(`粘贴失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function ctxDeleteMap() {
  const mapId = treeContext.mapId;
  closeTreeContext();
  try { await ElMessageBox.confirm(`删除 MAP ${mapId}？应用暂存后才会写入工程。`, '删除地图', { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await mapsApi.remove(mapId, projectStore.currentProject);
    if (selectedMapId.value === mapId) {
      clearCurrentMap();
    }
    await loadTree();
    if (selectedMapId.value == null) await openPreferredMap();
    ElMessage.success(`已删除 MAP ${mapId}（暂存）`);
  } catch (error) { ElMessage.error(`删除失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function ctxApplyMap() { const id = treeContext.mapId; closeTreeContext(); await applyOneMap(id); }
async function ctxDiscardMap() { const id = treeContext.mapId; closeTreeContext(); await discardOneMap(id); }

function onCanvasContextMenu(event: MouseEvent) {
  if (mode.value !== 'event') return;
  const cell = canvasCell(event);
  if (!cell) return;
  Object.assign(canvasContext, { visible: true, x: event.clientX, y: event.clientY, cellX: cell.x, cellY: cell.y, eventId: eventAtCell(cell.x, cell.y)?.id ?? null });
}
function closeCanvasContext() { canvasContext.visible = false; quickCreateHover.value = false; }
function ctxNewEvent() { openNewEventAt(canvasContext.cellX, canvasContext.cellY); closeCanvasContext(); }
function ctxEditEvent() { if (canvasContext.eventId != null) openEventEditor(canvasContext.eventId); closeCanvasContext(); }
function ctxCopyEvent() { if (canvasContext.eventId != null) copyEvent(canvasContext.eventId); closeCanvasContext(); }
async function ctxCutEvent() { if (canvasContext.eventId != null) await cutEvent(canvasContext.eventId); closeCanvasContext(); }
async function ctxPasteEvent() { await pasteEvent(canvasContext.cellX, canvasContext.cellY); closeCanvasContext(); }
async function ctxDeleteEvent() { if (canvasContext.eventId != null) await deleteEvent(canvasContext.eventId); closeCanvasContext(); }
const systemPositionLabels: Record<RmmvSystemPositionTarget, string> = {
  player: '玩家初始位置',
  boat: '小船位置',
  ship: '大船位置',
  airship: '飞艇位置',
};

async function ctxSetSystemPosition(target: RmmvSystemPositionTarget) {
  if (selectedMapId.value == null) return;
  const mapId = selectedMapId.value;
  const x = canvasContext.cellX;
  const y = canvasContext.cellY;
  closeCanvasContext();
  busy.value = true;
  try {
    await mapsApi.setSystemPosition(target, mapId, x, y, projectStore.currentProject);
    await refreshStagingStatus();
    setStatus(`${systemPositionLabels[target]}已设为 MAP ${mapId} (${x}, ${y})`, 'saved');
    ElMessage.success(`${systemPositionLabels[target]}已保存到暂存`);
  } catch (error) {
    ElMessage.error(`设置${systemPositionLabels[target]}失败：${(error as Error).message}`);
  } finally {
    busy.value = false;
  }
}
function quickCreate(type: QuickEventType) {
  if (canvasContext.eventId != null) return;
  eventOverview.value = null;
  eventDraft.value = quickEventTemplate(type, canvasContext.cellX, canvasContext.cellY);
  eventDialogOpen.value = true;
  closeCanvasContext();
}

function getUiControlState(): EditorUiControlState {
  return {
    mounted: true,
    mapId: selectedMapId.value,
    eventId: selectedEventId.value,
    eventDialogOpen: eventDialogOpen.value,
    mode: mode.value,
    statusText: statusText.value,
    statusKind: statusKind.value,
  };
}

async function openEventEditorByUiControl(mapId: number, eventId: number): Promise<EditorUiControlState> {
  if (!projectStore.currentProject) throw new Error('当前没有接入 RPG Maker MV 项目。');
  if (selectedMapId.value !== mapId) {
    const loaded = await loadMap(mapId, { quiet: true });
    if (!loaded) throw new Error(`地图不存在或无法加载：MAP ${mapId}`);
  }
  await openEventEditorStrict(eventId);
  return getUiControlState();
}

function selectEvent(eventId: number | null) { selectedEventId.value = eventId == null || selectedEventId.value === eventId ? null : eventId; renderMap(); }
function openNewEventAt(x: number, y: number) { eventOverview.value = null; eventDraft.value = defaultEvent(0, x, y); eventDialogOpen.value = true; }
async function openEventEditorStrict(eventId: number) {
  const event = currentMap?.events?.find((item) => item?.id === eventId) as MvEditorEvent | undefined;
  if (!event) throw new Error(`事件不存在：${eventId}`);
  if (selectedMapId.value != null) {
    try {
      eventOverview.value = await storyPages.inspectEvent(selectedMapId.value, eventId, projectStore.currentProject);
    } catch (error) {
      eventOverview.value = null;
      throw new Error(`读取事件权限失败：${(error as Error).message}`);
    }
  }
  selectedEventId.value = eventId;
  eventDraft.value = clone(event);
  eventDialogOpen.value = true;
  renderMap();
}
async function openEventEditor(eventId: number) {
  try {
    await openEventEditorStrict(eventId);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
function closeEventEditor() { eventDialogOpen.value = false; eventDraft.value = null; eventOverview.value = null; }
async function saveEvent(closeAfterSave = true) {
  if (!eventDraft.value || selectedMapId.value == null) return;
  eventSaving.value = true;
  try {
    const event = clone(eventDraft.value);
    if (event.id) await eventsApi.update(selectedMapId.value, event.id, event as unknown as Record<string, unknown>, projectStore.currentProject);
    else await eventsApi.create(selectedMapId.value, event as unknown as Record<string, unknown>, projectStore.currentProject);
    await reloadCurrentMap();
    if (closeAfterSave) closeEventEditor();
    else eventDialogRef.value?.markSaved();
    ElMessage.success(event.id ? '事件已保存' : '事件已创建');
  } catch (error) { ElMessage.error(`保存失败：${(error as Error).message}`); }
  finally { eventSaving.value = false; }
}
function copyEvent(eventId: number) {
  const event = currentMap?.events?.find((item) => item?.id === eventId);
  if (!event) return;
  eventClipboard.value = { eventId, data: clone(event as MvEditorEvent) };
  setStatus(`已复制事件 ${eventId}`, 'saved');
}
async function cutEvent(eventId: number) {
  if (selectedMapId.value == null) return;
  copyEvent(eventId);
  busy.value = true;
  try {
    await eventsApi.remove(selectedMapId.value, eventId, projectStore.currentProject);
    await reloadCurrentMap();
    selectedEventId.value = null;
    setStatus(`已剪切事件 ${eventId}`, 'saved');
  } catch (error) { ElMessage.error(`剪切失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function pasteEvent(x?: number, y?: number) {
  if (!eventClipboard.value || selectedMapId.value == null) return;
  const event = { ...clone(eventClipboard.value.data), id: 0, ...(x == null ? {} : { x }), ...(y == null ? {} : { y }) };
  busy.value = true;
  try {
    await eventsApi.create(selectedMapId.value, event as unknown as Record<string, unknown>, projectStore.currentProject);
    await reloadCurrentMap();
    ElMessage.success('事件已粘贴');
  } catch (error) { ElMessage.error(`粘贴失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function deleteEvent(eventId: number) {
  if (selectedMapId.value == null) return;
  try { await ElMessageBox.confirm('确定删除这个事件？', '删除事件', { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await eventsApi.remove(selectedMapId.value, eventId, projectStore.currentProject);
    await reloadCurrentMap();
    selectedEventId.value = null;
    ElMessage.success('事件已删除');
  } catch (error) { ElMessage.error(`删除失败：${(error as Error).message}`); }
  finally { busy.value = false; }
}
async function moveEvent(eventId: number, x: number, y: number) {
  if (mode.value !== 'event' || selectedMapId.value == null) return;
  busy.value = true;
  try {
    await eventsApi.update(selectedMapId.value, eventId, { x, y }, projectStore.currentProject);
    await reloadCurrentMap();
    setStatus(`事件 ${eventId} 已移动到 (${x}, ${y})`, 'saved');
  } catch (error) {
    await reloadCurrentMap();
    ElMessage.error(`移动事件失败：${(error as Error).message}`);
    throw error;
  } finally { busy.value = false; }
}

function onEditorCommand(event: CustomEvent<{ command?: 'undo' | 'redo' | 'save' }>) {
  const command = event.detail?.command;
  if (command === 'undo') void runEditorUndo();
  else if (command === 'redo') void runEditorRedo();
  else if (command === 'save') void saveCurrentEditorWork();
}
async function runEditorUndo() {
  if (mode.value !== 'map') return ElMessage.info('撤销当前只支持地图图块编辑');
  if (!undoLen.value) return ElMessage.info('没有可撤销操作');
  await undo();
}
async function runEditorRedo() {
  if (mode.value !== 'map') return ElMessage.info('重做当前只支持地图图块编辑');
  if (!redoLen.value) return ElMessage.info('没有可重做操作');
  await redo();
}
async function saveCurrentEditorWork() {
  if (propertiesDialogOpen.value) {
    await saveProperties();
    return;
  }
  if (eventDialogOpen.value) {
    await saveEvent(false);
    return;
  }
  if (selectedMapId.value == null) {
    ElMessage.info('当前没有可保存的编辑内容');
    return;
  }
  await refreshStagingStatus();
  setStatus(stagingDirty.value ? '当前编辑已保存到暂存' : '没有待保存编辑', stagingDirty.value ? 'saved' : '');
  ElMessage.info(stagingDirty.value ? '当前编辑已保存到暂存' : '没有待保存编辑');
}

function onEditorKeyDown(event: KeyboardEvent) {
  if (isFormTarget(event.target) || eventDialogOpen.value || selectedMapId.value == null) return;
  // Ctrl+Z 优先撤回上一次拒绝（仅在有待撤回的拒绝且处于放置批次时），单次生效后让位给图块撤销。
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
    && placementSession.value && rejectUndoStack.value.length) {
    event.preventDefault();
    void undoLastReject();
    return;
  }
  if (placementActive.value) {
    if (event.key === 'Escape') {
      event.preventDefault();
      stopPlacementMode();
      return;
    }
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if (mode.value === 'map') {
    if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); void (event.shiftKey ? redo() : undo()); }
    else if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); void redo(); }
    return;
  }
  if (event.key === 'Delete' && selectedEventId.value != null) { event.preventDefault(); void deleteEvent(selectedEventId.value); }
  else if (event.key === 'Enter' && selectedEventId.value != null) { event.preventDefault(); openEventEditor(selectedEventId.value); }
  else if (ctrl && event.key.toLowerCase() === 'c' && selectedEventId.value != null) { event.preventDefault(); copyEvent(selectedEventId.value); }
  else if (ctrl && event.key.toLowerCase() === 'x' && selectedEventId.value != null) { event.preventDefault(); void cutEvent(selectedEventId.value); }
  else if (ctrl && event.key.toLowerCase() === 'v' && eventClipboard.value) { event.preventDefault(); void pasteEvent(); }
}
function isFormTarget(target: EventTarget | null) { return ['INPUT', 'TEXTAREA', 'SELECT'].includes((target as HTMLElement | null)?.tagName || ''); }
function setStatus(text: string, kind: EditorStatusKind) { statusText.value = text; statusKind.value = kind; }
function clearCurrentMap() {
  selectedMapId.value = null;
  currentMap = null;
  currentMapName.value = '';
  currentTilesetImages.value = [];
  clearMap();
}
</script>

<style scoped>
.editor-view { width:100%;min-width:0;height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--app-bg-page); }
.editor-body { min-height: 0; display: flex; flex: 1; overflow: hidden; gap:10px; }
.center-col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.editor-stage { position:relative; min-width: 380px; min-height: 0; display: flex; flex-direction: column; flex: 1; overflow: hidden; border-radius:12px; background-color:var(--app-bg-sunken); background-image:linear-gradient(rgba(120,110,90,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(120,110,90,.05) 1px,transparent 1px);background-size:24px 24px;box-shadow:inset 0 1px 3px rgba(60,50,30,.08); }
.empty-state { width: 100%; display: flex; align-items: center; justify-content: center; }
.empty-actions { display: flex; justify-content: center; gap: 8px; }
.canvas-scroll { flex: 1; overflow: auto; padding: 18px; }
.canvas-scroll.panning { cursor: grabbing; user-select: none; }
.canvas-stack { position: relative; margin:auto; border-radius:6px; box-shadow:0 10px 36px rgba(60,50,30,.22); overflow:hidden; }
.map-canvas, .overlay-canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.map-canvas { background: #203b20; cursor: crosshair; }
.overlay-canvas { pointer-events: none; }
.canvas-zoom{position:absolute;left:14px;bottom:14px;z-index:3;display:flex;gap:2px;padding:3px;border-radius:var(--app-radius-md);background:var(--app-bg-elevated);box-shadow:var(--app-shadow-2)}.canvas-zoom button{height:26px;min-width:28px;padding:0 7px;border:0;border-radius:var(--app-radius-sm);background:transparent;color:var(--app-ink-soft);font:600 11px var(--app-font-mono);cursor:pointer}.canvas-zoom button:hover{background:var(--app-bg-soft);color:var(--app-ink)}.canvas-mode-chip{position:absolute;right:14px;top:14px;z-index:3;padding:5px 9px;border-radius:var(--app-radius-pill);background:rgba(255,255,255,.78);backdrop-filter:blur(8px);box-shadow:var(--app-shadow-1);color:var(--app-ink-soft);font-size:11px;font-weight:600}
.ctx-mask { position: fixed; inset: 0; z-index: v-bind(contextMenuZ); }
.ctx-menu { position: fixed; min-width: 184px; margin: 0; padding: 4px 0; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--el-bg-color-overlay); box-shadow: var(--app-shadow-overlay); color: var(--app-ink); font-size: 13px; list-style: none; }
.ctx-menu li { padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.ctx-menu li:hover { background: var(--app-bg-sunken); }
.ctx-menu li.disabled { color: var(--app-ink-muted); pointer-events: none; opacity: .58; }
.ctx-menu li.ctx-danger { color: var(--el-color-danger); }
.ctx-menu li.ctx-sep { height: 0; margin: 4px 0; padding: 0; border-top: 1px solid var(--app-border); }
.ctx-shortcut { float: right; margin-left: 28px; color: var(--app-ink-muted); font-size: 12px; }
.ctx-arrow { float: right; margin-left: 16px; color: var(--app-ink-muted); }
.ctx-has-sub { position: relative; }
.ctx-submenu { position: absolute; top: -4px; left: 100%; min-width: 126px; margin: 0; padding: 4px 0; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--el-bg-color-overlay); box-shadow: var(--app-shadow-overlay); list-style: none; }
@media (max-width: 820px) { .canvas-scroll { padding: 10px; } }
</style>
