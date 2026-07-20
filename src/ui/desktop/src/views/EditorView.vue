<template>
  <div class="editor-view">
    <EditorToolbar
      v-model:mode="mode"
      :tool="tool"
      :paint-mode="paintMode"
      v-model:layer="layer"
      v-model:show-regions="showRegions"
      v-model:show-tile-flags="showTileFlags"
      :tile-flags-available="tileFlagsAvailable"
      :supports-layer-selection="Boolean(editorCatalog)"
      :zoom="zoom"
      :undo-len="undoLen"
      :redo-len="redoLen"
      :busy="busy"
      :staging-dirty="stagingDirty && mode !== 'preview'"
      :preview-refresh-enabled="previewRefreshEnabled"
      @select-tool="selectMapTool"
      @select-tile="selectTileMode"
      @select-shadow="selectShadowMode"
      @undo="undo"
      @redo="redo"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
      @apply="applyStaging"
      @discard="discardStaging"
      @refresh-preview="refreshPreview"
    />

    <div class="editor-body" :style="editorBodyStyle">
      <LeftDock
        :mode="mode"
        :tile-tabs="tileTabs"
        :tile-tab="tileTab"
        :tileset-ready="tilesetReady"
        :brush-info="brushInfo"
        :brush-set="brushSet"
        :map-tree="mapTree"
        :selected-map-id="requestedMapId ?? selectedMapId"
        :staged-map-ids="stagedMapIds"
        :expanded-map-ids="expandedMapIds"
        :current-events="currentEvents"
        :selected-event-id="selectedEventId"
        :event-search-query="eventSearchQuery"
        :event-search-hits="eventSearchHits"
        :event-search-loading="eventSearchLoading"
        :event-search-truncated="eventSearchTruncated"
        :event-search-all-maps="eventSearchScope === 'all'"
        @palette-ready="setPaletteCanvas"
        @palette-mousedown="onPaletteMouseDown"
        @palette-mousemove="onPaletteMouseMove"
        @palette-mouseup="onPaletteMouseUp"
        @palette-mouseleave="onPaletteMouseLeave"
        @select-tile-tab="selectTileTab"
        @node-click="handleNodeClick"
        @node-expand="onTreeNodeExpand"
        @node-collapse="onTreeNodeCollapse"
        @node-contextmenu="onTreeContextMenu"
        @node-drop="moveMapFromTree"
        @update:event-search-query="eventSearchQuery = $event"
        @search-all-maps="searchAllMaps"
        @select-event="selectEvent"
        @hover-event="hoveredEventId = $event"
        @open-event="openEventEditor"
        @open-search-hit="openEventSearchHit"
      />

      <div class="center-col">
        <main class="editor-stage" :class="{ 'preview-stage': mode === 'preview' }">
          <MapRuntimePreview
            v-show="mode === 'preview'"
            :key="previewSession?.sessionId || 'pending'"
            :status="previewStatus"
            :frame="visiblePreviewFrame"
            :tile-frame="previewTileFrame"
            :error="previewError"
            :diagnostic="previewDiagnostic"
            :refreshing="previewRefreshActive"
            @retry="restartPreview"
            @copy-diagnostic="copyPreviewDiagnostic"
            @presented="ackPreviewFrame"
            @presentation-failed="failPreviewPresentation"
            @view-changed="updatePreviewView"
          />
          <div v-show="mode !== 'preview'" class="editor-canvas-layer">
          <div v-if="selectedMapId == null" class="empty-state">
            <el-empty :description="mapTree.length ? t('editor.error.noLoadableMaps') : t('editor.view.noMapsDescription')">
              <div class="empty-actions">
                <el-button type="primary" @click="openCreateProperties(0)">{{ t('editor.view.createMap') }}</el-button>
              </div>
            </el-empty>
          </div>
          <div
            v-else
            :ref="setScrollElement"
            class="canvas-scroll"
            :class="{ panning: isPanning }"
            @wheel="onCanvasWheel"
            @scroll="onCanvasScroll"
          >
            <div class="canvas-stack" :style="{ width: `${canvasWidth * zoom}px`, height: `${canvasHeight * zoom}px` }">
              <canvas
                :ref="setCanvasElement"
                data-ui-id="map-canvas"
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
            <canvas :ref="setRegionLabelElement" class="region-label-canvas" aria-hidden="true" />
          </div>
            <div v-if="selectedMapId != null" class="canvas-zoom">
              <button type="button" :title="t('editor.view.zoomOut')" @click="zoomOut">−</button>
              <button type="button" :title="t('editor.view.resetZoom')" @click="resetZoom">{{ Math.round(zoom * 100) }}%</button>
              <button type="button" :title="t('editor.view.zoomIn')" @click="zoomIn">+</button>
            </div>
            <span v-if="selectedMapId != null" class="canvas-mode-chip">{{ mode === 'map' ? mapPaintModeLabel : t('editor.view.eventMode') }}</span>
          </div>
        </main>

        <BottomPanel
          v-if="mode !== 'preview'"
          :mode="mode"
          :catalog="editorCatalog"
          :current-map-id="selectedMapId"
          @select="onPlacementSelect"
          @place="onPlacementPlace"
          @reject="onPlacementReject"
          @back-chat="goBackToChatPlacement"
        />
      </div>
      <MapPreviewInspector
        v-if="mode === 'preview'"
        :switches="previewSwitches"
        :variables="previewVariables"
        :switch-overrides="previewSwitchOverrides"
        :variable-overrides="previewVariableOverrides"
        :switch-values="previewSwitchValues"
        :variable-values="previewVariableValues"
        @set-switch="setPreviewSwitch"
        @set-variable="setPreviewVariable"
        @reset="resetPreviewOverrides"
      />
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
      :current-events="currentEvents"
      @close="closeEventEditor"
      @save="saveEvent"
    />
    <QuickObtainEventDialog ref="quickObtainDialog" :catalog="editorCatalog" @commit="createObtainEvent" />

    <teleport to="body">
      <div v-if="mode !== 'preview' && treeContext.visible" class="ctx-mask" @mousedown.self="closeTreeContext" @contextmenu.prevent="closeTreeContext">
        <ul class="ctx-menu" :style="{ left: `${treeContext.x}px`, top: `${treeContext.y}px` }">
          <li @click="ctxEditProperties">{{ t('editor.ctx.editProperties') }}</li>
          <li @click="ctxNewMapUnder">{{ t('editor.ctx.newMapUnder') }}</li>
          <li class="ctx-sep" />
          <li :class="{ disabled: !stagedMapIds.has(treeContext.mapId) }" @click="ctxApplyMap">{{ t('editor.ctx.applyMapStaging') }}</li>
          <li :class="{ disabled: !stagedMapIds.has(treeContext.mapId) }" @click="ctxDiscardMap">{{ t('editor.ctx.discardMapStaging') }}</li>
          <li class="ctx-sep" />
          <li @click="ctxCopyMap">{{ t('editor.ctx.copy') }}</li>
          <li :class="{ disabled: mapClipboard == null }" @click="ctxPasteMap">{{ t('editor.ctx.paste') }}</li>
          <li class="ctx-danger" @click="ctxDeleteMap">{{ t('editor.ctx.delete') }}</li>
        </ul>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="mode !== 'preview' && canvasContext.visible" class="ctx-mask" @mousedown.self="closeCanvasContext" @contextmenu.prevent="closeCanvasContext">
        <ul class="ctx-menu canvas-menu" :style="{ left: `${canvasContext.x}px`, top: `${canvasContext.y}px` }">
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxEditEvent">{{ t('editor.ctx.edit') }}<span class="ctx-shortcut">Enter</span></li>
          <li :class="{ disabled: canvasContext.eventId != null }" @click="ctxNewEvent">{{ t('editor.ctx.new') }}</li>
          <li class="ctx-sep" />
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxCutEvent">{{ t('editor.ctx.cut') }}<span class="ctx-shortcut">Ctrl+X</span></li>
          <li :class="{ disabled: canvasContext.eventId == null }" @click="ctxCopyEvent">{{ t('editor.ctx.copy') }}<span class="ctx-shortcut">Ctrl+C</span></li>
          <li :class="{ disabled: !eventClipboard || canvasContext.eventId != null }" @click="ctxPasteEvent">{{ t('editor.ctx.paste') }}<span class="ctx-shortcut">Ctrl+V</span></li>
          <li :class="{ disabled: canvasContext.eventId == null }" class="ctx-danger" @click="ctxDeleteEvent">{{ t('editor.ctx.delete') }}<span class="ctx-shortcut">Del</span></li>
          <li class="ctx-sep" />
          <li class="ctx-has-sub" :class="{ disabled: canvasContext.eventId != null }" @mouseenter="quickCreateHover = true" @mouseleave="quickCreateHover = false">
            {{ t('editor.ctx.quickCreateEvent') }}<span class="ctx-arrow">▶</span>
            <ul v-show="quickCreateHover" class="ctx-submenu">
              <li @click="quickCreate('transfer')">{{ t('editor.ctx.transfer') }}</li>
              <li @click="quickCreate('door')">{{ t('editor.ctx.door') }}</li>
              <li @click="quickCreate('treasure')">{{ t('editor.ctx.treasure') }}</li>
              <li @click="quickCreate('inn')">{{ t('editor.ctx.inn') }}</li>
              <li v-if="editorCatalog?.engine === 'rpg-maker-mz'" @click="openQuickObtain">{{ t('editor.ctx.obtain') }}</li>
            </ul>
          </li>
          <li class="ctx-sep" />
          <li @click="ctxSetSystemPosition('player')">{{ t('editor.ctx.setPlayerStart') }}</li>
          <li @click="ctxSetSystemPosition('boat')">{{ t('editor.ctx.setBoat') }}</li>
          <li @click="ctxSetSystemPosition('ship')">{{ t('editor.ctx.setShip') }}</li>
          <li @click="ctxSetSystemPosition('airship')">{{ t('editor.ctx.setAirship') }}</li>
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
import QuickObtainEventDialog from '../components/editor/QuickObtainEventDialog.vue';
import MapPropertiesDialog from '../components/editor/MapPropertiesDialog.vue';
import BottomPanel from '../components/editor/BottomPanel.vue';
import MapRuntimePreview from '../components/editor/MapRuntimePreview.vue';
import MapPreviewInspector from '../components/editor/MapPreviewInspector.vue';
import type { EditorEventListItem, EditorEventSearchHit, EditorMode, EditorStatusKind, MapLayerSelection, MapPaintMode, MapPropertiesForm, MapTool, TreeNode } from '../components/editor/editorTypes';
import { clipboard as clipboardApi, eventRegistry, events as eventsApi, mapPreview, maps as mapsApi, playtest, projectAssets, resolveAssetUrl, storyPages, type EditorProjectCatalog, type MapPreviewFrame, type MapPreviewOverrides, type MapPreviewSession, type MapPreviewStateEntry, type MapPreviewStatus, type MapPreviewViewRequest, type MapTreeNode, type RmmvAudioSettings, type RmmvMapProperties, type RmmvSystemPositionTarget, type StoryEventOverview, type TilesetSummary } from '../api/client';
import { useMapCanvasEditor, type PlacementFlashCell } from '../composables/useMapCanvasEditor';
import { clone, defaultEvent, quickEventTemplate, quickObtainEventTemplate, type MvEditorEvent, type MvEventImage, type QuickEventType, type QuickObtainKind } from '../composables/useEventEditor';
import {
  EDITOR_DEFAULT_ZOOM,
  readEditorWorkspaceSelection,
  readEditorPreviewOverrides,
  readEditorZoom,
  writeEditorPreviewOverrides,
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
import { parseProjectStagingSummary, type ProjectStagingSummary } from '../utils/projectStaging';
import { loadImageElement } from '../utils/imageLoading.ts';
import { projectMapTreeMove } from '../utils/mapTreeDragPreview';
import { filterMapPreviewOverrides, removeMapPreviewOverrides } from '../utils/mapPreviewOverrides';
import { LatestAsyncCoordinator, type LatestAsyncToken } from '../utils/latestAsyncCoordinator';
import { previewFrameMatchesIntent, previewSessionMatchesIntent, type EditorPreviewIntent } from '../utils/editorPreviewIntent';
import { mapPreviewDiagnosticFromError, mapPreviewDiagnosticFromSession, serializeMapPreviewDiagnostic, type MapPreviewDiagnostic } from '../utils/mapPreviewDiagnostics';
import { useI18n, type MessageKey } from '../i18n';
import type { MapPreviewStateCatalog, RpgMakerEngine } from '@contract/types';

interface ApiError extends Error { status?: number }
type EditableMap = MvMap & Partial<RmmvMapProperties> & Record<string, unknown>;

const route = useRoute();
const router = useRouter();
const eventPlacementAsk = useEventPlacementAskStore();
const workbenchUi = useWorkbenchUiStore();
const projectStore = useProjectStore();
const { language, t } = useI18n();

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
const requestedMapId = ref<number | null>(null);
const mode = ref<EditorMode>('map');
const tool = ref<MapTool>('pencil');
const paintMode = ref<MapPaintMode>('tile');
const regionId = ref(1);
const layer = ref<MapLayerSelection>(0);
const showGrid = ref(false);
const showRegions = ref(false);
const showTileFlags = ref(false);
const busy = ref(false);
const statusText = ref('');
const statusKind = ref<EditorStatusKind>('');
const stagingDirty = ref(false);
const stagedMapIds = ref(new Set<number>());
const selectedEventId = ref<number | null>(null);
const hoveredEventId = ref<number | null>(null);
const currentEvents = ref<EditorEventListItem[]>([]);
const eventSearchQuery = ref('');
const eventSearchScope = ref<'current' | 'all'>('current');
const eventSearchHits = ref<EditorEventSearchHit[]>([]);
const eventSearchLoading = ref(false);
const eventSearchTruncated = ref(false);
const currentMapName = ref('');
const currentTileSize = ref(48);
const currentEngine = ref<RpgMakerEngine>('rpg-maker-mv');
const currentTilesetMode = ref<number | null>(null);
const propertiesDialogOpen = ref(false);
const propertiesDialogMode = ref<'create' | 'edit'>('edit');
const properties = reactive<MapPropertiesForm>(defaultMapPropertiesForm());
const eventDialogOpen = ref(false);
const eventDialogRef = ref<InstanceType<typeof EventEditorDialog>>();
const quickObtainDialog = ref<InstanceType<typeof QuickObtainEventDialog>>();
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
const currentParallaxImage = shallowRef<HTMLImageElement | null>(null);
const currentMapRevision = ref('');
const previewSession = ref<MapPreviewSession | null>(null);
const previewStatus = ref<MapPreviewStatus>('stopped');
const previewError = ref('');
const previewDiagnostic = shallowRef<MapPreviewDiagnostic | null>(null);
const previewFrame = shallowRef<MapPreviewFrame | null>(null);
const previewTileFrame = shallowRef<MapPreviewFrame | null>(null);
const previewFrameRevision = ref('');
const previewFrameOperationId = ref(0);
const previewFrameMapId = ref(0);
const previewFrameSequence = ref(0);
const previewFrameMapWidth = ref(0);
const previewFrameMapHeight = ref(0);
const previewTileFrameSequence = ref(0);
const previewStateCatalog = ref<MapPreviewStateCatalog>({ switches: [], variables: [] });
const previewSwitchOverrides = shallowRef(new Map<number, boolean>());
const previewVariableOverrides = shallowRef(new Map<number, number>());
const previewRequestedMapId = ref<number | null>(null);
const previewRefreshActive = ref(false);

let currentMap: EditableMap | null = null;
let unregisterUiControlHandler: (() => void) | null = null;
let unregisterPreviewStatus: (() => void) | null = null;
let unregisterPreviewFrame: (() => void) | null = null;
let eventSearchTimer: ReturnType<typeof setTimeout> | null = null;
let eventSearchSequence = 0;
const characterImages = new Map<string, HTMLImageElement | null>();
const characterAssetUrls = new Map<string, string>();
type MapLoadResult = 'committed' | 'failed' | 'superseded';
interface MapLoadIntent { project: string; mapId: number }
const mapLoadCoordinator = new LatestAsyncCoordinator<MapLoadIntent>();
const previewIntentCoordinator = new LatestAsyncCoordinator<EditorPreviewIntent>();

function getPlacementCellValidity(x: number, y: number) {
  return validatePlacementCell(currentMap, tilesetFlags.value, x, y, language.value);
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
  setStatus(t('editor.status.direction', { direction: placementDirection.value }), 'busy');
}

const canvasEditor = useMapCanvasEditor({
  tileSize: currentTileSize,
  parallaxImage: currentParallaxImage,
  engine: currentEngine,
  tilesetMode: currentTilesetMode,
  mode,
  tool,
  paintMode,
  regionId,
  layer,
  showGrid,
  showRegions,
  showTileFlags,
  tileFlags: tilesetFlags,
  selectedEventId,
  hoveredEventId,
  busy,
  placementActive,
  placementDirection,
  placementFlash,
  getPlacementPreviewImage,
  getPlacementCellValidity: getPlacementCellValidity,
  onPlacementClick: (cell) => { void runPlacementAt(cell); },
  onPlacementWheel: rotatePlacementDirection,
  postTiles: async (edits) => {
    if (mode.value !== 'map') throw new Error(t('editor.error.eventModeCannotEditTiles'));
    if (selectedMapId.value == null) throw new Error(t('editor.error.noSelectedMap'));
    const result = await mapsApi.postTiles(selectedMapId.value, edits, projectStore.currentProject);
    currentMapRevision.value = result.effectiveMapRevision;
    return result;
  },
  reloadMap: async () => { await reloadCurrentMap(); },
  selectEvent,
  moveEvent,
  openEvent: openEventEditor,
  newEvent: openNewEventAt,
  setStatus,
  language,
  getCharacterImage: (name) => characterImages.get(name) || null,
});
const {
  canvasWidth, canvasHeight, zoom, cursorText, tilesetReady, tileTab, tileTabs,
  brushInfo, brushSet, undoLen, redoLen, isPanning,
  setMap, clearMap, setPaletteCanvas, setCanvasElement, setOverlayElement, setRegionLabelElement, setScrollElement, selectTileTab, selectMapTool, selectTileMode, selectShadowMode, canvasCell, eventAtCell,
  onPaletteMouseDown, onPaletteMouseMove, onPaletteMouseUp, onPaletteMouseLeave,
  onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseLeave, onCanvasDoubleClick, onCanvasWheel, onCanvasScroll,
  renderMap, renderOverlay, zoomIn, zoomOut, resetZoom, setZoom, undo, redo, getPlacementCell,
} = canvasEditor;

const placementStatusHint = computed(() => {
  const cell = getPlacementCell();
  const validity = cell && currentMap
    ? validatePlacementCell(currentMap, tilesetFlags.value, cell.x, cell.y, language.value)
    : { valid: false };
  return placementValidityHint(validity, cell, language.value);
});

const selectedMapLabel = computed(() => selectedMapId.value == null ? t('editor.status.noMapSelected') : `MAP ${String(selectedMapId.value).padStart(3, '0')} · ${currentMapName.value || t('editor.status.unnamedMap')}`);
const propertiesParentLabel = computed(() => properties.parentId ? `MAP ${properties.parentId} · ${findTreeNode(properties.parentId)?.name || t('editor.status.unnamedMap')}` : t('editor.status.rootDirectory'));
const tileFlagsAvailable = computed(() => tilesetFlags.value.some((flag) => Number.isInteger(flag)));
const previewSwitches = computed<MapPreviewStateEntry[]>(() => previewStateCatalog.value.switches);
const previewVariables = computed<MapPreviewStateEntry[]>(() => previewStateCatalog.value.variables);
const previewSwitchValues = computed(() => stateRecordMap(previewSession.value?.switchValues));
const previewVariableValues = computed(() => stateRecordMap(previewSession.value?.variableValues));
const visiblePreviewFrame = computed(() => (
  previewFrame.value
  && requestedMapId.value == null
  && mode.value === 'preview'
  && !previewRefreshActive.value
  && previewFrameOperationId.value === previewSession.value?.operationId
  && previewFrameMapId.value === selectedMapId.value
  && previewFrameMapId.value === previewSession.value?.mapId
  && previewFrameRevision.value === currentMapRevision.value
  && previewFrameRevision.value === previewSession.value?.mapRevision
    ? previewFrame.value
    : null
));
const mapPaintModeLabel = computed(() => {
  if (paintMode.value === 'shadow') return t('editor.status.shadowMode');
  if (paintMode.value === 'region') return t('editor.status.regionMode', { value: regionId.value });
  return t('editor.status.tileMode');
});
const previewRefreshEnabled = computed(() => (
  mode.value === 'preview'
  && selectedMapId.value != null
  && requestedMapId.value == null
  && previewStatus.value === 'running'
  && !busy.value
  && !previewRefreshActive.value
));

function stateRecordMap<T extends boolean | number>(record?: Record<string, T>): Map<number, T> {
  return new Map(Object.entries(record || {}).map(([id, value]) => [Number(id), value]));
}

function onPreviewStatus(session: MapPreviewSession) {
  const intent = previewIntentCoordinator.current()?.value;
  if (!intent?.active) {
    previewRefreshActive.value = false;
    if (previewSession.value && previewSession.value.sessionId !== session.sessionId) return;
    previewSession.value = session;
    previewStatus.value = session.status;
    previewError.value = '';
    previewDiagnostic.value = null;
    return;
  }
  if (!previewSessionMatchesIntent(session, intent)) return;
  previewSession.value = session;
  previewStatus.value = session.status;
  previewError.value = session.status === 'failed' ? previewFailureMessage(session) : '';
  previewDiagnostic.value = session.status === 'failed' ? mapPreviewDiagnosticFromSession(session) : null;
  if (session.status === 'running' || session.status === 'failed') previewRefreshActive.value = false;
  if (session.status === 'running') previewRequestedMapId.value = session.mapId;
}

function previewFailureMessage(session: MapPreviewSession): string {
  if (session.failureCode === 'runtime-handshake-timeout') {
    return t('editor.preview.runtimeHandshakeTimeout');
  }
  if (session.failureCode === 'map-render-failed') return t('editor.preview.mapRenderFailed');
  if (session.failureCode === 'runtime-resume-failed') return t('editor.preview.runtimeResumeFailed');
  if (session.failureCode === 'isolation-preparation-failed') return t('editor.preview.isolationPreparationFailed');
  if (session.failureCode === 'preview-debug-marker-conflict') return t('editor.preview.debugMarkerConflict');
  return t('editor.preview.unknownError');
}

function onPreviewFrame(frame: MapPreviewFrame) {
  const intent = previewIntentCoordinator.current()?.value;
  if (previewRefreshActive.value || !intent || !previewFrameMatchesIntent(frame, intent) || !previewSession.value || frame.sessionId !== previewSession.value.sessionId) {
    void mapPreview.ackFrame(frame.sequence).catch(() => undefined);
    return;
  }
  if (frame.operationId !== previewSession.value.operationId || frame.mapId !== previewSession.value.mapId || frame.mapId !== selectedMapId.value) {
    void mapPreview.ackFrame(frame.sequence).catch(() => undefined);
    return;
  }
  if (frame.mapRevision !== previewSession.value.mapRevision || frame.mapRevision !== currentMapRevision.value) {
    void mapPreview.ackFrame(frame.sequence).catch(() => undefined);
    return;
  }
  previewFrameMapWidth.value = frame.mapPixelWidth;
  previewFrameMapHeight.value = frame.mapPixelHeight;
  previewFrameOperationId.value = frame.operationId;
  previewFrameMapId.value = frame.mapId;
  previewFrameRevision.value = frame.mapRevision;
  if (frame.kind === 'tile') {
    previewTileFrame.value = frame;
    previewTileFrameSequence.value = frame.sequence;
    return;
  }
  previewFrame.value = frame;
  previewFrameSequence.value = frame.sequence;
  revokePreviewTileFrame();
}

async function ackPreviewFrame(sequence: number) {
  if (sequence !== previewFrameSequence.value && sequence !== previewTileFrameSequence.value) return;
  try { await mapPreview.ackFrame(sequence); } catch (error) {
    const intent = previewIntentCoordinator.current()?.value;
    if (intent?.active) setDirectPreviewFailure(error, 'frame-ack-ipc', intent);
  }
}

async function failPreviewPresentation(sequence: number, message: string) {
  try { await mapPreview.ackFrame(sequence); } catch { /* the presentation error remains authoritative */ }
  const intent = previewIntentCoordinator.current()?.value;
  if (intent?.active) setDirectPreviewFailure(new Error(message), 'frame-presentation', intent);
}

function updatePreviewView(view: MapPreviewViewRequest) {
  const intent = previewIntentCoordinator.current()?.value;
  if (!intent?.active || previewStatus.value !== 'running') return;
  void mapPreview.setView(view).catch((error) => {
    if (previewIntentCoordinator.current()?.value === intent && previewStatus.value === 'running') {
      setDirectPreviewFailure(error, 'view-update-ipc', intent);
    }
  });
}

function revokePreviewTileFrame() {
  previewTileFrame.value = null;
  previewTileFrameSequence.value = 0;
}

function revokePreviewFrame() {
  previewFrame.value = null;
  previewFrameSequence.value = 0;
  previewFrameMapWidth.value = 0;
  previewFrameMapHeight.value = 0;
  previewFrameOperationId.value = 0;
  previewFrameMapId.value = 0;
  previewFrameRevision.value = '';
  revokePreviewTileFrame();
}

function overridesForCurrentMap(): MapPreviewOverrides {
  return filterMapPreviewOverrides(readEditorPreviewOverrides(projectStore.currentProject), previewStateCatalog.value);
}

function syncPreviewOverridesFromWorkspace() {
  const overrides = overridesForCurrentMap();
  previewSwitchOverrides.value = stateRecordMap(overrides.switches);
  previewVariableOverrides.value = stateRecordMap(overrides.variables);
}

function currentPreviewIntent(): EditorPreviewIntent {
  const project = projectStore.currentProject;
  if (mode.value !== 'preview' || !project || requestedMapId.value != null || selectedMapId.value == null || !currentMapRevision.value) {
    return { active: false, project };
  }
  return { active: true, project, mapId: selectedMapId.value, mapRevision: currentMapRevision.value };
}

function schedulePreviewIntentReconcile(): LatestAsyncToken<EditorPreviewIntent> {
  const token = previewIntentCoordinator.begin(currentPreviewIntent());
  console.debug('[editor-preview-intent]', token.value.active
    ? { sequence: token.sequence, active: true, mapId: token.value.mapId }
    : { sequence: token.sequence, active: false });
  if (!token.value.active) {
    previewRefreshActive.value = false;
    previewError.value = '';
    previewDiagnostic.value = null;
  }
  void previewIntentCoordinator.runExclusive(token, async ({ isCurrent }) => {
    if (!token.value.active) {
      await suspendPreviewSession();
      return;
    }
    await ensurePreviewForIntent(token, isCurrent);
  });
  return token;
}

async function ensurePreviewForIntent(
  token: LatestAsyncToken<EditorPreviewIntent>,
  isCurrent: () => boolean,
) {
  const intent = token.value;
  if (!intent.active || !isCurrent()) return;
  const mapId = intent.mapId;
  const current = previewSession.value;
  if (current && !['stopped', 'failed'].includes(current.status)) {
    previewRequestedMapId.value = mapId;
    try {
      syncPreviewOverridesFromWorkspace();
      const result = await mapPreview.resume(
        intent.project,
        mapId,
        overridesForCurrentMap(),
        intent.mapRevision,
        intent.forceReload,
      );
      if (isCurrent() && result.session) onPreviewStatus(result.session);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('[editor-preview-intent] failed', { sequence: token.sequence, mapId, stage: 'resume' });
      setDirectPreviewFailure(error, 'resume-ipc', intent);
      previewStatus.value = 'failed';
      previewRefreshActive.value = false;
    }
    return;
  }
  previewError.value = '';
  previewDiagnostic.value = null;
  previewStatus.value = 'preparing';
  previewRequestedMapId.value = mapId;
  revokePreviewFrame();
  try {
    syncPreviewOverridesFromWorkspace();
    const result = await mapPreview.start(intent.project, mapId, overridesForCurrentMap());
    if (!isCurrent()) return;
    if (result.runtimeSelectionRequired) {
      const selection = await playtest.selectRuntime(result.runtimeSelectionRequired);
      if (!isCurrent()) return;
      if (!selection.configured || selection.canceled) {
        previewRefreshActive.value = false;
        previewStatus.value = 'failed';
        previewError.value = t('editor.preview.runtimeRequired');
        previewDiagnostic.value = mapPreviewDiagnosticFromError({
          error: new Error(previewError.value),
          stage: 'runtime-selection',
          engine: currentEngine.value,
          mapId,
          project: intent.project,
        });
        return;
      }
      const retried = await mapPreview.start(intent.project, mapId, overridesForCurrentMap());
      if (!isCurrent()) return;
      if (retried.session) onPreviewStatus(retried.session);
      else if (retried.error) throw new Error(retried.error);
      return;
    }
    if (result.session) onPreviewStatus(result.session);
    else if (result.error) throw new Error(result.error);
  } catch (error) {
    if (!isCurrent()) return;
    console.warn('[editor-preview-intent] failed', { sequence: token.sequence, mapId, stage: 'start' });
    previewStatus.value = 'failed';
    setDirectPreviewFailure(error, 'start-ipc', intent);
    previewRefreshActive.value = false;
  }
}

async function stopPreviewSession() {
  previewRefreshActive.value = false;
  previewRequestedMapId.value = null;
  revokePreviewFrame();
  previewSwitchOverrides.value = new Map();
  previewVariableOverrides.value = new Map();
  const session = previewSession.value;
  previewSession.value = null;
  previewStatus.value = 'stopped';
  previewError.value = '';
  previewDiagnostic.value = null;
  if (!session || ['stopped', 'failed'].includes(session.status)) return;
  try {
    await mapPreview.stop();
  } catch (error) {
    ElMessage.error(t('editor.preview.stopFailed', { message: (error as Error).message }));
  }
}

async function suspendPreviewSession() {
  const session = previewSession.value;
  if (!session || ['suspended', 'stopped', 'failed'].includes(session.status)) return;
  try {
    const result = await mapPreview.suspend();
    if (result.session) onPreviewStatus(result.session);
  } catch (error) {
    ElMessage.error(t('editor.preview.stopFailed', { message: (error as Error).message }));
  }
}

async function restartPreview() {
  previewRefreshActive.value = false;
  const token = previewIntentCoordinator.begin(currentPreviewIntent());
  void previewIntentCoordinator.runExclusive(token, async ({ isCurrent }) => {
    await stopPreviewSession();
    if (!isCurrent() || !token.value.active) return;
    await ensurePreviewForIntent(token, isCurrent);
  });
}

async function refreshPreview() {
  if (!previewRefreshEnabled.value || selectedMapId.value == null) return;
  const mapId = selectedMapId.value;
  previewRefreshActive.value = true;
  previewStatus.value = 'resuming';
  previewError.value = '';
  previewDiagnostic.value = null;
  revokePreviewFrame();
  const loadResult = await loadMap(mapId, {
    quiet: true,
    resetHistory: false,
    preserveEventSelection: true,
    reconcilePreview: false,
  });
  if (loadResult !== 'committed') {
    previewRefreshActive.value = false;
    if (loadResult === 'failed' && previewSession.value) previewStatus.value = previewSession.value.status;
    return;
  }
  const intent = currentPreviewIntent();
  if (!intent.active) {
    previewRefreshActive.value = false;
    return;
  }
  revokePreviewFrame();
  const token = previewIntentCoordinator.begin({ ...intent, forceReload: true });
  void previewIntentCoordinator.runExclusive(token, async ({ isCurrent }) => {
    if (!isCurrent()) {
      previewRefreshActive.value = false;
      return;
    }
    await ensurePreviewForIntent(token, isCurrent);
  });
}

function setDirectPreviewFailure(error: unknown, stage: string, intent: Extract<EditorPreviewIntent, { active: true }>) {
  const diagnostic = mapPreviewDiagnosticFromError({
    error,
    stage,
    engine: currentEngine.value,
    mapId: intent.mapId,
    operationId: previewSession.value?.operationId,
    project: intent.project,
  });
  previewDiagnostic.value = diagnostic;
  previewError.value = t('editor.preview.unknownError');
}

async function copyPreviewDiagnostic() {
  const diagnostic = previewDiagnostic.value;
  if (!diagnostic) return;
  try {
    await clipboardApi.writeText(serializeMapPreviewDiagnostic(diagnostic));
    ElMessage.success(t('editor.preview.copyDiagnosticSuccess'));
  } catch (error) {
    ElMessage.error(t('editor.preview.copyDiagnosticFailed', { message: (error as Error).message }));
  }
}

async function setPreviewSwitch(id: number, value: boolean) {
  try {
    await mapPreview.setSwitch(id, value);
    const next = new Map(previewSwitchOverrides.value);
    next.set(id, value);
    previewSwitchOverrides.value = next;
    const saved = readEditorPreviewOverrides(projectStore.currentProject);
    writeEditorPreviewOverrides(projectStore.currentProject, {
      switches: { ...saved.switches, [String(id)]: value },
      variables: saved.variables,
    });
  } catch (error) {
    ElMessage.error(t('editor.preview.stateFailed', { message: (error as Error).message }));
  }
}

async function setPreviewVariable(id: number, value: number) {
  try {
    await mapPreview.setVariable(id, value);
    const next = new Map(previewVariableOverrides.value);
    next.set(id, value);
    previewVariableOverrides.value = next;
    const saved = readEditorPreviewOverrides(projectStore.currentProject);
    writeEditorPreviewOverrides(projectStore.currentProject, {
      switches: saved.switches,
      variables: { ...saved.variables, [String(id)]: value },
    });
  } catch (error) {
    ElMessage.error(t('editor.preview.stateFailed', { message: (error as Error).message }));
  }
}

async function resetPreviewOverrides() {
  try {
    await mapPreview.resetOverrides();
    const saved = readEditorPreviewOverrides(projectStore.currentProject);
    writeEditorPreviewOverrides(
      projectStore.currentProject,
      removeMapPreviewOverrides(saved, previewStateCatalog.value),
    );
    previewSwitchOverrides.value = new Map();
    previewVariableOverrides.value = new Map();
  } catch (error) {
    ElMessage.error(t('editor.preview.stateFailed', { message: (error as Error).message }));
  }
}

const zoomControls = { zoomIn, zoomOut, resetZoom };

onMounted(async () => {
  unregisterPreviewStatus = mapPreview.onStatus(onPreviewStatus);
  unregisterPreviewFrame = mapPreview.onFrame(onPreviewFrame);
  try {
    const current = await mapPreview.current();
    if (current.session && !['stopped', 'failed'].includes(current.session.status)) onPreviewStatus(current.session);
  } catch { /* A stale preview is not allowed to block opening the editor. */ }
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
  previewIntentCoordinator.invalidate({ active: false, project: projectStore.currentProject });
  mapLoadCoordinator.invalidate({ project: projectStore.currentProject, mapId: -1 });
  unregisterPreviewStatus?.();
  unregisterPreviewStatus = null;
  unregisterPreviewFrame?.();
  unregisterPreviewFrame = null;
  revokePreviewFrame();
  if (previewSession.value && !['suspended', 'stopped', 'failed'].includes(previewSession.value.status)) {
    void mapPreview.suspend();
  }
  unregisterUiControlHandler?.();
  unregisterUiControlHandler = null;
  workbenchUi.clearEditorZoomControls(zoomControls);
  workbenchUi.clearStatusBar();
  window.removeEventListener('keydown', onEditorKeyDown);
  window.removeEventListener(EDITOR_COMMAND_EVENT, onEditorCommand as EventListener);
  if (eventSearchTimer) clearTimeout(eventSearchTimer);
});
watch(mode, (value, previous) => {
  persistWorkspaceSelection();
  if (value === 'preview' || previous === 'preview') schedulePreviewIntentReconcile();
});
watch(mode, (value) => {
  hoveredEventId.value = null;
  if (value !== 'event') eventSearchScope.value = 'current';
});
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
watch(eventSearchQuery, (query) => {
  if (!query.trim()) eventSearchScope.value = 'current';
  scheduleEventSearch(query);
});
watch(selectedMapId, () => {
  hoveredEventId.value = null;
  eventSearchScope.value = 'current';
  if (eventSearchQuery.value.trim()) scheduleEventSearch(eventSearchQuery.value);
});

function scheduleEventSearch(query: string) {
  if (eventSearchTimer) clearTimeout(eventSearchTimer);
  const sequence = ++eventSearchSequence;
  const trimmed = query.trim();
  if (!trimmed) {
    eventSearchHits.value = [];
    eventSearchLoading.value = false;
    eventSearchTruncated.value = false;
    return;
  }
  eventSearchLoading.value = true;
  eventSearchTimer = setTimeout(async () => {
    try {
      const options = eventSearchScope.value === 'current'
        ? { mapId: selectedMapId.value ?? undefined, limit: 200 }
        : { limit: 200 };
      if (eventSearchScope.value === 'current' && options.mapId == null) {
        eventSearchHits.value = [];
        eventSearchTruncated.value = false;
        return;
      }
      const result = await eventsApi.search(trimmed, projectStore.currentProject, options);
      if (sequence !== eventSearchSequence) return;
      eventSearchHits.value = result.hits;
      eventSearchTruncated.value = result.truncated;
    } catch (error) {
      if (sequence !== eventSearchSequence) return;
      eventSearchHits.value = [];
      eventSearchTruncated.value = false;
      setStatus(t('editor.event.searchFailed', { message: (error as Error).message }), 'error');
    } finally {
      if (sequence === eventSearchSequence) eventSearchLoading.value = false;
    }
  }, 180);
}

function searchAllMaps() {
  if (!eventSearchQuery.value.trim() || eventSearchScope.value === 'all') return;
  eventSearchScope.value = 'all';
  scheduleEventSearch(eventSearchQuery.value);
}

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
  mapLoadCoordinator.invalidate({ project: projectStore.currentProject, mapId: -1 });
  requestedMapId.value = null;
  previewIntentCoordinator.invalidate({ active: false, project: projectStore.currentProject });
  await stopPreviewSession();
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
  } catch (error) { ElMessage.error(t('editor.error.loadTreeFailed', { message: (error as Error).message })); }
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
async function handleNodeClick(node: TreeNode) {
  await loadMap(node.id);
}
async function moveMapFromTree(source: TreeNode, target: TreeNode, position: 'before' | 'after' | 'inside') {
  if (busy.value) return;
  const projection = projectMapTreeMove(mapTree.value, source.id, target.id, position);
  if (!projection.valid) return;
  busy.value = true;
  mapTree.value = projection.tree;
  if (position === 'inside') {
    expandedMapIds.value = [...new Set([...expandedMapIds.value, target.id])];
  }
  setStatus(t('editor.map.reordering'), 'busy');
  try {
    await mapsApi.move(source.id, target.id, position, projectStore.currentProject);
    await loadTree();
    if (selectedMapId.value != null) {
      expandedMapIds.value = [...new Set([...expandedMapIds.value, ...ancestorMapIdsFor(mapTree.value, selectedMapId.value)])];
    }
    setStatus(t('editor.map.reordered'), 'saved');
  } catch (error) {
    await loadTree();
    setStatus(t('editor.map.reorderFailed', { message: (error as Error).message }), 'error');
    ElMessage.error(t('editor.map.reorderFailed', { message: (error as Error).message }));
  } finally {
    busy.value = false;
  }
}

