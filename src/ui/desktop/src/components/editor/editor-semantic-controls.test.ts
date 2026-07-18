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
  });

  test('keeps confirmed 0718 resource and empty-state interactions explicit', () => {
    assert.match(projectAccessSource, /projectStore\.currentProjectInfo\?\.iconUrl/);
    assert.match(projectAccessSource, /v-if="project\.iconUrl"/);
    assert.match(projectAccessSource, /project-icon-placeholder/);
    assert.match(leftDockSource, /:class="\{ active: entry\.tab === tileTab, unavailable: !entry\.available \}"/);
    assert.doesNotMatch(leftDockSource, /:disabled="!entry\.available/);
    assert.match(leftDockSource, /:class="treeNodeDragClasses\(data\.id\)"/);
    assert.match(leftDockSource, /v-if="!data\.mapFileExists" class="node-missing"/);
    assert.match(mapCanvasEditorSource, /const rows = available \? paletteRowsForTab\(tileTab\.value\) : 4/);
    assert.match(mapCanvasEditorSource, /mapcanvas\.palette\.unconfigured/);
    assert.match(editorViewSource, /cursor:\s*default/);
    assert.doesNotMatch(editorViewSource, /\.map-canvas[^}]+cursor:\s*crosshair/s);
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

  test('shows a projected map tree before committing a custom drag', () => {
    assert.match(leftDockSource, /:data="displayedMapTree"/);
    assert.match(leftDockSource, /@dragstart\.stop="startTreeDrag\(data, \$event\)"/);
    assert.match(leftDockSource, /@dragover\.prevent\.stop="previewTreeDrag\(data, \$event\)"/);
    assert.match(leftDockSource, /projectMapTreeMove\(props\.mapTree, dragSourceId\.value, target\.id, position\)/);
    assert.match(leftDockSource, /treeDropLabel\(data\.id\)/);
    assert.match(leftDockSource, /target\.id === dragSourceId\.value && dragCandidate\.value/);
    assert.match(leftDockSource, /class="map-tree"[\s\S]*@drop\.prevent\.stop="dropTreeNode"/);
    assert.match(leftDockSource, /@dragend\.stop="finishTreeDrag"/);
    assert.doesNotMatch(leftDockSource, /\sdraggable\s*\n\s*highlight-current/);
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
});
