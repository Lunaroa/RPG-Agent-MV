import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const mapPropertiesSource = readFileSync(new URL('./MapPropertiesDialog.vue', import.meta.url), 'utf8');
const eventEditorSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8');
const eventConditionSource = readFileSync(new URL('./EventConditionSelect.vue', import.meta.url), 'utf8');
const eventImagePickerSource = readFileSync(new URL('./EventImagePickerDialog.vue', import.meta.url), 'utf8');
const editorToolbarSource = readFileSync(new URL('./EditorToolbar.vue', import.meta.url), 'utf8');
const leftDockSource = readFileSync(new URL('../layout/LeftDock.vue', import.meta.url), 'utf8');
const editorViewSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');
const mapRendererSource = readFileSync(new URL('../../composables/useMapRenderer.ts', import.meta.url), 'utf8');
const mapCanvasEditorSource = readFileSync(new URL('../../composables/useMapCanvasEditor.ts', import.meta.url), 'utf8');
const projectAccessSource = readFileSync(new URL('../console/ProjectAccessControl.vue', import.meta.url), 'utf8');
const pluginPaneSource = readFileSync(new URL('../console/ConsolePluginsPane.vue', import.meta.url), 'utf8');
const topBarSource = readFileSync(new URL('../layout/TopBar.vue', import.meta.url), 'utf8');