async function openEventSearchHit(hit: EditorEventSearchHit) {
  mode.value = 'event';
  if (selectedMapId.value !== hit.mapId && await loadMap(hit.mapId, { quiet: true }) !== 'committed') return;
  eventSearchQuery.value = '';
  eventSearchScope.value = 'current';
  selectedEventId.value = hit.eventId;
  expandedMapIds.value = [...new Set([...expandedMapIds.value, ...ancestorMapIdsFor(mapTree.value, hit.mapId)])];
  renderMap();
  await openEventEditor(hit.eventId);
}
async function openPreferredMap(savedMapId?: number) {
  const routeMapId = Number(route.query.mapId);
  const candidates = [...new Set([
    ...(Number.isInteger(routeMapId) && routeMapId > 0 ? [routeMapId] : []),
    ...(savedMapId ? [savedMapId] : []),
    ...flattenTree(mapTree.value).map((node) => node.id),
  ])];
  for (const mapId of candidates) {
    const result = await loadMap(mapId, { quiet: true });
    if (result === 'committed') return true;
    if (result === 'superseded') return false;
  }
  if (mapTree.value.length) ElMessage.error(t('editor.error.noLoadableMaps'));
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
    if (loaded !== 'committed') return;
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
    const res = await eventRegistry.reject(projectStore.currentProject, contractId, { reason: t('editor.placement.rejectReason') });
    previousStatus = res?.previousStatus;
  } catch (error) {
    // 注册表里没有该契约（如未登记的临时事件）时照常本地移除，仅记录告警。
    console.warn('[placement] reject contract failed', error);
  }
  rejectUndoStack.value.push({ event: snapshot, index, previousStatus });
  setStatus(t('editor.placement.rejectedUndo', { name }), 'saved');
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
  setStatus(t('editor.placement.rejectUndone', { name: entry.event.eventName || entry.event.contractId }), 'saved');
}