describe('editor semantic controls', () => {
  test('uses multiline resizable controls for map and event notes', () => {
    assert.match(mapPropertiesSource, /v-model="form\.note" type="textarea" :rows="4" resize="vertical"/);
    assert.match(eventEditorSource, /<textarea v-model="draft\.note" rows="2"[^>]+data-ui-id="event-editor-note"/);
    assert.match(eventEditorSource, /max-height:\s*96px/);
    assert.match(eventEditorSource, /class="behavior-groups"/);
    assert.match(eventEditorSource, /data-ui-id="event-editor-trigger"/);
    assert.match(eventEditorSource, /\.ev-settings[^}]+overflow-y:\s*auto/s);
  });

  test('uses a structured encounter list instead of JSON text', () => {
    assert.doesNotMatch(mapPropertiesSource, /encounterListText|encounterListJson/);
    assert.match(mapPropertiesSource, /v-for="\(encounter, encounterIndex\) in form\.encounterList"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.troopId"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.weight"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.regionSet\[regionIndex\]"/);
  });

  test('uses searchable audio catalogs and disables dependent controls', () => {
    assert.match(mapPropertiesSource, /v-model="form\.bgm\.name" filterable clearable :disabled="!form\.autoplayBgm"/);
    assert.match(mapPropertiesSource, /v-model="form\.bgs\.name" filterable clearable :disabled="!form\.autoplayBgs"/);
    assert.match(mapPropertiesSource, /missingAsset/);
    assert.match(mapPropertiesSource, /v-model="form\.parallaxShow" :disabled="!form\.parallaxName"/);
    assert.match(mapPropertiesSource, /v-model="form\.parallaxSx" :disabled="!form\.parallaxLoopX"/);
    assert.match(mapPropertiesSource, /map-properties-dialog \.el-dialog__body[^}]+overflow-y:\s*auto/s);
  });

  test('offers automatic and four manual tile layers to both MV and MZ projects', () => {
    assert.match(editorToolbarSource, /value: 'auto'/);
    assert.match(editorToolbarSource, /\(\[0, 1, 2, 3\] as const\)/);
    assert.match(editorViewSource, /:supports-layer-selection="Boolean\(editorCatalog\)"/);
    assert.match(editorViewSource, /layer\.value = 'auto'/);
    assert.match(editorToolbarSource, /overflow-x:auto/);
    assert.doesNotMatch(editorViewSource, /supports-layer-selection="editorCatalog\?\.engine === 'rpg-maker-mz'"/);
  });

  test('makes event conditions and image selection explicit and keyboard reachable', () => {
    assert.match(eventEditorSource, /class="comparison-operator"[^>]*>≥<\/span>/);
    assert.match(eventConditionSource, /flex:\s*0 0 68px/);
    assert.match(eventEditorSource, /<button[^>]+type="button"[^>]+class="image-preview"[^>]+:aria-label="t\('eventEditorDialog\.imagePicker'\)"/);
    assert.match(eventEditorSource, /@dblclick="openImagePicker"/);
    assert.match(eventEditorSource, /@keydown\.enter\.prevent="openImagePicker"/);
    assert.match(eventEditorSource, /@keydown\.space\.prevent="openImagePicker"/);
    assert.doesNotMatch(eventEditorSource, /class="image-preview"[^>]+@click=/);
    assert.doesNotMatch(eventEditorSource, /class="ev-tool-btn block"[^>]+imagePicker/);
    assert.match(eventImagePickerSource, /paintTileSheet\(\);/);
    assert.match(eventImagePickerSource, /strokeStyle = 'rgba\(0,0,0,\.9\)'/);
  });

  test('keeps editor modes prominent and gives drawing tools distinct icons', () => {
    assert.match(editorToolbarSource, /data-ui-id="editor-mode-map"[^>]+:class="\{ active: mode === 'map' \}"[^>]+:aria-pressed="mode === 'map'"/);
    assert.match(editorToolbarSource, /data-ui-id="editor-mode-event"[^>]+:class="\{ active: mode === 'event' \}"[^>]+:aria-pressed="mode === 'event'"/);
    assert.match(editorToolbarSource, /id: 'pencil'[^\n]+icon: EditPen/);
    assert.match(editorToolbarSource, /id: 'rect'[^\n]+icon: Crop/);
    assert.match(editorToolbarSource, /id: 'ellipse'[^\n]+icon: EllipseToolIcon/);
    assert.match(editorToolbarSource, /class="staging-actions"/);
    assert.match(editorToolbarSource, /data-ui-id="editor-redo"[\s\S]{0,260}<\/template>\s*<div v-if="stagingDirty" class="staging-actions">/);
    assert.doesNotMatch(editorToolbarSource, /\.staging-actions\{[^}]*margin-left:auto/);
    assert.match(editorViewSource, /:staging-dirty="stagingDirty && mode !== 'preview'"/);
    assert.match(editorToolbarSource, /<template v-if="mode === 'map'">/);
    assert.doesNotMatch(editorToolbarSource, /:disabled="mode !== 'map'/);
    assert.match(editorToolbarSource, /\.mode-group button\.active\{[^}]*background:var\(--app-accent\)[^}]*color:#fff/s);
    assert.match(editorToolbarSource, /class="paint-mode-group"/);
    assert.match(editorToolbarSource, /data-ui-id="editor-paint-tile"[^>]*><Brush \/>\{\{ t\('editor\.toolbar\.tile'\) \}\}<\/button>/);
    assert.match(editorToolbarSource, /data-ui-id="editor-paint-shadow"[^>]*><Sunny \/>\{\{ t\('editor\.toolbar\.shadow'\) \}\}<\/button>/);
    assert.match(editorToolbarSource, /:class="\{ active: paintMode !== 'shadow' && tool === entry\.id \}"/);
    assert.doesNotMatch(editorToolbarSource, /shadow-picker|shadowBitsList|update:shadowBits|shadowQuadrants/);
  });

  test('uses one original-style white frame throughout palette interaction', () => {
    assert.match(mapCanvasEditorSource, /function drawPaletteFrame\(/);
    assert.match(mapCanvasEditorSource, /strokeStyle = 'rgba\(17, 17, 17, \.92\)'/);
    assert.match(mapCanvasEditorSource, /strokeStyle = 'rgba\(255, 255, 255, \.99\)'/);
    assert.match(mapCanvasEditorSource, /highlightPaletteHover[\s\S]{0,260}drawPaletteFrame\(/);
    assert.match(mapCanvasEditorSource, /highlightPaletteDrag[\s\S]{0,360}drawPaletteFrame\(/);
    assert.match(mapCanvasEditorSource, /highlightPaletteSelection[\s\S]{0,260}drawPaletteFrame\(/);
    assert.doesNotMatch(mapCanvasEditorSource, /function highlightPaletteHover[\s\S]{0,500}rgba\(255, 230, 89/);
    assert.doesNotMatch(mapCanvasEditorSource, /function highlightPaletteDrag[\s\S]{0,500}rgba\(79, 70, 229, \.18\)|setLineDash\(\[6, 3\]\)/);
  });

  test('keeps confirmed 0718 resource and empty-state interactions explicit', () => {
    assert.match(projectAccessSource, /projectStore\.currentProjectInfo\?\.iconUrl/);
    assert.match(projectAccessSource, /v-if="project\.iconUrl"/);
    assert.match(projectAccessSource, /project-icon-placeholder/);
    assert.match(leftDockSource, /:class="\{ active: entry\.tab === tileTab, unavailable: !entry\.available \}"/);
    assert.doesNotMatch(leftDockSource, /:disabled="!entry\.available/);
    assert.match(leftDockSource, /:class="treeNodeDragClasses\(data\.id\)"/);
    assert.match(leftDockSource, /v-if="!data\.mapFileExists" class="node-missing"/);
    assert.match(mapCanvasEditorSource, /const regionPalette = tileTab\.value === 'R'/);
    assert.match(mapCanvasEditorSource, /MV_REGION_PALETTE_ROWS/);
    assert.match(mapCanvasEditorSource, /mapcanvas\.palette\.unconfigured/);
    assert.match(editorViewSource, /cursor:\s*default/);
    assert.doesNotMatch(editorViewSource, /\.map-canvas[^}]+cursor:\s*crosshair/s);
    assert.match(leftDockSource, /\.palette-canvas[^}]+cursor:\s*default/s);
    assert.doesNotMatch(leftDockSource, /\.palette-canvas[^}]+cursor:\s*crosshair/s);
  });

  test('supports right-drag tile selection without opening a palette context menu', () => {
    assert.match(leftDockSource, /@mouseup="\$emit\('palette-mouseup', \$event\)"/);
    assert.match(leftDockSource, /@contextmenu\.prevent/);
    assert.match(leftDockSource, /'palette-mouseup': \[event: MouseEvent\]/);
    assert.match(mapCanvasEditorSource, /paletteSelectionButton\(event\.button, tileTab\.value === 'R'\)/);
    assert.match(mapCanvasEditorSource, /if \(selectionButton === 2\) event\.preventDefault\(\)/);
    assert.match(mapCanvasEditorSource, /paletteSelectionReleaseMatches\(paletteDragButton, event\.button\)/);
    assert.match(mapCanvasEditorSource, /buildPaletteRectSelection\(/);
  });

  test('replicates the MV R palette as the only region-editing entry point', () => {
    assert.match(mapCanvasEditorSource, /\{ tab: 'R' as const, label: 'R', available: true \}/);
    assert.match(leftDockSource, /tileTab !== 'R'/);
    assert.match(mapCanvasEditorSource, /regionIdForPaletteCell\(cell\.col, cell\.row\)/);
    assert.match(mapCanvasEditorSource, /showRegions: shouldShowRegionOverlay\(options\.mode\.value, options\.paintMode\.value, tileTab\.value, options\.showRegions\.value\)/);
    assert.match(mapCanvasEditorSource, /showRegionLabels: false/);
    assert.doesNotMatch(mapCanvasEditorSource, /drawGrid/);
    assert.match(mapRendererSource, /if \(options\.showGrid\) drawGrid/);
    assert.match(editorViewSource, /class="region-label-canvas"/);
    assert.match(editorViewSource, /\.canvas-scroll::-webkit-scrollbar\s*\{[^}]*width:12px;[^}]*height:12px;/s);
    assert.match(editorViewSource, /\.region-label-canvas\s*\{[^}]*pointer-events:none;/s);
    assert.doesNotMatch(mapCanvasEditorSource, /regionOnly:/);
    assert.doesNotMatch(mapRendererSource, /regionOnly/);
    assert.doesNotMatch(editorToolbarSource, /editor-paint-region|editor-region-id|update:paintMode|update:regionId/);
    assert.match(editorToolbarSource, /v-if="paintMode !== 'region'"[^>]+data-ui-id="editor-overlay-regions"/);
    assert.match(editorToolbarSource, /'update:showRegions':\[boolean\]/);
    assert.match(editorToolbarSource, /class="overlay-group"/);
  });

  test('keeps the plugin search compact and identifies the active project at the top-bar center', () => {
    assert.match(pluginPaneSource, /\.plugin-list-panel :deep\(\.console-search-input\)[^}]+flex:\s*0 0 auto/s);
    assert.match(pluginPaneSource, /\.plugin-list-panel :deep\(\.console-search-input\)[^}]+margin:\s*12px 12px 8px/s);
    assert.match(topBarSource, /data-ui-id="topbar-project-identity"/);
    assert.match(topBarSource, /projectStore\.currentProjectInfo\.iconUrl/);
    assert.match(topBarSource, /projectStore\.currentProjectInfo\.name/);
    assert.match(topBarSource, /\.project-identity[^}]+position:\s*absolute[^}]+left:\s*50%/s);
    assert.match(topBarSource, /transform:\s*translate\(-50%, -50%\)/);
    assert.match(topBarSource, /text-overflow:\s*ellipsis/);
    assert.match(topBarSource, /playtest\.selectRuntime\(result\.runtimeSelectionRequired\)/);
    assert.match(topBarSource, /@contextmenu="openPlaytestRuntimeMenu"/);
    assert.match(topBarSource, /data-ui-id="topbar-playtest-runtime-menu"/);
    assert.match(topBarSource, /playtest\.runtimeInfo\(project\)/);
    assert.match(topBarSource, /reason: 'change'/);
    assert.match(topBarSource, /playtestRuntimeInfo\?\.source === 'project-local'/);
    assert.match(topBarSource, /playtestRuntimeSelecting\.value = true/);
    assert.match(topBarSource, /window\.addEventListener\('blur', onWindowBlur\)/);
  });

  test('links event list navigation, notes, hover preview, and scoped search', () => {
    assert.match(leftDockSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
    assert.match(leftDockSource, /v-if="event\.note" class="event-row-note"/);
    assert.match(leftDockSource, /@mouseenter="\$emit\('hover-event', event\.id\)"/);
    assert.match(leftDockSource, /\$emit\('search-all-maps'\)/);
    assert.match(leftDockSource, /@dblclick="\$emit\('open-search-hit', hit\)"/);
    assert.doesNotMatch(leftDockSource, /@click="\$emit\('open-search-hit', hit\)"/);
    assert.match(editorViewSource, /eventsApi\.search\(trimmed, projectStore\.currentProject, options\)/);
    assert.match(editorViewSource, /eventSearchScope\.value === 'current'/);
    assert.match(mapRendererSource, /hoveredEventId\?: number \| null/);
    assert.match(mapRendererSource, /const EVENT_FRAME_INSET_RATIO = 1 \/ 12/);
    assert.match(mapRendererSource, /const EVENT_HOVER_FILL = 'rgba\(245, 158, 11, \.28\)'/);
    assert.match(mapRendererSource, /context\.lineWidth = 5/);
    assert.match(mapRendererSource, /context\.lineWidth = 3/);
    assert.match(mapRendererSource, /if \(hovered\) drawEventHoverHighlight/);
    assert.doesNotMatch(mapRendererSource, /\[4, 3\]/);
    assert.match(mapRendererSource, /context\.strokeStyle = '#fff'/);
    assert.doesNotMatch(mapRendererSource, /badgeSize/);
  });

  test('uses the Element Plus tree drag contract without custom pointer projection', () => {
    assert.match(leftDockSource, /:data="visibleMapTree"/);
    assert.match(leftDockSource, /:draggable="mapTreeDraggable && !mapTreeSearchActive"/);
    assert.match(leftDockSource, /:allow-drag="allowTreeDrag"/);
    assert.match(leftDockSource, /:allow-drop="allowTreeDrop"/);
    assert.match(leftDockSource, /@node-drop="handleTreeNodeDrop"/);
    assert.match(leftDockSource, /projectMapTreeMove\([\s\S]*props\.mapTree/);
    assert.match(leftDockSource, /type === 'prev'\) return 'before'/);
    assert.match(leftDockSource, /type === 'next'\) return 'after'/);
    assert.match(leftDockSource, /type === 'inner' \? 'inside' : type/);
    assert.doesNotMatch(leftDockSource, /@dragstart|@dragover|@dragend|treeDropLabel|dragCandidate/);
    assert.doesNotMatch(editorViewSource, /mapTree\.value = projection\.tree/);
  });

  test('selects map rows without expanding them and reserves expansion for caret or double click', () => {
    assert.match(leftDockSource, /:expand-on-click-node="false"/);
    assert.match(leftDockSource, /@node-click="handleTreeNodeClick"/);
    assert.match(leftDockSource, /@dblclick\.stop="toggleMapTreeNodeExpansion\(node\)"/);
    assert.match(leftDockSource, /isPrimaryMapTreeNodeClick\(event\?\.detail\)/);
    assert.match(editorViewSource, /mapLoadCoordinator\.begin\(\{ project, mapId \}\)/);
    assert.match(editorViewSource, /:selected-map-id="requestedMapId \?\? selectedMapId"/);
  });

  test('matches MV event-layer and grid semantics across editor modes', () => {
    assert.match(editorViewSource, /const showGrid = ref\(false\)/);
    assert.doesNotMatch(editorViewSource, /showEvents/);
    assert.doesNotMatch(mapCanvasEditorSource, /showEvents/);
    assert.match(mapCanvasEditorSource, /drawMapContent\(context, map,/);
    assert.match(mapCanvasEditorSource, /eventOpacity: eventMode \? 1 : MAP_MODE_EVENT_OPACITY/);
    assert.match(mapCanvasEditorSource, /showGrid: eventMode \|\| options\.showGrid\.value/);
    assert.match(mapCanvasEditorSource, /selectedEventId: eventMode \? options\.selectedEventId\.value : null/);
    assert.match(mapCanvasEditorSource, /hoveredEventId: eventMode \? options\.hoveredEventId\?\.value : null/);
  });

  test('keeps editor and preview surfaces mounted while suspending the warm runtime', () => {
    assert.match(editorViewSource, /<MapRuntimePreview[\s\S]*v-show="mode === 'preview'"/);
    assert.match(editorViewSource, /:key="previewSession\?\.sessionId \|\| 'pending'"/);
    assert.doesNotMatch(editorViewSource, /:key="[^\"]*selectedMapId/);
    assert.match(editorViewSource, /v-show="mode !== 'preview'" class="editor-canvas-layer"/);
    assert.doesNotMatch(editorViewSource, /<MapRuntimePreview[\s\S]{0,120}v-if="mode === 'preview'"/);
    assert.match(editorViewSource, /if \(value === 'preview' \|\| previous === 'preview'\) schedulePreviewIntentReconcile\(\)/);
    assert.match(editorViewSource, /previewIntentCoordinator\.runExclusive\(token,/);
    assert.match(editorViewSource, /mapPreview\.resume\([\s\S]{0,220}intent\.mapRevision/);
    assert.match(editorViewSource, /frame\.operationId !== previewSession\.value\.operationId/);
    assert.match(editorViewSource, /frame\.mapId !== selectedMapId\.value/);
    assert.match(mapCanvasEditorSource, /function setCanvasElement[\s\S]{0,180}if \(canvas\) renderMap\(\)/);
    assert.match(mapCanvasEditorSource, /function setOverlayElement[\s\S]{0,180}if \(canvas\) renderOverlay\(\)/);
  });
});