async function runPlacementAt(cell: { x: number; y: number }) {
  const focus = placementFocus.value;
  const selected = placementSelectedEvent.value;
  const mapId = selectedMapId.value;
  if (!focus || !selected || isPlacedStatus(selected.status) || mapId == null || !canActivatePlacementOnMap(mapId)) return;
  const validity = validatePlacementCell(currentMap, tilesetFlags.value, cell.x, cell.y, language.value);
  if (!validity.valid) {
    ElMessage.warning(validity.reason || t('editor.placement.cannotPlaceHere'));
    return;
  }
  busy.value = true;
  try {
    const result = await placeContractAtCell({
      focus,
      mapId,
      cell,
      applyContractPages: true,
      language: language.value,
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
    const suffix = result.usedContractPatch ? t('editor.placement.contractPatchSuffix') : result.shellOnly ? t('editor.placement.shellOnlySuffix') : t('editor.placement.skeletonSuffix');
    ElMessage.success(t('editor.placement.placedSuccess', { name: focus.eventName, x: cell.x, y: cell.y, suffix }));
    setStatus(t('editor.placement.doneStatus'), 'saved');
  } catch (error) {
    const message = (error as Error).message;
    ElMessage.error(t('editor.placement.failedPrefix', { message }));
  } finally {
    busy.value = false;
  }
}

async function refreshPlacementQueueFromRegistry() {
  try {
    await eventPlacementAsk.refreshFromRegistry(projectStore.currentProject);
  } catch (error) {
    console.error('[event-placement] registry refresh failed', error);
    ElMessage.error(t('editor.placement.refreshFailed', { message: (error as Error).message }));
  }
}

function goBackToChatPlacement() {
  router.push('/workbench');
  workbenchUi.setAgentPanelOpen(true);
}

function stopPlacementMode() {
  eventPlacementAsk.stopPlacing();
  setStatus(t('editor.placement.canceled'), 'saved');
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
    layer.value = 'auto';
    characterAssetUrls.clear();
    for (const asset of catalog.assets.characters) characterAssetUrls.set(asset.name, asset.url);
  } catch (error) {
    ElMessage.warning(t('editor.assets.loadFailed', { message: (error as Error).message }));
  }
}
async function loadMap(
  mapId: number,
  options: { quiet?: boolean; resetHistory?: boolean; preserveEventSelection?: boolean; reconcilePreview?: boolean } = {},
): Promise<MapLoadResult> {
  const project = projectStore.currentProject;
  const token = mapLoadCoordinator.begin({ project, mapId });
  console.debug('[editor-map-load] requested', { sequence: token.sequence, mapId });
  requestedMapId.value = mapId;
  if (mode.value === 'preview' && options.reconcilePreview !== false) schedulePreviewIntentReconcile();
  busy.value = true;
  setStatus(t('editor.map.loading'), 'busy');
  const treeNode = findTreeNode(mapId);
  if (treeNode && !treeNode.mapFileExists) {
    if (!mapLoadCoordinator.isCurrent(token)) return 'superseded';
    const message = t('editor.error.mapFileMissing', { mapId: String(mapId).padStart(3, '0') });
    setStatus(message, 'error');
    if (!options.quiet) ElMessage.warning(message);
    requestedMapId.value = null;
    busy.value = false;
    if (mode.value === 'preview' && options.reconcilePreview !== false) schedulePreviewIntentReconcile();
    return 'failed';
  }
  try {
    const payload = await mapsApi.get(mapId, project);
    const nextMap = payloadToMap(payload.map);
    const names = payload.tileset?.tilesetNames || [];
    const [images, parallaxImage, eventCharacters] = await Promise.all([
      preloadTileset(payload.tileset?.imageUrls || []),
      preloadOptionalImage(payload.parallaxImageUrl),
      prepareEventCharacters(nextMap),
    ]);
    if (!mapLoadCoordinator.isCurrent(token)) return 'superseded';
    const outcome = await mapLoadCoordinator.runExclusive(token, async ({ isCurrent }) => {
      if (!isCurrent()) return;
      selectedMapId.value = mapId;
      currentTileSize.value = payload.tileSize;
      currentEngine.value = payload.engine;
      currentTilesetMode.value = payload.tileset?.mode ?? null;
      currentMap = nextMap;
      currentMapRevision.value = payload.effectiveMapRevision;
      syncCurrentEvents(nextMap);
      if (!options.preserveEventSelection) selectedEventId.value = null;
      systemData.value = payload.system || null;
      previewStateCatalog.value = payload.previewState || { switches: [], variables: [] };
      syncPreviewOverridesFromWorkspace();
      currentMapName.value = String(payload.info.name || '');
      tilesetFlags.value = Array.isArray(payload.tileset?.flags) ? payload.tileset.flags : [];
      setPropertiesFromMap(currentMapName.value, nextMap, Number(payload.info.parentId || 0));
      stagingDirty.value = isStagingDirty(payload.staging);
      currentParallaxImage.value = parallaxImage;
      for (const [name, image] of eventCharacters) characterImages.set(name, image);
      await setMap(nextMap, names, images, options.resetHistory !== false);
      if (!isCurrent()) return;
      currentTilesetImages.value = images;
      renderMap();
      await refreshStagingStatus();
      if (!isCurrent()) return;
      requestedMapId.value = null;
      persistWorkspaceSelection();
      setStatus(t('editor.map.loaded'), 'saved');
      console.debug('[editor-map-load] committed', { sequence: token.sequence, mapId });
      for (const warning of payload.resourceWarnings || []) ElMessage.warning(warning);
      if (options.reconcilePreview !== false) schedulePreviewIntentReconcile();
    });
    return outcome === 'completed' ? 'committed' : 'superseded';
  } catch (error) {
    if (!mapLoadCoordinator.isCurrent(token)) return 'superseded';
    console.warn('[editor-map-load] failed', { sequence: token.sequence, mapId, stage: 'prepare-or-commit' });
    setStatus(t('editor.map.loadFailedStatus', { message: (error as Error).message }), 'error');
    if (!options.quiet) ElMessage.error(t('editor.map.loadFailed', { message: (error as Error).message }));
    requestedMapId.value = null;
    if (mode.value === 'preview' && options.reconcilePreview !== false) schedulePreviewIntentReconcile();
    return 'failed';
  } finally {
    if (mapLoadCoordinator.isCurrent(token)) busy.value = false;
  }
}
async function reloadCurrentMap(): Promise<MapLoadResult> {
  if (selectedMapId.value == null) return 'failed';
  return loadMap(selectedMapId.value, { quiet: true, resetHistory: false, preserveEventSelection: true });
}
function payloadToMap(payload: { width: number; height: number; tilesetId: number; data: number[]; events: unknown[]; [key: string]: unknown }): EditableMap {
  return { ...payload, width: payload.width, height: payload.height, tilesetId: payload.tilesetId, data: payload.data, events: payload.events as (MvEvent | null)[] };
}
async function preloadTileset(urls: (string | null)[]) {
  const resolved = await Promise.all(urls.map((url) => url ? resolveAssetUrl(url) : Promise.resolve(null)));
  return Promise.all(resolved.map((url) => url ? loadImage(url) : Promise.resolve(null)));
}
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return loadImageElement(url);
}
async function preloadOptionalImage(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return loadImage(await resolveAssetUrl(url));
}
function syncCurrentEvents(map: MvMap | null) {
  currentEvents.value = (map?.events || [])
    .filter((event): event is MvEvent => Boolean(event && Number.isInteger(event.id) && event.id > 0))
    .map((event) => ({ id: event.id, name: event.name || `EV${String(event.id).padStart(3, '0')}`, note: String(event.note || '').replace(/\s+/g, ' ').trim(), x: event.x, y: event.y }))
    .sort((left, right) => left.id - right.id);
}
async function prepareEventCharacters(map: MvMap): Promise<Array<[string, HTMLImageElement | null]>> {
  const names = new Set<string>();
  for (const event of map.events || []) for (const page of event?.pages || []) if (page.image?.characterName) names.add(page.image.characterName);
  return Promise.all([...names].map(async (name) => {
    const cached = characterImages.get(name);
    if (cached !== undefined) return [name, cached] as [string, HTMLImageElement | null];
    const url = characterAssetUrls.get(name);
    if (!url) return [name, null] as [string, HTMLImageElement | null];
    return [name, await loadImage(await resolveAssetUrl(url))] as [string, HTMLImageElement | null];
  }));
}
function isStagingDirty(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const staging = value as Record<string, unknown>;
  return Boolean(staging.staged || staging.dirty || staging.hasChanges || staging.updatedAt);
}
async function refreshStagingStatus() {
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject) as { staged?: boolean; maps?: number[]; operations?: unknown[] };
    stagedMapIds.value = new Set((status.maps || []).filter(Number.isFinite));
    stagingDirty.value = Boolean(status.staged) || stagedMapIds.value.size > 0;
  } catch { /* staging status does not block the editor */ }
}

async function confirmAgentOperations(summary: ProjectStagingSummary): Promise<boolean> {
  if (!summary.operations.length) return true;
  const operations = summary.operations
    .map((operation) => t('story.agentOperationSummary', {
      operationId: operation.operationId,
      count: operation.files.length,
    }))
    .join('\n');
  try {
    await ElMessageBox.confirm(
      t('story.applyAgentOperationsConfirm', { operations }),
      t('story.applyAgentOperationsTitle'),
      { type: 'warning' },
    );
    return true;
  } catch {
    return false;
  }
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
    encounterList: [],
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
    encounterList: (Array.isArray(map.encounterList) ? map.encounterList : []).map((encounter) => ({
      ...encounter,
      regionSet: Array.isArray(encounter.regionSet) ? [...encounter.regionSet] : [],
    })),
    note: String(map.note || ''),
  });
}
function mapPropertiesPayload(): Record<string, unknown> {
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
    encounterList: properties.encounterList.map((encounter) => ({
      ...encounter,
      regionSet: [...encounter.regionSet],
    })),
    encounterStep: properties.encounterStep,
    note: properties.note,
  };
}
function openCreateProperties(parentId: number) {
  setPropertiesFromMap(t('editor.map.newMapName'), { width: 17, height: 13, tilesetId: tilesets.value[0]?.id || 1, encounterStep: 30 }, parentId);
  propertiesDialogMode.value = 'create';
  propertiesDialogOpen.value = true;
}
function closePropertiesDialog() { propertiesDialogOpen.value = false; }
async function openEditProperties(mapId = selectedMapId.value) {
  if (mapId == null) return;
  if (selectedMapId.value !== mapId && await loadMap(mapId) !== 'committed') return;
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
      ElMessage.success(t('editor.map.createdStaged'));
    } else if (selectedMapId.value != null) {
      await mapsApi.updateProperties(selectedMapId.value, payload, projectStore.currentProject);
      propertiesDialogOpen.value = false;
      await loadTree();
      await loadMap(selectedMapId.value);
      ElMessage.success(t('editor.map.propertiesSavedStaged'));
    }
  } catch (error) { ElMessage.error(t('editor.map.savePropertiesFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}

async function applyStaging() {
  busy.value = true;
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject);
    const summary = parseProjectStagingSummary(status);
    if (!await confirmAgentOperations(summary)) return;
    const result = await mapsApi.applyProjectStaging(
      projectStore.currentProject,
      summary.operations.map((operation) => operation.operationId),
    ) as { canceled?: boolean };
    if (result?.canceled) return;
    if (selectedMapId.value != null) await reloadCurrentMap();
    await refreshStagingStatus();
    ElMessage.success(t('editor.staging.applied'));
  } catch (error) {
    const err = error as ApiError;
    ElMessage.error(err.status === 409 ? t('editor.staging.conflict') : t('editor.staging.applyFailed', { message: err.message }));
  } finally { busy.value = false; }
}
async function discardStaging() {
  busy.value = true;
  try {
    await mapsApi.discardProjectStaging(projectStore.currentProject);
    if (selectedMapId.value != null && await loadMap(selectedMapId.value, { quiet: true }) === 'failed') {
      clearCurrentMap();
      await loadTree();
      await openPreferredMap();
    }
    await refreshStagingStatus();
    ElMessage.success(t('editor.staging.discarded'));
  } catch (error) { ElMessage.error(t('editor.staging.discardFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function applyOneMap(mapId: number) {
  busy.value = true;
  try {
    const result = await mapsApi.applyMapStaging(mapId, projectStore.currentProject) as { canceled?: boolean };
    if (result?.canceled) return;
    if (selectedMapId.value === mapId) await reloadCurrentMap();
    await loadTree();
    ElMessage.success(t('editor.staging.mapApplied', { mapId }));
  } catch (error) { ElMessage.error(t('editor.staging.applyFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function discardOneMap(mapId: number) {
  try { await ElMessageBox.confirm(t('editor.staging.confirmDiscardMap', { mapId }), t('editor.staging.discardTitle'), { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await mapsApi.discardMapStaging(mapId, projectStore.currentProject);
    if (selectedMapId.value === mapId && await loadMap(mapId, { quiet: true }) === 'failed') {
      clearCurrentMap();
      await loadTree();
      await openPreferredMap();
    }
    await loadTree();
    ElMessage.success(t('editor.staging.mapDiscarded', { mapId }));
  } catch (error) { ElMessage.error(t('editor.staging.discardFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}

function onTreeContextMenu(event: MouseEvent, node: TreeNode) { event.preventDefault(); Object.assign(treeContext, { visible: true, x: event.clientX, y: event.clientY, mapId: node.id }); }
function closeTreeContext() { treeContext.visible = false; }
async function ctxEditProperties() { const id = treeContext.mapId; closeTreeContext(); await openEditProperties(id); }
function ctxNewMapUnder() { const id = treeContext.mapId; closeTreeContext(); openCreateProperties(id); }
function ctxCopyMap() { mapClipboard.value = treeContext.mapId; setStatus(t('editor.map.copied', { mapId: treeContext.mapId }), 'saved'); closeTreeContext(); }
async function ctxPasteMap() {
  if (mapClipboard.value == null) return;
  const parentId = treeContext.mapId;
  closeTreeContext();
  busy.value = true;
  try {
    const result = await mapsApi.duplicate(mapClipboard.value, parentId, projectStore.currentProject) as { mapId: number };
    await loadTree();
    if (result.mapId) await loadMap(result.mapId);
    ElMessage.success(t('editor.map.pastedStaged', { mapId: result.mapId }));
  } catch (error) { ElMessage.error(t('editor.map.pasteFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function ctxDeleteMap() {
  const mapId = treeContext.mapId;
  closeTreeContext();
  try { await ElMessageBox.confirm(t('editor.map.confirmDelete', { mapId }), t('editor.map.deleteTitle'), { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await mapsApi.remove(mapId, projectStore.currentProject);
    if (selectedMapId.value === mapId) {
      clearCurrentMap();
    }
    await loadTree();
    if (selectedMapId.value == null) await openPreferredMap();
    ElMessage.success(t('editor.map.deletedStaged', { mapId }));
  } catch (error) { ElMessage.error(t('editor.map.deleteFailed', { message: (error as Error).message })); }
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
const systemPositionLabelKeys: Record<RmmvSystemPositionTarget, MessageKey> = {
  player: 'editor.systemPosition.player',
  boat: 'editor.systemPosition.boat',
  ship: 'editor.systemPosition.ship',
  airship: 'editor.systemPosition.airship',
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
    const label = t(systemPositionLabelKeys[target]);
    setStatus(t('editor.systemPosition.setStatus', { label, mapId, x, y }), 'saved');
    ElMessage.success(t('editor.systemPosition.saved', { label }));
  } catch (error) {
    const label = t(systemPositionLabelKeys[target]);
    ElMessage.error(t('editor.systemPosition.failed', { label, message: (error as Error).message }));
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
function openQuickObtain() {
  if (canvasContext.eventId != null || editorCatalog.value?.engine !== 'rpg-maker-mz') return;
  const position = { x: canvasContext.cellX, y: canvasContext.cellY };
  closeCanvasContext();
  quickObtainDialog.value?.open(position);
}
function createObtainEvent(selection: { kind: QuickObtainKind; databaseId: number; quantity: number; x: number; y: number; name: string }) {
  eventOverview.value = null;
  eventDraft.value = quickObtainEventTemplate(selection.kind, selection.databaseId, selection.quantity, selection.x, selection.y, selection.name);
  eventDialogOpen.value = true;
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
    preview: previewSession.value ? {
      sessionId: previewSession.value.sessionId,
      operationId: previewSession.value.operationId || 0,
      sessionMapId: previewSession.value.mapId,
      status: previewSession.value.status,
      mapRevision: currentMapRevision.value,
      frameRevision: previewFrameRevision.value,
      frameOperationId: previewFrameOperationId.value,
      frameMapId: previewFrameMapId.value,
      frameSequence: previewFrameSequence.value,
      failureCode: previewSession.value.failureCode || '',
      error: previewSession.value.error || '',
    } : undefined,
  };
}

async function openEventEditorByUiControl(mapId: number, eventId: number): Promise<EditorUiControlState> {
  if (!projectStore.currentProject) throw new Error(t('editor.error.noProject'));
  if (selectedMapId.value !== mapId) {
    const loaded = await loadMap(mapId, { quiet: true });
    if (loaded !== 'committed') throw new Error(t('editor.error.mapNotFound', { mapId }));
  }
  await openEventEditorStrict(eventId);
  return getUiControlState();
}

function selectEvent(eventId: number | null) { selectedEventId.value = eventId == null || selectedEventId.value === eventId ? null : eventId; renderMap(); }
function openNewEventAt(x: number, y: number) { eventOverview.value = null; eventDraft.value = defaultEvent(0, x, y); eventDialogOpen.value = true; }
async function openEventEditorStrict(eventId: number) {
  const event = currentMap?.events?.find((item) => item?.id === eventId) as MvEditorEvent | undefined;
  if (!event) throw new Error(t('editor.error.eventNotFound', { eventId }));
  if (selectedMapId.value != null) {
    try {
      eventOverview.value = await storyPages.inspectEvent(selectedMapId.value, eventId, projectStore.currentProject);
    } catch (error) {
      eventOverview.value = null;
      throw new Error(t('editor.error.eventPermissionFailed', { message: (error as Error).message }));
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
    ElMessage.success(event.id ? t('editor.event.saved') : t('editor.event.created'));
  } catch (error) { ElMessage.error(t('editor.event.saveFailed', { message: (error as Error).message })); }
  finally { eventSaving.value = false; }
}
function copyEvent(eventId: number) {
  const event = currentMap?.events?.find((item) => item?.id === eventId);
  if (!event) return;
  eventClipboard.value = { eventId, data: clone(event as MvEditorEvent) };
  setStatus(t('editor.event.copied', { eventId }), 'saved');
}
async function cutEvent(eventId: number) {
  if (selectedMapId.value == null) return;
  copyEvent(eventId);
  busy.value = true;
  try {
    await eventsApi.remove(selectedMapId.value, eventId, projectStore.currentProject);
    await reloadCurrentMap();
    selectedEventId.value = null;
    setStatus(t('editor.event.cut', { eventId }), 'saved');
  } catch (error) { ElMessage.error(t('editor.event.cutFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function pasteEvent(x?: number, y?: number) {
  if (!eventClipboard.value || selectedMapId.value == null) return;
  const event = { ...clone(eventClipboard.value.data), id: 0, ...(x == null ? {} : { x }), ...(y == null ? {} : { y }) };
  busy.value = true;
  try {
    await eventsApi.create(selectedMapId.value, event as unknown as Record<string, unknown>, projectStore.currentProject);
    await reloadCurrentMap();
    ElMessage.success(t('editor.event.pasted'));
  } catch (error) { ElMessage.error(t('editor.event.pasteFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function deleteEvent(eventId: number) {
  if (selectedMapId.value == null) return;
  try { await ElMessageBox.confirm(t('editor.event.confirmDelete'), t('editor.event.deleteTitle'), { type: 'warning' }); }
  catch { return; }
  busy.value = true;
  try {
    await eventsApi.remove(selectedMapId.value, eventId, projectStore.currentProject);
    await reloadCurrentMap();
    selectedEventId.value = null;
    ElMessage.success(t('editor.event.deleted'));
  } catch (error) { ElMessage.error(t('editor.event.deleteFailed', { message: (error as Error).message })); }
  finally { busy.value = false; }
}
async function moveEvent(eventId: number, x: number, y: number) {
  if (mode.value !== 'event' || selectedMapId.value == null) return;
  busy.value = true;
  try {
    await eventsApi.update(selectedMapId.value, eventId, { x, y }, projectStore.currentProject);
    await reloadCurrentMap();
    setStatus(t('editor.event.moved', { eventId, x, y }), 'saved');
  } catch (error) {
    await reloadCurrentMap();
    ElMessage.error(t('editor.event.moveFailed', { message: (error as Error).message }));
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
  if (mode.value !== 'map') return ElMessage.info(t('editor.command.undoMapOnly'));
  if (!undoLen.value) return ElMessage.info(t('editor.command.noUndo'));
  await undo();
}
async function runEditorRedo() {
  if (mode.value !== 'map') return ElMessage.info(t('editor.command.redoMapOnly'));
  if (!redoLen.value) return ElMessage.info(t('editor.command.noRedo'));
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
    ElMessage.info(t('editor.command.noEditorWork'));
    return;
  }
  await refreshStagingStatus();
  const message = stagingDirty.value ? t('editor.command.savedToStaging') : t('editor.command.noPendingSave');
  setStatus(message, stagingDirty.value ? 'saved' : '');
  ElMessage.info(message);
}

function onEditorKeyDown(event: KeyboardEvent) {
  if (isFormTarget(event.target) || eventDialogOpen.value || selectedMapId.value == null) return;
  if (mode.value === 'preview') return;
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
  mapLoadCoordinator.invalidate({ project: projectStore.currentProject, mapId: -1 });
  requestedMapId.value = null;
  selectedMapId.value = null;
  currentMap = null;
  currentMapName.value = '';
  currentTileSize.value = 48;
  currentTilesetImages.value = [];
  currentParallaxImage.value = null;
  currentMapRevision.value = '';
  syncCurrentEvents(null);
  clearMap();
  schedulePreviewIntentReconcile();
}
</script>

<style scoped>
.editor-view { width:100%;min-width:0;height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--app-bg-page); }
.editor-body { min-height: 0; display: flex; flex: 1; overflow: hidden; gap:10px; }
.center-col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.editor-stage { position:relative; min-width: 380px; min-height: 0; display: flex; flex-direction: column; flex: 1; overflow: hidden; border-radius:12px; background-color:var(--app-bg-sunken); background-image:linear-gradient(rgba(120,110,90,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(120,110,90,.05) 1px,transparent 1px);background-size:24px 24px;box-shadow:inset 0 1px 3px rgba(60,50,30,.08); }
.editor-stage.preview-stage{border-radius:8px;background:#12161b;background-image:none;box-shadow:none}
.editor-canvas-layer { position:relative; min-width:0; min-height:0; display:flex; flex:1; flex-direction:column; overflow:hidden; }
.empty-state { width: 100%; display: flex; align-items: center; justify-content: center; }
.empty-actions { display: flex; justify-content: center; gap: 8px; }
.canvas-scroll { position:relative; flex: 1; overflow: auto; padding: 0; scrollbar-width:auto; scrollbar-color:var(--app-border-strong) transparent; }
.canvas-scroll::-webkit-scrollbar { width:12px; height:12px; }
.canvas-scroll::-webkit-scrollbar-thumb { border:1px solid transparent; border-radius:var(--app-radius-pill); background:var(--app-border-strong); background-clip:padding-box; }
.canvas-scroll::-webkit-scrollbar-thumb:hover { border:1px solid transparent; background:var(--app-ink-muted); background-clip:padding-box; }
.canvas-scroll::-webkit-scrollbar-track { background:transparent; }
.canvas-scroll::-webkit-scrollbar-corner { background:var(--app-bg-sunken); }
.canvas-scroll.panning { cursor: grabbing; user-select: none; }
.canvas-stack { position: relative; margin:0; border-radius:0 0 6px 0; box-shadow:0 10px 36px rgba(60,50,30,.22); overflow:hidden; }
.map-canvas, .overlay-canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.region-label-canvas { position:absolute; z-index:2; pointer-events:none; }
.map-canvas {
  background-color: #fff;
  background-image: linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  cursor: default;
}
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
</style>
