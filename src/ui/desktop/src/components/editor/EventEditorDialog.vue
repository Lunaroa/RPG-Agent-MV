<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" :class="{ modeless }" data-ui-id="event-editor-overlay" :data-editor-dialog-layer="LAYER_Z.eventEditor" @mousedown.self="onOverlayMouseDown">
      <section ref="modalRef" class="ev-modal editor-modal-shell" data-ui-id="event-editor-dialog" role="dialog" :aria-modal="!modeless" aria-labelledby="event-editor-title" :style="dialogStyle">
        <header class="ev-title-bar editor-modal-header" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
          <h3 id="event-editor-title" class="editor-modal-title">{{ eventEditorTitle }}</h3>
          <button type="button" class="editor-modal-close" data-ui-id="event-editor-close" :aria-label="t('eventEditorDialog.closeTitle')" :title="t('eventcmd.close')" @click="requestClose">×</button>
        </header>
        <template v-if="draft">
          <div class="ev-meta-bar">
            <div class="ev-meta-fields">
              <label class="ev-stack-field name"><span>{{ t('commonEvent.name') }}</span><input v-model="draft.name" data-ui-id="event-editor-name" :disabled="shellLocked" @input="markDirty" /></label>
              <label class="ev-stack-field note"><span>{{ t('eventEditorDialog.note') }}</span><input v-model="draft.note" data-ui-id="event-editor-note" :disabled="shellLocked" @input="markDirty" /></label>
              <label class="ev-stack-field coord"><span>X</span><input v-model.number="draft.x" data-ui-id="event-editor-x" :disabled="shellLocked" type="number" min="0" @input="markDirty" /></label>
              <label class="ev-stack-field coord"><span>Y</span><input v-model.number="draft.y" data-ui-id="event-editor-y" :disabled="shellLocked" type="number" min="0" @input="markDirty" /></label>
            </div>
            <div class="ev-toolbar-group page-tools" :aria-label="t('eventEditorDialog.pageActions')">
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-add" @click="addPage">{{ t('eventEditorDialog.newPage') }}</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-copy" @click="copyPage">{{ t('eventEditorDialog.copyPage') }}</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-paste" :disabled="!pageClipboard" @click="pastePage">{{ t('eventEditorDialog.pastePage') }}</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-page-clear" :disabled="currentPageLocked" @click="clearPage">{{ t('eventEditorDialog.clearPage') }}</button>
              <button type="button" class="ev-tool-btn danger" data-ui-id="event-editor-page-delete" :disabled="currentPageLocked || draft.pages.length <= 1" @click="deletePage">{{ t('eventEditorDialog.deletePage') }}</button>
            </div>
          </div>
          <div v-if="shellLocked || currentPageLocked" class="ev-lock-banner">
            {{ currentPageLocked ? t('eventEditorDialog.protectedPage') : t('eventEditorDialog.protectedFields') }}
          </div>
          <nav class="ev-page-tabs" :aria-label="t('eventEditorDialog.eventPages')">
            <button
              v-for="(_, index) in draft.pages"
              :key="index"
              type="button"
              :class="{ active: pageIndex === index }"
              @click="pageIndex = index"
            >{{ index + 1 }}{{ pageIdentities[index]?.origin === 'baseline' ? t('eventEditorDialog.locked') : '' }}</button>
          </nav>
          <div v-if="currentPage" class="ev-main-grid">
            <aside class="ev-settings">
              <fieldset class="ev-group conditions-group" :disabled="currentPageLocked">
                <legend>{{ t('eventEditorDialog.conditions') }}</legend>
                <ConditionSelect v-model:valid="currentPage.conditions.switch1Valid" v-model:value="currentPage.conditions.switch1Id" :label="t('mapPreview.switch')" :options="catalog?.switches || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.switch2Valid" v-model:value="currentPage.conditions.switch2Id" :label="t('mapPreview.switch')" :options="catalog?.switches || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.variableValid" v-model:value="currentPage.conditions.variableId" :label="t('mapPreview.variable')" :options="catalog?.variables || []" @change="markDirty"><span class="comparison-operator" aria-hidden="true">≥</span><input :value="currentPage.conditions.variableValid ? currentPage.conditions.variableValue : ''" class="mini-input" type="number" :disabled="!currentPage.conditions.variableValid" @input="setVariableConditionValue" /></ConditionSelect>
                <label class="ev-cond-row"><input v-model="currentPage.conditions.selfSwitchValid" type="checkbox" @change="markDirty" /><span>{{ t('mapPreview.selfSwitch') }}</span><select :value="currentPage.conditions.selfSwitchValid ? currentPage.conditions.selfSwitchCh : ''" :disabled="!currentPage.conditions.selfSwitchValid" @change="setSelfSwitchCondition"><option value="" disabled>...</option><option v-for="ch in SELF_SWITCH_CHANNELS" :key="ch">{{ ch }}</option></select></label>
                <ConditionSelect v-model:valid="currentPage.conditions.actorValid" v-model:value="currentPage.conditions.actorId" :label="t('mapPreview.actor')" :options="catalog?.actors || []" @change="markDirty" />
                <ConditionSelect v-model:valid="currentPage.conditions.itemValid" v-model:value="currentPage.conditions.itemId" :label="t('mapPreview.item')" :options="catalog?.items || []" @change="markDirty" />
              </fieldset>
              <fieldset class="ev-group image-group" :disabled="currentPageLocked">
                <legend>{{ t('eventEditorDialog.image') }}</legend>
                <button
                  type="button"
                  class="image-preview"
                  :aria-label="t('eventEditorDialog.imagePicker')"
                  :title="t('eventEditorDialog.imagePicker')"
                  @dblclick="openImagePicker"
                  @keydown.enter.prevent="openImagePicker"
                  @keydown.space.prevent="openImagePicker"
                >
                  <canvas ref="previewCanvas" width="78" height="108" />
                </button>
                <span class="image-caption">{{ localizedImageSummary(currentPage.image) }}</span>
              </fieldset>
              <fieldset class="ev-group move-group" :disabled="currentPageLocked">
                <legend>{{ t('eventEditorDialog.autonomousMovement') }}</legend>
                <label class="ev-select-row"><span>{{ t('eventEditorDialog.type') }}</span><select v-model.number="currentPage.moveType" @change="markDirty"><option v-for="[value, label] in localizedMoveTypes" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                <button type="button" class="ev-tool-btn block" :disabled="currentPage.moveType !== 3" @click="routeDialog?.open(currentPage.moveRoute)">{{ t('eventEditorDialog.route') }}</button>
                <div class="mini-grid">
                  <label class="ev-select-row"><span>{{ t('moveRoute.speed') }}</span><select v-model.number="currentPage.moveSpeed" @change="markDirty"><option v-for="[value, label] in localizedMoveSpeeds" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                  <label class="ev-select-row"><span>{{ t('moveRoute.frequency') }}</span><select v-model.number="currentPage.moveFrequency" @change="markDirty"><option v-for="[value, label] in localizedMoveFreqs" :key="value" :value="Number(value)">{{ label }}</option></select></label>
                </div>
              </fieldset>
              <fieldset class="ev-group options-group" :disabled="currentPageLocked">
                <legend>{{ t('eventEditorDialog.options') }}</legend>
                <label v-for="[key, label] in pageOptions" :key="key" class="ev-check"><input v-model="currentPage[key]" type="checkbox" @change="markDirty" />{{ label }}</label>
              </fieldset>
              <div class="behavior-groups">
                <fieldset class="ev-group priority-group" :disabled="currentPageLocked">
                  <legend>{{ t('eventEditorDialog.priority') }}</legend>
                  <select v-model.number="currentPage.priorityType" @change="markDirty"><option v-for="[value, label] in localizedPriorities" :key="value" :value="Number(value)">{{ label }}</option></select>
                </fieldset>
                <fieldset class="ev-group trigger-group" :disabled="currentPageLocked">
                  <legend>{{ t('commonEvent.trigger') }}</legend>
                  <select v-model.number="currentPage.trigger" data-ui-id="event-editor-trigger" @change="markDirty"><option v-for="[value, label] in localizedTriggers" :key="value" :value="Number(value)">{{ label }}</option></select>
                </fieldset>
              </div>
            </aside>
            <section class="ev-commands" :class="{ locked: currentPageLocked, searching: findOpen }">
              <strong class="ev-cmd-title">{{ t('commonEvent.contents') }}</strong>
              <div v-if="findOpen" class="command-find" role="search" :aria-label="t('cmdList.find')">
                <input
                  ref="findInputRef"
                  v-model="findQuery"
                  type="search"
                  autocomplete="off"
                  :placeholder="t('cmdList.findPlaceholder')"
                  :aria-label="t('cmdList.findPlaceholder')"
                />
                <span class="command-find-status" role="status">
                  {{ findQuery.trim() ? (findMatches.length ? t('cmdList.findCount', { current: findCursor + 1, total: findMatches.length }) : t('cmdList.findNoResults')) : t('cmdList.findCount', { current: 0, total: 0 }) }}
                </span>
                <button type="button" :disabled="!findMatches.length" :aria-label="t('cmdList.findPrevious')" :title="t('cmdList.findPrevious')" @click="moveFind(-1)">↑</button>
                <button type="button" :disabled="!findMatches.length" :aria-label="t('cmdList.findNext')" :title="t('cmdList.findNext')" @click="moveFind(1)">↓</button>
                <button type="button" :aria-label="t('cmdList.findClose')" :title="t('cmdList.findClose')" @click="closeFind">×</button>
              </div>
              <div ref="listHost" class="command-list" @scroll.passive="onListScroll" @contextmenu.prevent="openCommandContext($event, null)">
                <div v-if="!spans.length" class="command-empty">
                  {{ t('eventEditorDialog.emptyHint') }}
                </div>
                <div class="cmd-virtual-pad" :style="{ height: `${virtualWindow.top}px` }" />
                <template v-for="row in virtualWindow.rows" :key="row.key">
                  <button
                    v-if="row.kind === 'blank'"
                    type="button"
                    :disabled="currentPageLocked"
                    class="cmd-row cmd-blank"
                    :no="row.no + 1"
                    :class="{
                      even: row.no % 2 == 0,
                      terminator: row.slot.spanIndex === spans.length,
                      'block-bottom': row.slot.blockBottom, 
                      focused: insertionFocus === row.slot.spanIndex,
                      'drop-before': dropIndicator === row.slot.spanIndex,
                      selected: slotSelected(row.slot)
                    }"
                    :style="{ '--cmd-indent': `${Math.min(row.slot.indent, 8) * 18}px` }"
                    :aria-label="t('eventEditorDialog.newCmd')"
                    :draggable="false"
                    @focus="focusInsertionSlot(row.slot)"
                    @click.stop="focusInsertionSlot(row.slot)"
                    @dblclick.stop.prevent="openCommandPickerAt(row.slot)"
                    @contextmenu.stop.prevent="openCommandContext($event, null, row.slot)"
                    @dragover.prevent="onInsertionDragOver(row.slot.spanIndex, $event)"
                    @drop.prevent="onRowDrop"
                  ><span class="cmd-line"></span></button>
                  <button
                    v-else
                    type="button"
                    :disabled="currentPageLocked"
                    class="cmd-row"
                    :no="row.no + 1"
                    :class="{
                      even: row.no % 2 == 0,
                      selected: selectedSpanSet.has(row.index),
                      'find-hit': activeFindSpanIndex === row.index,
                      'drop-before': dropIndicator === row.index, 
                      [`tone-${row.view.tone}`]: true, 
                      [`role-${row.view.role}`]: true
                    }"
                    :data-command-span="row.index"
                    :style="{ '--cmd-indent': `${Math.min(row.view.indent, 8) * 18}px` }"
                    :aria-pressed="selectedSpanSet.has(row.index)"
                    :draggable="!currentPageLocked"
                    @click="selectCommand(row.index, $event)"
                    @dblclick="openCommand(row.index)"
                    @contextmenu.stop.prevent="openCommandContext($event, row.index)"
                    @dragstart="onRowDragStart(row.index, $event)"
                    @dragover.prevent="onRowDragOver(row.index, $event)"
                    @drop.prevent="onRowDrop"
                    @dragend="resetRowDrag"
                  ><span
                    v-if="row.view.role === 'head'"
                    class="cmd-caret"
                    :class="{ collapsed: collapsedStructureHeads.has(row.index) }"
                    role="button"
                    :aria-label="collapsedStructureHeads.has(row.index) ? t('eventEditorDialog.expandBlock') : t('eventEditorDialog.collapseBlock')"
                    @click.stop="toggleStructureCollapse(row.index)"
                    @dblclick.stop
                  />
                  <span v-if="pluginColorForSpan(row.index)" class="cmd-plugin-stripe" :style="{ background: pluginColorForSpan(row.index) }" />
                  <span class="cmd-line cmd-head">{{ row.view.head }}</span>
                  <span v-if="row.view.lines.length > 1" class="cmd-line cmd-sub cmd-descriptions" :class="{
                      'is-table': row.view.lines[0].split('=').length > 1,
                      'is-many': row.view.lines.length > 4
                    }">
                    <template v-for="(line, lineIndex) in row.view.lines" :key="lineIndex">
                      <div class="cmd-description-item" v-if="line.split('=').length == 1">
                        <div class="cmd-description-content">{{ line }}</div>
                      </div>
                      <div class="cmd-description-item" v-else>
                        <div class="cmd-description-label">{{ line.split('=')[0].trim() }}</div>
                        <div class="cmd-description-value">{{ line.split('=')[1].trim() }}</div>
                      </div>
                    </template>
                  </span>
                  <template v-else>
                    <span v-for="(line, lineIndex) in row.view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span>
                  </template>
                </button>
                </template>
                <div class="cmd-virtual-pad" :style="{ height: `${virtualWindow.bottom}px` }" />
              </div>
            </section>
          </div>
          <footer class="ev-footer">
            <span class="ev-save-status">{{ dirty ? t('eventEditorDialog.unsavedChanges') : t('eventEditorDialog.savedToStaging') }}</span>
            <div class="ev-footer-actions">
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-cancel" @click="requestClose">{{ t('eventcmd.cancel') }}</button>
              <button type="button" class="ev-tool-btn" data-ui-id="event-editor-apply" :disabled="!dirty || saving" @click="$emit('save', false)">{{ saving ? t('ui.saving') : t('eventEditorDialog.apply') }}</button>
              <button type="button" class="ev-tool-btn primary" data-ui-id="event-editor-ok" :disabled="!dirty || saving" @click="$emit('save', true)">{{ saving ? t('ui.saving') : t('eventcmd.ok') }}</button>
            </div>
          </footer>
        </template>
        <span class="dialog-resize-handle" role="separator" :aria-label="t('eventcmd.resizeHandle')" :title="t('eventcmd.resizeHandle')" @pointerdown.prevent="onEditorResizeStart" @pointermove="onEditorResizeMove" @pointerup="onEditorResizeEnd" @pointercancel="onEditorResizeEnd" @dblclick="resetEditorDialogSize" />
      </section>
      <div v-if="cmdContext.visible" class="cmd-context-mask" @mousedown.self="closeCommandContext" @contextmenu.self.prevent="closeCommandContext">
        <ul class="cmd-context-menu" :style="{ left: `${cmdContext.x}px`, top: `${cmdContext.y}px` }" role="menu" :aria-label="t('eventEditorDialog.commandActions')">
          <li><button type="button" @click="runCommandMenu(openCommandPicker)">{{ t('eventEditorDialog.newCmd') }}<span>Enter</span></button></li>
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(openSelectedCommand)">{{ t('eventEditorDialog.editCmd') }}<span>Space</span></button></li>
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(() => moveSelectedCommandBlock(-1))">{{ t('cmdList.moveUp') }}<span>Alt+↑</span></button></li>
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(() => moveSelectedCommandBlock(1))">{{ t('cmdList.moveDown') }}<span>Alt+↓</span></button></li>
          <li v-if="!cmdContext.onSlot" class="separator" />
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(cutSelectedCommands)">{{ t('eventEditorDialog.cut') }}<span>Ctrl+X</span></button></li>
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(() => copySelectedCommands())">{{ t('eventEditorDialog.copy') }}<span>Ctrl+C</span></button></li>
          <li><button type="button" :disabled="!commandClipboard" @click="runCommandMenu(pasteSelectedCommand)">{{ t('eventEditorDialog.paste') }}<span>Ctrl+V</span></button></li>
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(deleteSelectedCommands)">{{ t('cmdList.delete') }}<span>Del</span></button></li>
          <li v-if="!cmdContext.onSlot" class="separator" />
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="!spans.length" @click="runCommandMenu(selectAllCommands)">{{ t('eventEditorDialog.selectAll') }}<span>Ctrl+A</span></button></li>
          <li v-if="!cmdContext.onSlot" class="separator" />
          <li v-if="!cmdContext.onSlot"><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(copySelectedCommandsAsText)">{{ t('eventEditorDialog.copyAsText') }}</button></li>
          <li><button type="button" :disabled="currentPageLocked" @click="runCommandMenu(openPasteCommandsFromText)">{{ t('eventEditorDialog.pasteFromText') }}</button></li>
        </ul>
      </div>
    </div>
  </teleport>
  <EventImagePickerDialog ref="imagePicker" :catalog="catalog" :tileset-images="tilesetImages" :load-image="loadImage" @commit="setImage" />
  <MoveRouteDialog ref="routeDialog" :preview-x="draft?.x" :preview-y="draft?.y" :catalog="catalog" @commit="setPageRoute" />
  <EventCommandDialog ref="commandDialog" :map-id="mapId" :catalog="catalog" :load-image="loadImage" :event-x="draft?.x" :event-y="draft?.y" :current-events="currentEvents" @commit="commitCommand" @catalog-changed="emit('catalog-changed')" />
  <EventTextPasteDialog ref="textPasteDialog" @confirm="applyPastedCommandsText" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { confirmAboveModal } from '../../utils/confirmAboveModal';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { clipboard as clipboardApi, projectConfig as projectConfigApi, type EditorProjectCatalog, type StoryEventOverview, type StoryEventPageOverview } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { commandDefinition, normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import ConditionSelect from './EventConditionSelect.vue';
import EventCommandDialog from './EventCommandDialog.vue';
import EventImagePickerDialog from './EventImagePickerDialog.vue';
import EventTextPasteDialog from './EventTextPasteDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';
import { SELF_SWITCH_CHANNELS, clone, commandBlockSpanIndices, commandBranchScope, commandInsertionSlots, commandSpanDisplay, commandStructureBlocks, defaultPage, dropCommandSpanBlocks, editableCommandSpans, ensureTerminator, imageSummary, moveCommandSpanBlock, skipTerminatorIndices, type MvCommandInsertionSlot, type MvCommandSpanView, type MvEditorEvent, type MvEventImage, type MvEventPage, type MvMoveRoute, type MvCommand } from '../../composables/useEventEditor';
import { drawTile, eventCharacterFrame } from '../../composables/useMapRenderer';
import { eventEditorText } from '../../utils/eventEditorLocalization';
import { resolvePluginColor } from '../../utils/pluginColor';
import { findCommandSpanIndices, nextCommandFindCursor } from '../console/command-list-find';
import type { EditorEventListItem } from './editorTypes';
const props = withDefaults(defineProps<{ visible: boolean; draft: MvEditorEvent | null; saving: boolean; mapId: number | null; systemData: { switches: string[]; variables: string[] } | null; catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; loadImage: (url: string) => Promise<HTMLImageElement | null>; overview?: StoryEventOverview | null; currentEvents?: EditorEventListItem[]; modeless?: boolean }>(), { currentEvents: () => [], modeless: false });
const emit = defineEmits<{ close: []; save: [closeAfterSave: boolean]; 'catalog-changed': [] }>();
const { language, t } = useI18n();
const projectStore = useProjectStore();
const eventEditorZ = String(LAYER_Z.eventEditor);
const dirty = ref(false), closing = ref(false), pageIndex = ref(0), selectedSpans = ref<number[]>([]), selectionAnchor = ref<number | null>(null), insertionFocus = ref<number | null>(null), pageClipboard = ref<MvEventPage | null>(null), commandClipboard = ref<MvCommand[] | null>(null);
const findOpen = ref(false), findQuery = ref(''), findCursor = ref(-1), findInputRef = ref<HTMLInputElement | null>(null), findTemporarilyExpandedHeads = ref<Set<number>>(new Set());
const pageIdentities = ref<Array<StoryEventPageOverview | undefined>>([]);
const modalRef = ref<HTMLElement>(), previewCanvas = ref<HTMLCanvasElement>(), imagePicker = ref<InstanceType<typeof EventImagePickerDialog>>(), routeDialog = ref<InstanceType<typeof MoveRouteDialog>>(), commandDialog = ref<InstanceType<typeof EventCommandDialog>>(), textPasteDialog = ref<InstanceType<typeof EventTextPasteDialog>>();
// RM-style title-bar drag. The offset is session-less: it resets on close so the
// dialog always reopens centered.
const dragOffset = ref<{ x: number; y: number } | null>(null);
let dragStart: { x: number; y: number; ox: number; oy: number; pointer: number } | null = null;
// dialogStyle (declared after the resize block) merges the drag transform with
// an optional resized width/height; the template binds it.
function onDragStart(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
  const offset = dragOffset.value || { x: 0, y: 0 };
  dragStart = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y, pointer: event.pointerId };
  // Pointer capture keeps move events flowing while the cursor leaves the bar.
  // It throws for synthetic pointers (no active pointer), so guard it.
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
}
function onDragMove(event: PointerEvent) {
  if (dragStart?.pointer !== event.pointerId) return;
  const shell = modalRef.value;
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  const current = dragOffset.value || { x: 0, y: 0 };
  const baseLeft = rect.left - current.x, baseTop = rect.top - current.y;
  // Keep the title bar reachable: never above the viewport, always 48px visible.
  const minVisible = 48;
  const nx = Math.min(Math.max(dragStart.ox + (event.clientX - dragStart.x), minVisible - baseLeft - rect.width), window.innerWidth - baseLeft - minVisible);
  const ny = Math.min(Math.max(dragStart.oy + (event.clientY - dragStart.y), -baseTop), window.innerHeight - baseTop - minVisible);
  dragOffset.value = { x: Math.round(nx), y: Math.round(ny) };
}
function onDragEnd(event: PointerEvent) { if (dragStart?.pointer === event.pointerId) dragStart = null; }
// Optional dialog resize handle. Unlike EventCommandDialog (which assumes the
// overlay keeps the shell centered and so applies half the drag delta), this
// dialog can be title-bar dragged via transform, so the centering assumption
// does not hold — apply the full delta instead.
const EDITOR_SIZE_KEY = 'rpgmv.eventEditorDialogSize';
const editorDialogSize = ref<{ w: number; h: number } | null>(null);
let editorResizeStart: { x: number; y: number; w: number; h: number; pointer: number } | null = null;
const clampEditorW = (w: number) => Math.round(Math.max(640, Math.min(window.innerWidth - 32, w)));
const clampEditorH = (h: number) => Math.round(Math.max(420, Math.min(window.innerHeight - 32, h)));
function loadEditorDialogSize() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EDITOR_SIZE_KEY) || 'null');
    editorDialogSize.value = parsed && Number.isFinite(parsed.w) && Number.isFinite(parsed.h)
      ? { w: clampEditorW(parsed.w), h: clampEditorH(parsed.h) }
      : null;
  } catch { editorDialogSize.value = null; }
}
function saveEditorDialogSize() {
  try {
    if (editorDialogSize.value) localStorage.setItem(EDITOR_SIZE_KEY, JSON.stringify(editorDialogSize.value));
    else localStorage.removeItem(EDITOR_SIZE_KEY);
  } catch { /* persistence is best-effort */ }
}
function resetEditorDialogSize() { editorDialogSize.value = null; saveEditorDialogSize(); }
function onEditorResizeStart(event: PointerEvent) {
  const rect = modalRef.value?.getBoundingClientRect();
  if (!rect) return;
  editorResizeStart = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, pointer: event.pointerId };
  editorDialogSize.value = { w: Math.round(rect.width), h: Math.round(rect.height) };
  try { (event.target as HTMLElement).setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
}
function onEditorResizeMove(event: PointerEvent) {
  if (editorResizeStart?.pointer !== event.pointerId) return;
  editorDialogSize.value = {
    w: clampEditorW(editorResizeStart.w + (event.clientX - editorResizeStart.x)),
    h: clampEditorH(editorResizeStart.h + (event.clientY - editorResizeStart.y)),
  };
}
function onEditorResizeEnd(event: PointerEvent) {
  if (editorResizeStart?.pointer !== event.pointerId) return;
  editorResizeStart = null;
  saveEditorDialogSize();
}
const dialogStyle = computed(() => ({
  ...(editorDialogSize.value ? { width: `${editorDialogSize.value.w}px`, height: `${editorDialogSize.value.h}px` } : {}),
  ...(dragOffset.value ? { transform: `translate(${dragOffset.value.x}px, ${dragOffset.value.y}px)` } : {}),
}));
function onOverlayMouseDown() { if (!props.modeless) void requestClose(); }
const currentPage = computed(() => props.draft?.pages[pageIndex.value] || null), spans = computed(() => currentPage.value ? editableCommandSpans(currentPage.value) : []);
/** Per-plugin color overrides from .luna_rpg/config.json — drives the stripe on 356/357 rows. */
const pluginColors = ref<Record<string, string>>({});
async function loadPluginColors() {
  const project = projectStore.currentProject;
  if (!project) { pluginColors.value = {}; return; }
  try {
    const config = await projectConfigApi.get(project);
    if (projectStore.currentProject === project) pluginColors.value = config.pluginColors || {};
  } catch {
    if (projectStore.currentProject === project) pluginColors.value = {};
  }
}
watch(() => projectStore.currentProject, () => { void loadPluginColors(); });
void loadPluginColors();
/** Extract the plugin name from a 356 (MV) or 357 (MZ) plugin command for color lookup. */
function pluginNameOf(command: MvCommand | undefined): string {
  if (!command) return '';
  if (command.code === 357) return String(command.parameters[0] ?? '');
  if (command.code === 356) return String(command.parameters[0] ?? '').split(/\s+/).filter(Boolean)[0] || '';
  return '';
}
/** Resolve the stripe color for a given span (head command), or '' when it is not a plugin command. */
function pluginColorForSpan(spanIndex: number): string {
  const span = spans.value[spanIndex];
  const name = pluginNameOf(span?.commands[0]);
  return name ? resolvePluginColor(name, pluginColors.value) : '';
}
const skipTerminatorSet = computed(() => currentPage.value ? skipTerminatorIndices(currentPage.value.list) : new Set<number>());
const insertionSlots = computed(() => currentPage.value ? commandInsertionSlots(currentPage.value.list, spans.value) : []);
const spanViews = computed<MvCommandSpanView[]>(() => spans.value.map((span) => buildSpanView(span)));
const findMatches = computed(() => findCommandSpanIndices(spanViews.value, findQuery.value));
const activeFindSpanIndex = computed(() => {
  const cursor = findCursor.value;
  return cursor >= 0 ? findMatches.value[cursor] ?? null : null;
});
// Structure-block collapse: keyed by the head span index. While a block is
// collapsed every span after its head up to the terminator is hidden together
// with the insertion slots inside the body, leaving the head row as handle.
const collapsedStructureHeads = ref<Set<number>>(new Set());
const collapsedHiddenSpans = computed(() => {
  const hidden = new Set<number>();
  if (!collapsedStructureHeads.value.size) return hidden;
  for (const block of commandStructureBlocks(spans.value)) {
    if (!collapsedStructureHeads.value.has(block.headSpanIndex) || findTemporarilyExpandedHeads.value.has(block.headSpanIndex)) continue;
    for (let index = block.headSpanIndex + 1; index <= block.endSpanIndex; index += 1) hidden.add(index);
  }
  return hidden;
});
function toggleStructureCollapse(headSpanIndex: number) {
  const next = new Set(collapsedStructureHeads.value);
  if (next.has(headSpanIndex)) next.delete(headSpanIndex);
  else next.add(headSpanIndex);
  collapsedStructureHeads.value = next;
  if (findTemporarilyExpandedHeads.value.has(headSpanIndex)) {
    const revealed = new Set(findTemporarilyExpandedHeads.value);
    revealed.delete(headSpanIndex);
    findTemporarilyExpandedHeads.value = revealed;
  }
  // A focused insertion slot swallowed by the newly collapsed body is invisible;
  // drop it so Enter/new-command cannot target the hidden region.
  if (insertionFocus.value != null && collapsedHiddenSpans.value.has(insertionFocus.value)) insertionFocus.value = null;
}
/** Remap insertion targets inside a collapsed block to the visible boundary right after it. */
function visibleInsertionTarget(index: number): number {
  if (!collapsedHiddenSpans.value.has(index)) return index;
  for (const block of commandStructureBlocks(spans.value)) {
    if (collapsedStructureHeads.value.has(block.headSpanIndex) && index > block.headSpanIndex && index <= block.endSpanIndex) {
      return block.endSpanIndex + 1;
    }
  }
  return index;
}
watch(spans, (nextSpans) => {
  if (!collapsedStructureHeads.value.size) return;
  const valid = new Set<number>();
  for (const head of collapsedStructureHeads.value) {
    if (head < nextSpans.length && nextSpans[head]?.role === 'head') valid.add(head);
  }
  if (valid.size !== collapsedStructureHeads.value.size) collapsedStructureHeads.value = valid;
});
watch(findMatches, (matches) => {
  findCursor.value = matches.length ? 0 : -1;
  if (findOpen.value && matches.length) void nextTick(() => scrollToFindMatch(matches[0]!));
});
// Virtualized command list. Every span row has a deterministic height
// (line-height 20px per command line + 8px row chrome), so we window by
// prefix-summed pixel offsets and only localize the spans in the viewport.
const CMD_LINE_H = 20, CMD_ROW_CHROME = 8, CMD_BLANK_H = 22, CMD_OVERSCAN = 8;
const listHost = ref<HTMLElement>();
const listScrollTop = ref(0), listViewportH = ref(0);
function buildSpanView(span: Parameters<typeof commandSpanDisplay>[0]): MvCommandSpanView {
  const view = commandSpanDisplay(
    span,
    props.systemData,
    language.value,
    skipTerminatorSet.value.has(span.index),
    t('eventEditor.command.skipEnd'),
  );
  // The ::before rules below already draw the RM markers (◆ for command heads,
  // ':' for branch/continuation lines). The shared display labels embed the same
  // glyphs for the marker-less console list, so strip them here or every row
  // shows the marker twice (the CSS glyph plus the label glyph).
  return {
    ...view,
    head: view.head.replace(/^(?:\u25C6\s*|[:\uFF1A]\s?)/, ''),
    lines: view.lines.map((line) => line.replace(/^[:\uFF1A]\s?/, '')),
  };
}
type CommandRenderRow =
  | { kind: 'blank'; no: number; key: string; slot: MvCommandInsertionSlot }
  | { kind: 'command'; no: number; key: string; index: number; view: MvCommandSpanView };
const commandRows = computed<CommandRenderRow[]>(() => {
  const rows: CommandRenderRow[] = [];
  const hidden = collapsedHiddenSpans.value;
  const slots = insertionSlots.value;
  const slotBySpanIndex = new Map<number, MvCommandInsertionSlot>();
  for (const slot of slots) slotBySpanIndex.set(slot.spanIndex, slot);

  let no = 0;
  for (let i = 0; i < spans.value.length; i += 1) {
    const slot = slotBySpanIndex.get(i);

    // blockBottom 空行：占一个行号槽，隐藏时不 push 但仍然占号
    if (slot && slot.blockBottom) {
      if (!hidden.has(i)) rows.push({ kind: 'blank', key: slot.key, no, slot });
      no += 1;
    }

    // span 命令：占一个行号槽，隐藏时不 push 但仍然占号
    if (!hidden.has(i)) {
      const span = spans.value[i];
      rows.push({ kind: 'command', key: `command:${span.index}`, no, index: i, view: spanViews.value[i] || buildSpanView(span) });
    }
    no += 1;

    // 折叠头本身：折叠时 head 可见，但它下面隐藏的 blank/ span 都要正确跳过 no —— 已由上面的无条件 no+=1 保证
  }

  const tail = slotBySpanIndex.get(spans.value.length);
  if (tail) rows.push({ kind: 'blank', key: tail.key, no, slot: tail });

  return rows;
});


function commandRowHeight(row: CommandRenderRow): number {
  if (row.kind === 'blank') {
    return CMD_BLANK_H;
  }
  return row.view.lines.length * CMD_LINE_H + CMD_LINE_H + CMD_ROW_CHROME;
}
// rowOffsets[i] is the pixel top of rendered row i; the final entry is total height.
const rowOffsets = computed(() => {
  const offsets = new Array<number>(commandRows.value.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < commandRows.value.length; index += 1) {
    offsets[index + 1] = offsets[index] + commandRowHeight(commandRows.value[index]);
  }
  return offsets;
});
// Last rendered row whose top offset is at or before `y`.
function rowAtOffset(y: number): number {
  const offsets = rowOffsets.value;
  let lo = 0, hi = commandRows.value.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
const virtualWindow = computed(() => {
  const total = commandRows.value.length;
  const offsets = rowOffsets.value;
  const totalHeight = offsets[total];
  const rows: CommandRenderRow[] = [];
  if (!total) return { rows, top: 0, bottom: 0 };
  const viewport = listViewportH.value || 400;
  const top = Math.max(0, Math.min(listScrollTop.value, Math.max(0, totalHeight - viewport)));
  let start = rowAtOffset(top) - CMD_OVERSCAN;
  if (start < 0) start = 0;
  let end = rowAtOffset(top + viewport) + CMD_OVERSCAN + 1;
  if (end > total) end = total;
  for (let index = start; index < end; index += 1) {
    rows.push(commandRows.value[index]);
  }
  return { rows, top: offsets[start], bottom: totalHeight - offsets[end] };
});
function onListScroll() { if (listHost.value) listScrollTop.value = listHost.value.scrollTop; }
function measureListViewport() { if (listHost.value) listViewportH.value = listHost.value.clientHeight; }
// Scroll the container so span `index` is visible, without relying on a rendered node.
function scrollSpanIntoView(index: number) {
  const host = listHost.value;
  if (!host) return;
  const offsets = rowOffsets.value;
  const rowIndex = commandRows.value.findIndex((row) => row.kind === 'command' && row.index === index);
  if (rowIndex < 0) return;
  const top = offsets[rowIndex] ?? 0, bottom = offsets[rowIndex + 1] ?? top;
  if (top < host.scrollTop) host.scrollTop = top;
  else if (bottom > host.scrollTop + host.clientHeight) host.scrollTop = bottom - host.clientHeight;
  listScrollTop.value = host.scrollTop;
}
function revealFindMatch(index: number): void {
  const next = new Set(findTemporarilyExpandedHeads.value);
  for (const block of commandStructureBlocks(spans.value)) {
    if (index <= block.headSpanIndex || index > block.endSpanIndex) continue;
    if (collapsedStructureHeads.value.has(block.headSpanIndex)) next.add(block.headSpanIndex);
  }
  if (next.size !== findTemporarilyExpandedHeads.value.size) findTemporarilyExpandedHeads.value = next;
}
async function scrollToFindMatch(index: number): Promise<void> {
  revealFindMatch(index);
  await nextTick();
  scrollSpanIntoView(index);
}
function openFind(): void {
  findOpen.value = true;
  findCursor.value = findMatches.value.length ? 0 : -1;
  void nextTick(() => {
    findInputRef.value?.focus();
    findInputRef.value?.select();
    const index = activeFindSpanIndex.value;
    if (index != null) void scrollToFindMatch(index);
  });
}
function closeFind(): void {
  findOpen.value = false;
  findQuery.value = '';
  findCursor.value = -1;
  findTemporarilyExpandedHeads.value = new Set();
}
function moveFind(direction: -1 | 1): void {
  const next = nextCommandFindCursor(findMatches.value.length, findCursor.value, direction);
  if (next < 0) return;
  findCursor.value = next;
  const index = findMatches.value[next];
  if (index != null) void scrollToFindMatch(index);
}
const currentPageLocked = computed(() => pageIdentities.value[pageIndex.value]?.origin === 'baseline');
const shellLocked = computed(() => Boolean(props.overview && !props.overview.shellEditable));
const selectedIndices = computed(() => selectedSpans.value.filter((index) => index >= 0 && index < spans.value.length).sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
// A blank insertion slot belongs to the visual selection when both adjacent
// spans are selected (whole-block click or Shift range). The slot itself stays
// non-editable/non-deletable — this only makes RM-like block selection cover
// the placeholder rows inside if/else bodies.
function slotSelected(slot: MvCommandInsertionSlot): boolean {
  return selectedSpanSet.value.has(slot.spanIndex) && selectedSpanSet.value.has(slot.spanIndex - 1);
}
// The anchor span when the selection is exactly the anchor row or its whole structure
// block; block-selection clicks keep edit/move/insert targeting the clicked row.
const anchorBlockSelection = computed(() => {
  const anchor = selectionAnchor.value;
  if (anchor == null || anchor < 0 || anchor >= spans.value.length || !selectedSpanSet.value.has(anchor)) return null;
  const selected = selectedIndices.value;
  if (selected.length === 1 && selected[0] === anchor) return anchor;
  const block = commandBlockSpanIndices(spans.value, [anchor]);
  return block.length === selected.length && block.every((value, index) => value === selected[index]) ? anchor : null;
});
const cmdContext = reactive({ visible: false, x: 0, y: 0, onSlot: false });
// Drag reorder state: source span plus the insert-before slot (spans.length = drop at end).
const dragSourceIndices = ref<number[]>([]), dropIndicator = ref<number | null>(null);
const eventEditorTitle = computed(() => props.draft?.id
  ? t('eventEditorDialog.title', { id: String(props.draft.id).padStart(3, '0') })
  : t('eventEditorDialog.newEvent'));
const pageOptions = computed<[keyof MvEventPage, string][]>(() => [
  ['walkAnime', t('eventEditorDialog.walkingAnim')],
  ['stepAnime', t('eventEditorDialog.steppingAnim')],
  ['directionFix', t('eventEditorDialog.directionFix')],
  ['through', t('eventEditorDialog.through')],
]);
const localizedTriggers = computed(() => eventEditorText(language.value).triggers);
const localizedPriorities = computed(() => eventEditorText(language.value).priorities);
const localizedMoveTypes = computed(() => eventEditorText(language.value).moveTypes);
const localizedMoveSpeeds = computed(() => eventEditorText(language.value).moveSpeeds);
const localizedMoveFreqs = computed(() => eventEditorText(language.value).moveFrequencies);
function setVariableConditionValue(event: Event) {
  if (!currentPage.value) return;
  currentPage.value.conditions.variableValue = Number((event.target as HTMLInputElement).value);
  markDirty();
}
function setSelfSwitchCondition(event: Event) {
  if (!currentPage.value) return;
  currentPage.value.conditions.selfSwitchCh = (event.target as HTMLSelectElement).value;
  markDirty();
}
function onKeyDown(event: KeyboardEvent) {
  if (!props.visible || !isTopmostEditorDialog(LAYER_Z.eventEditor)) return;
  const target = event.target as HTMLElement | null;
  const commandDialogActive = Boolean(target?.closest(`[data-editor-dialog-layer="${LAYER_Z.commandDialog}"]`));
  if (findOpen.value && !commandDialogActive && event.key === 'Escape') {
    event.preventDefault();
    closeFind();
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'f' && isFindShortcutTarget(target)) {
    event.preventDefault();
    openFind();
    return;
  }
  if (findOpen.value && !commandDialogActive && target === findInputRef.value && (event.key === 'Enter' || event.key === 'F3' || event.code === 'F3')) {
    event.preventDefault();
    moveFind(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (cmdContext.visible) closeCommandContext();
    else void requestClose();
    return;
  }
  if (currentPageLocked.value) return;
  if (!isCommandShortcutTarget(target)) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    openCommandPicker();
  } else if (event.code === 'Space' && anchorBlockSelection.value != null) {
    event.preventDefault();
    openSelectedCommand();
  } else if (event.key === 'Delete' && selectedIndices.value.length) {
    event.preventDefault();
    deleteSelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'x' && selectedIndices.value.length) {
    event.preventDefault();
    cutSelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'c' && selectedIndices.value.length) {
    event.preventDefault();
    copySelectedCommands();
  } else if (ctrl && event.key.toLowerCase() === 'v' && commandClipboard.value) {
    event.preventDefault();
    pasteSelectedCommand();
  } else if (ctrl && event.key.toLowerCase() === 'a' && spans.value.length) {
    event.preventDefault();
    selectAllCommands();
  } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    moveSelectedCommandBlock(event.key === 'ArrowUp' ? -1 : 1);
  } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !ctrl) {
    event.preventDefault();
    stepCommandSelection(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
  }
}
onMounted(() => { window.addEventListener('keydown', onKeyDown); window.addEventListener('resize', measureListViewport); });
onUnmounted(() => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', measureListViewport); });
watch(() => props.visible, (value) => {
  if (value) {
    dirty.value = props.draft?.id === 0;
    pageIndex.value = 0;
    findOpen.value = false;
    findQuery.value = '';
    findCursor.value = -1;
    findTemporarilyExpandedHeads.value = new Set();
    collapsedStructureHeads.value = new Set();
    loadEditorDialogSize();
    pageIdentities.value = (props.draft?.pages || []).map((_, index) =>
      props.overview?.pages.find((page) => page.pageIndex === index));
    clearCommandSelection();
    listScrollTop.value = 0;
    void nextTick(() => { measureListViewport(); paintPreview(); });
  } else {
    dragOffset.value = null;
    dragStart = null;
  }
});
watch(currentPage, () => { collapsedStructureHeads.value = new Set(); findTemporarilyExpandedHeads.value = new Set(); clearCommandSelection(); listScrollTop.value = 0; if (listHost.value) listHost.value.scrollTop = 0; void nextTick(() => { measureListViewport(); paintPreview(); }); });
function markDirty() { dirty.value = true; void nextTick(paintPreview); }
async function requestClose() {
  if (closing.value) return;
  if (dirty.value) {
    closing.value = true;
    try {
      await confirmAboveModal(
        t('eventEditorDialog.unsavedConfirm'),
        t('eventEditorDialog.discardChanges'),
      );
    } catch {
      return;
    } finally {
      closing.value = false;
    }
  }
  emit('close');
}
function markSaved() { dirty.value = false; }
function addPage() { if (!props.draft) return; props.draft.pages.push(defaultPage()); pageIdentities.value.push(undefined); pageIndex.value = props.draft.pages.length - 1; markDirty(); }
function copyPage() { if (currentPage.value) { pageClipboard.value = clone(currentPage.value); ElMessage.success(t('eventEditorDialog.pageCopied')); } }
function pastePage() { if (!props.draft || !pageClipboard.value) return; props.draft.pages.push(clone(pageClipboard.value)); pageIdentities.value.push(undefined); pageIndex.value = props.draft.pages.length - 1; markDirty(); }
async function clearPage() { if (!currentPage.value || currentPageLocked.value) return; try { await confirmAboveModal(t('eventEditorDialog.clearPageConfirm'), t('eventEditorDialog.clearPageTitle')); } catch { return; } props.draft!.pages[pageIndex.value] = defaultPage(); markDirty(); }
async function deletePage() { if (!props.draft || currentPageLocked.value || props.draft.pages.length <= 1) return; try { await confirmAboveModal(t('eventEditorDialog.deletePageConfirm'), t('eventEditorDialog.deletePageTitle')); } catch { return; } props.draft.pages.splice(pageIndex.value, 1); pageIdentities.value.splice(pageIndex.value, 1); pageIndex.value = Math.max(0, pageIndex.value - 1); markDirty(); }function openCommandPicker() { if (currentPageLocked.value) return; const focusedSlot = insertionFocus.value == null ? null : insertionSlots.value.find((slot) => slot.spanIndex === insertionFocus.value) || null; if (focusedSlot) { openCommandPickerAt(focusedSlot); return; } const anchor = anchorBlockSelection.value, selected = selectedIndices.value, next = visibleInsertionTarget(anchor != null ? anchor + 1 : selected.length ? selected[selected.length - 1] + 1 : spans.value.length); const slot = insertionSlots.value.find((item) => item.spanIndex === next) || insertionSlots.value.at(-1); if (slot) openCommandPickerAt(slot); }
function openCommandPickerAt(slot: MvCommandInsertionSlot) { if (currentPageLocked.value) return; insertionFocus.value = null; commandDialog.value?.openPicker(slot.spanIndex, slot.indent); }
function openCommand(index: number) {
  if (currentPageLocked.value) return;
  insertionFocus.value = null;
  const span = spans.value[index];
  if (!span) return;
  // Structural placeholders (code=0 branch/loop/choice/battle/skip End, and
  // other codes with no graphical editor) have nothing to edit; double-click,
  // the context-menu Edit action, and the Space shortcut all route here, so
  // guarding once avoids the "unknown command" fallback dialog.
  const engine = projectStore.currentProjectInfo?.engine || 'rpg-maker-mv';
  if (!commandDefinition(span.commands[0]?.code, engine)) return;
  const block = commandBlockSpanIndices(spans.value, [index]);
  const commands = block.length > 1 ? block.flatMap((spanIndex) => spans.value[spanIndex]?.commands || []) : span.commands;
  const headSpan = spans.value[block[0] ?? index];
  commandDialog.value?.openEditor(commands, index, currentPage.value?.list, headSpan?.index ?? null);
}
function openSelectedCommand() { const anchor = anchorBlockSelection.value; if (anchor != null) openCommand(anchor); }
function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }) {
  if (!currentPage.value || currentPageLocked.value) return;
  insertionFocus.value = null;
  const list = currentPage.value.list;
  if (payload.editSpan == null) {
    const at = payload.insertSpan == null || payload.insertSpan >= spans.value.length ? list.length - 1 : spans.value[payload.insertSpan].index;
    list.splice(at, 0, ...payload.commands);
  } else {
    const block = commandBlockSpanIndices(spans.value, [payload.editSpan]);
    const first = block[0] == null ? null : spans.value[block[0]];
    const lastIndex = block.at(-1);
    const last = lastIndex == null ? null : spans.value[lastIndex];
    if (first && last) list.splice(first.index, last.index + last.commands.length - first.index, ...payload.commands);
  }
  ensureTerminator(list); clearCommandSelection(); markDirty();
}
function selectCommand(index: number, event: MouseEvent) {
  insertionFocus.value = null;
  if (event.shiftKey && selectionAnchor.value != null) {
    if (commandBranchScope(spans.value, selectionAnchor.value) !== commandBranchScope(spans.value, index)) return;
    const start = Math.min(selectionAnchor.value, index), end = Math.max(selectionAnchor.value, index);
    selectedSpans.value = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  } else if (event.ctrlKey || event.metaKey) {
    selectedSpans.value = selectedSpanSet.value.has(index) ? selectedIndices.value.filter((item) => item !== index) : [...selectedIndices.value, index];
    selectionAnchor.value = index;
  } else {
    // RM-like block selection: clicking a structure head or marker highlights the whole block.
    selectedSpans.value = commandBlockSpanIndices(spans.value, [index]);
    selectionAnchor.value = index;
  }
}
function clearCommandSelection() { selectedSpans.value = []; selectionAnchor.value = null; insertionFocus.value = null; closeCommandContext(); }
function focusInsertionSlot(slot: MvCommandInsertionSlot) { selectedSpans.value = []; selectionAnchor.value = null; insertionFocus.value = slot.spanIndex; closeCommandContext(); }
function selectAllCommands() { selectedSpans.value = spans.value.map((_, index) => index); selectionAnchor.value = selectedSpans.value[0] ?? null; }
function applyCommandListMutation(result: { list: MvCommand[]; headIndex: number } | null) {
  if (!result || !currentPage.value) return;
  currentPage.value.list.splice(0, currentPage.value.list.length, ...result.list);
  ensureTerminator(currentPage.value.list);
  const spanIndex = spans.value.findIndex((span) => span.index === result.headIndex);
  selectedSpans.value = spanIndex >= 0 ? [spanIndex] : [];
  selectionAnchor.value = spanIndex >= 0 ? spanIndex : null;
  markDirty();
}
function moveSelectedCommandBlock(offset: -1 | 1) {
  const anchor = anchorBlockSelection.value;
  if (!currentPage.value || currentPageLocked.value || anchor == null) return;
  applyCommandListMutation(moveCommandSpanBlock(currentPage.value.list, spans.value, anchor, offset));
}
function stepCommandSelection(offset: -1 | 1, extend: boolean) {
  const count = spans.value.length;
  if (!count) return;
  const focus = selectedIndices.value.length ? (offset > 0 ? selectedIndices.value[selectedIndices.value.length - 1] : selectedIndices.value[0]) : (offset > 0 ? -1 : count);
  let next = Math.max(0, Math.min(count - 1, focus + offset));
  // Collapsed block bodies are invisible; step across them so the selection
  // never lands on a hidden span (it would vanish from the UI).
  const hidden = collapsedHiddenSpans.value;
  while (hidden.has(next)) {
    const stepped = next + offset;
    if (stepped < 0 || stepped >= count) return;
    next = stepped;
  }
  if (extend && selectionAnchor.value != null) {
    if (commandBranchScope(spans.value, selectionAnchor.value) !== commandBranchScope(spans.value, next)) return;
    const start = Math.min(selectionAnchor.value, next), end = Math.max(selectionAnchor.value, next);
    selectedSpans.value = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  } else {
    selectedSpans.value = [next];
    selectionAnchor.value = next;
  }
  scrollSpanIntoView(next);
}
function onRowDragStart(index: number, event: DragEvent) {
  if (currentPageLocked.value) { event.preventDefault(); return; }
  insertionFocus.value = null;
  if (!selectedSpanSet.value.has(index)) { selectedSpans.value = [index]; selectionAnchor.value = index; }
  dragSourceIndices.value = commandBlockSpanIndices(spans.value, selectedSpanSet.value.has(index) ? selectedIndices.value : [index]);
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }
}
function onRowDragOver(index: number, event: DragEvent) {
  if (!dragSourceIndices.value.length) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const raw = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  dropIndicator.value = visibleInsertionTarget(raw);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function onInsertionDragOver(index: number, event: DragEvent) {
  if (!dragSourceIndices.value.length) return;
  dropIndicator.value = index;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function onRowDrop() {
  const source = dragSourceIndices.value, target = dropIndicator.value;
  resetRowDrag();
  if (!source.length || target == null || !currentPage.value || currentPageLocked.value) return;
  applyCommandListMutation(dropCommandSpanBlocks(currentPage.value.list, spans.value, source, target));
}
function resetRowDrag() { dragSourceIndices.value = []; dropIndicator.value = null; }
function deleteSelectedCommands() {
  if (!currentPage.value || currentPageLocked.value || !selectedIndices.value.length) return;
  const list = currentPage.value.list;
  for (const index of commandBlockSpanIndices(spans.value, selectedIndices.value).reverse()) {
    const span = spans.value[index];
    if (span) list.splice(span.index, span.commands.length);
  }
  ensureTerminator(list);
  clearCommandSelection();
  markDirty();
}
function copySelectedCommands(showMessage = true) {
  if (currentPageLocked.value || !selectedIndices.value.length) return;
  commandClipboard.value = clone(commandBlockSpanIndices(spans.value, selectedIndices.value).flatMap((index) => spans.value[index]?.commands || []));
  if (showMessage) ElMessage.success(t('eventEditorDialog.commandsCopied'));
}
function cutSelectedCommands() {
  if (!selectedIndices.value.length) return;
  copySelectedCommands(false);
  deleteSelectedCommands();
  ElMessage.success(t('eventEditorDialog.commandsCut'));
}
function pasteSelectedCommand() {
  if (!commandClipboard.value || !currentPage.value || currentPageLocked.value) return;
  const selected = selectedIndices.value, next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
  const at = next >= spans.value.length ? currentPage.value.list.length - 1 : spans.value[next].index;
  currentPage.value.list.splice(at, 0, ...clone(commandClipboard.value));
  ensureTerminator(currentPage.value.list);
  clearCommandSelection();
  markDirty();
}
function isMvCommandShape(value: unknown): value is MvCommand {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as MvCommand).code === 'number'
    && typeof (value as MvCommand).indent === 'number'
    && Array.isArray((value as MvCommand).parameters);
}
async function copySelectedCommandsAsText() {
  if (!selectedIndices.value.length) return;
  const commands = commandBlockSpanIndices(spans.value, selectedIndices.value).flatMap((index) => spans.value[index]?.commands || []);
  if (!commands.length) return;
  try {
    await clipboardApi.writeText('◆' + JSON.stringify(commands));
    ElMessage.success(t('eventEditorDialog.copiedAsText'));
  } catch (error) {
    ElMessage.error(t('eventEditorDialog.copyTextFailed', { message: (error as Error).message }));
  }
}
function openPasteCommandsFromText() {
  if (currentPageLocked.value) return;
  textPasteDialog.value?.open(t('eventText.pasteCommandsTitle'), t('eventText.commandsPlaceholder'));
}
// Paste RM-native command JSON. Reject malformed input loudly instead of guessing a shape.
function applyPastedCommandsText(text: string) {
  if (!currentPage.value || currentPageLocked.value) return;
  let parsed: unknown;
  const json = text.startsWith('◆') ? text.slice(1) : text;
  try { parsed = JSON.parse(json); }
  catch { ElMessage.error(t('eventText.invalidJson')); return; }
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every(isMvCommandShape)) { ElMessage.error(t('eventText.invalidCommands')); return; }
  const engine = projectStore.currentProjectInfo?.engine || 'rpg-maker-mv';
  const commands = (parsed as MvCommand[]).map((command) => normalizeEventCommandParameters(clone(command), engine));
  const selected = selectedIndices.value, next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
  const at = next >= spans.value.length ? currentPage.value.list.length - 1 : spans.value[next].index;
  currentPage.value.list.splice(at, 0, ...commands);
  ensureTerminator(currentPage.value.list);
  clearCommandSelection();
  markDirty();
}
function openCommandContext(event: MouseEvent, index: number | null, slot: MvCommandInsertionSlot | null = null) {
  if (currentPageLocked.value) return;
  // A blank insertion slot is an insert-only affordance: it cannot be edited,
  // moved, copied, cut, or deleted. Track the context origin so the menu can
  // hide those command-targeted actions and keep only New / Paste entries.
  cmdContext.onSlot = Boolean(slot);
  if (slot) {
    selectedSpans.value = [];
    selectionAnchor.value = null;
    insertionFocus.value = slot.spanIndex;
    closeCommandContext();
  } else if (index == null) clearCommandSelection();
  else if (!selectedSpanSet.value.has(index)) { selectedSpans.value = [index]; selectionAnchor.value = index; }
  // The context menu is a sibling of the dialog section (not a child), so any
  // CSS transform on the dialog does NOT create a containing block for the
  // menu's position:fixed.  The menu is always viewport-relative.
  const width = 214, height = 330, margin = 8;
  cmdContext.x = Math.max(margin, Math.min(event.clientX, window.innerWidth - width - margin));
  cmdContext.y = Math.max(margin, Math.min(event.clientY, window.innerHeight - height - margin));
  cmdContext.visible = true;
}
function closeCommandContext() { cmdContext.visible = false; }
function runCommandMenu(action: () => void) { closeCommandContext(); action(); }
function isCommandShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (element.isContentEditable || element.closest('[contenteditable]')) return false;
  if (element.closest('.cmd-context-menu')) return false;
  if (element.closest('.cmd-row')) return true;
  return !element.closest('input, textarea, select, button, .CodeMirror');
}
function isFindShortcutTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (element.isContentEditable || element.closest('[contenteditable], .CodeMirror')) return false;
  if (element.closest('input, textarea, select, button:not(.cmd-row), .cmd-context-menu')) return false;
  if (element.closest(`[data-editor-dialog-layer="${LAYER_Z.commandDialog}"]`)) return false;
  return true;
}
function setImage(image: MvEventImage) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.image = image; markDirty(); } }
function openImagePicker() { if (currentPage.value && !currentPageLocked.value) imagePicker.value?.open(currentPage.value.image); }
function setPageRoute(route: MvMoveRoute) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.moveRoute = route; markDirty(); } }
async function paintPreview() { const canvas = previewCanvas.value, image = currentPage.value?.image; if (!canvas || !image) return; const context = canvas.getContext('2d')!; context.clearRect(0,0,canvas.width,canvas.height); if (image.tileId) return drawTile(context, props.tilesetImages, image.tileId, 14, 10); const asset = props.catalog?.assets.characters.find((item) => item.name === image.characterName); if (!asset) return; const bitmap = await props.loadImage(asset.url); const frame = bitmap && eventCharacterFrame(bitmap, image); if (!bitmap || !frame) return; const scale = Math.min(1, 64 / frame.sw, 88 / frame.sh); context.imageSmoothingEnabled = false; context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, Math.round((canvas.width-frame.sw*scale)/2), Math.round((canvas.height-frame.sh*scale)/2), frame.sw*scale, frame.sh*scale); }
function localizedImageSummary(image: MvEventImage): string {
  return imageSummary(image, language.value);
}
defineExpose({ markSaved });
</script>

<style scoped>
.ev-modal-overlay {
  z-index: v-bind(eventEditorZ);
}

/* Modeless mode: the backdrop lets clicks fall through to the map canvas so
 * other events stay inspectable while editing (RM cannot do this). */
.ev-modal-overlay.modeless {
  pointer-events: none;
  background: transparent;
  animation: none;
}

.ev-modal-overlay.modeless .ev-modal {
  pointer-events: auto;
}

.ev-modal {
  position: relative;
  width: min(1040px, calc(100vw - 32px));
  height: min(720px, calc(100vh - 32px));
}

/* Mirrors .dialog-resize-handle in EventCommandDialog. Kept duplicated (not
 * moved to shared CSS) per scope discipline: only this dialog and that one
 * resize, and lifting it would touch the working dialog. */
.dialog-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(135deg, transparent 0 45%, var(--app-border-strong) 45% 55%, transparent 55% 68%, var(--app-border-strong) 68% 78%, transparent 78%);
}

.ev-title-bar {
  flex: 0 0 auto;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.ev-meta-bar {
  display: grid;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
}

/* RM-native top rows: name/note labels above their inputs, page tools on their own row. */
.ev-meta-fields {
  display: flex;
  gap: 8px;
  align-items: end;
}

.ev-lock-banner {
  padding: 7px 12px;
  color: var(--app-warn);
  background: color-mix(in srgb, var(--app-warn) 9%, transparent);
  border-bottom: 1px solid var(--app-border);
  font-size: var(--text-sm);
}

.ev-commands.locked {
  opacity: 0.68;
}

.ev-stack-field {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--app-ink-soft);
  font-size: var(--text-xs);
}

.ev-stack-field.name {
  flex: 0 1 200px;
}

.ev-stack-field.note {
  flex: 1 1 auto;
}

.ev-stack-field.coord {
  flex: 0 0 62px;
}

.ev-stack-field input {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: var(--text-sm);
}

.page-tools {
  justify-self: start;
}

.ev-page-tabs {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  margin: 0 8px;
  padding: 0;
  background: var(--app-bg-soft);
}

.ev-page-tabs button {
  min-width: 36px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-bottom: 0;
  border-radius: var(--app-radius-sm) var(--app-radius-sm) 0 0;
  background: var(--app-bg-sunken);
  color: var(--app-ink-soft);
  font-size: var(--text-sm);
  cursor: pointer;
}

.ev-page-tabs button.active {
  background: var(--app-bg);
  color: var(--app-accent);
  font-weight: 600;
  border-color: var(--app-border-strong);
  position: relative;
  z-index: 1;
}

.ev-toolbar-group {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  overflow: hidden;
  background: var(--app-bg);
}

.ev-tool-btn {
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--app-border);
  background: var(--app-bg-soft);
  color: var(--app-ink);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
}

.ev-tool-btn:last-child {
  border-right: 0;
}

.ev-tool-btn:hover:not(:disabled) {
  background: var(--app-accent-soft);
}

.ev-tool-btn:disabled {
  color: var(--app-ink-muted);
  cursor: not-allowed;
  opacity: .65;
}

.ev-tool-btn.danger:not(:disabled) {
  color: var(--app-danger);
}

.ev-tool-btn.primary {
  background: var(--app-accent);
  color: var(--app-accent-ink);
  font-weight: 600;
}

.ev-tool-btn.primary:hover:not(:disabled) {
  background: var(--app-accent-hover);
}

.ev-tool-btn.block {
  width: 100%;
  border-right: 0;
  border-top: 1px solid var(--app-border);
}

.ev-main-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  flex: 1;
  margin: 0 8px 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: 0 var(--app-radius-sm) var(--app-radius-sm);
  overflow: hidden;
}

.ev-settings {
  min-height: 0;
  padding: 5px;
  border-right: 1px solid var(--app-border);
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: 4px 6px;
  align-content: start;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--app-bg-soft);
}

.ev-group {
  margin: 0;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
}

.ev-group legend {
  padding: 0 4px;
  color: var(--app-ink);
  font-size: 10px;
  font-weight: 600;
}

.conditions-group {
  grid-column: 1 / -1;
}

.image-group {
  grid-column: 1;
  display: grid;
  gap: 4px;
}

.move-group {
  grid-column: 2;
}

.options-group {
  grid-column: 1;
}

.behavior-groups {
  grid-column: 2;
  display: grid;
  gap: 4px;
  align-content: start;
}

.ev-group select,
.ev-select-row select,
.mini-input {
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: var(--text-xs);
}

.ev-cond-row,
.ev-check,
.ev-select-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
  color: var(--app-ink);
  font-size: var(--text-xs);
}

.ev-cond-row {
  min-height: 26px;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
}

.ev-cond-row > span {
  flex: 0 0 68px;
  line-height: 1.25;
}

.ev-cond-row select {
  min-width: 0;
  flex: 1;
  height: 26px;
}

.ev-select-row {
  justify-content: space-between;
}

.ev-select-row span {
  flex: 0 0 auto;
}

.ev-select-row select {
  flex: 1;
}

.mini-input {
  width: 54px;
  flex: 0 0 54px;
  height: 26px;
}

.comparison-operator {
  flex: 0 0 auto !important;
  color: var(--app-ink-soft);
  font-size: 14px;
  font-weight: 700;
}

.mini-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}

.image-preview {
  width: 82px;
  height: 112px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background:
    linear-gradient(45deg, #e9e9e6 25%, transparent 25%),
    linear-gradient(-45deg, #e9e9e6 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e9e9e6 75%),
    linear-gradient(-45deg, transparent 75%, #e9e9e6 75%);
  background-color: var(--app-bg);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  color: inherit;
  cursor: pointer;
  transition: border-color var(--app-dur) var(--app-ease), box-shadow var(--app-dur) var(--app-ease);
}

.image-preview:hover:not(:disabled) {
  border-color: var(--app-accent);
  box-shadow: 0 0 0 2px var(--app-accent-soft);
}

.image-preview:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.image-preview:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.image-preview canvas {
  display: block;
  image-rendering: pixelated;
}

.image-caption {
  display: block;
  color: var(--app-ink-muted);
  font-size: 10px;
  line-height: 1.2;
  word-break: break-all;
}

.ev-commands {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 6px;
  overflow: hidden;
  background: var(--app-bg);
}

.ev-commands.searching {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.command-find {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin-bottom: 4px;
  padding: 3px 4px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-soft);
}

.command-find input {
  flex: 1 1 140px;
  min-width: 0;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: var(--text-sm);
}

.command-find-status {
  min-width: 48px;
  color: var(--app-ink-muted);
  font-size: var(--text-xs);
  text-align: center;
  white-space: nowrap;
}

.command-find button {
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink-soft);
  cursor: pointer;
}

.command-find button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.ev-cmd-title {
  margin-bottom: 4px;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--app-ink);
}

.command-list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
}

.command-empty {
  padding: 7px 10px;
  color: var(--app-ink-muted);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg-soft);
}

.cmd-virtual-pad {
  flex: 0 0 auto;
  pointer-events: none;
}

.cmd-row {
  position: relative;
  width: 100%;
  min-height: 18px;
  height: auto;
  flex: 0 0 auto;
  display: block;
  padding: 0px 8px 0px calc(50px + var(--cmd-indent, 0px));
  border: 1px solid transparent;
  /* border-bottom-color: var(--app-border); */
  background: var(--app-bg);
  color: var(--app-ink);
  text-align: left;
  cursor: pointer;
  appearance: none;
  border-radius: 0;
}
/* Plugin-command color stripe: a thin vertical bar at the row's left edge,
   inline so it does not affect the compact one-row-per-command density. */
.cmd-plugin-stripe {
  position: absolute;
  left: calc(var(--cmd-indent, 0px));
  top: 1px;
  bottom: 1px;
  width: 3px;
  border-radius: 1px;
}

.cmd-row::after {
  content: attr(no);
  position: absolute;
  display: block;
  width: 28px;
  text-align: right;
  padding-right: 6px;
  padding-top: 2px;
  box-sizing: border-box;
  left: 0px;
  top: -1px;
  bottom: -1px;
  line-height: 18px;
  color: #7699b1;
  border-right: 1px solid var(--app-border);
  font-size: 10px;
  background-color: var(--app-accent-soft);
  font-family: ‌Consolas;

  
  /* --app-border: #cac4b6;
  --app-border-strong: #b3ab9c;
  --app-bg-soft: #f2ece4;
  --app-bg-sunken: #d9d3c7;
  --app-ink-soft: #5c5649;
  --app-ink-muted: #7d776b;
  --app-accent-soft: #f5e6da;
  --app-tone-flow: #8b5d23;
  --app-tone-stage: #3d6d90;
  --app-tone-move: #277772; */
}

.cmd-row.cmd-blank {
  /* RM MV-native list: only block-bottom slots (the foot of each structure
     body and the trailing "◆" row), the focused insertion point, and the
     active drop target are visible. Other intermediate slots are display:none
     and report 0 height in the virtual list so sibling commands sit flush. */
  min-height: 18px;
  color: var(--app-ink-muted);
  cursor: default;
  user-select: none;
}

.cmd-row.cmd-blank.block-bottom,
.cmd-row.cmd-blank.focused,
.cmd-row.cmd-blank.drop-before,
.cmd-row.cmd-blank.selected {
  display: block;
}

.cmd-row.cmd-blank.focused:not(:disabled),
.cmd-row.cmd-blank.drop-before:not(:disabled) {
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.cmd-row.cmd-blank.selected {
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

.cmd-row.cmd-blank::before {
  opacity: .55;
}

.cmd-row:not(.terminator):not(:disabled) {
  cursor: grab;
}

.cmd-row.cmd-blank:not(:disabled) {
  cursor: default;
}

.cmd-row:not(.terminator):not(:disabled):active {
  cursor: grabbing;
}

/* 缩进层级参考线：按 --cmd-indent 宽度每 18px 画一条淡竖线 */
/* .cmd-row::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: var(--cmd-indent, 0px);
  background: repeating-linear-gradient(to right, var(--app-border) 0 1px, transparent 1px 18px);
  pointer-events: none;
} */

.cmd-row:not(.role-terminator):not(.role-branch) > .cmd-line:not(.cmd-sub)::before {
  content: '◆';
  float: left;
  color: #5e5e5e;
  width: 20px;
  font-size: 23px;
  text-align: center;
}

.cmd-row.role-branch > .cmd-head::before {
  content: ':';
  color: var(--app-ink);
  display: inline-block;
  width: 20px;
  text-align: center;
}

.cmd-sub.cmd-descriptions:not(.is-table) > .cmd-description-item::before {
  content: ':';
  color: var(--app-ink);
  display: inline-block;
  width: 20px;
  text-align: center;
}
.cmd-sub:not(.cmd-descriptions)::before {
  content: ':';
  color: var(--app-ink);
  display: inline-block;
  width: 20px;
  text-align: center;
}
.cmd-sub.cmd-descriptions {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  flex-direction: column;
}
.cmd-sub.cmd-descriptions.is-table {
  flex-direction: row;
  width: calc(100% - 10px);
  margin: 5px 5px;
}
.cmd-sub.cmd-descriptions.is-many {
  flex-wrap: wrap;
}

.cmd-sub.cmd-descriptions > .cmd-description-item {
  display: flex;
  flex-direction: row;
  width: 100%;
}
.cmd-sub.cmd-descriptions.is-table > .cmd-description-item {
  flex-direction: column;
  align-items: center;
}
.cmd-sub.cmd-descriptions.is-many > .cmd-description-item {
  flex-wrap: wrap;
  min-width: 25%;
  width: auto;
}
.cmd-sub.cmd-descriptions > .cmd-description-item > .cmd-description-label {
  background-color: var(--app-bg);
  border-radius: 4px;
  color: var(--app-tone-text-strong);
  text-align: center;
  font-size: 10px;
  height: 16px;
  line-height: 16px;
  width: calc(100% - 10px);
  text-align: center;
}
.cmd-sub.cmd-descriptions > .cmd-description-item > .cmd-description-value {
  text-align: center;
}
.cmd-sub.cmd-descriptions > .cmd-description-item:nth-child(n + 5) > .cmd-description-label {
  border-top: none;
}

.cmd-row.role-terminator > .cmd-head::before {
  content: ':';
  color: var(--app-ink);
  display: inline-block;
  width: 20px;
  text-align: center;
}


.cmd-row.selected > .cmd-line::before {
  color: var(--app-accent-ink) !important;
}

.cmd-row.selected .cmd-head::before {
  color: var(--app-accent-ink);
}

.cmd-row.selected .cmd-sub::before {
  color: var(--app-accent-ink);
}

.cmd-row.selected::before {
  display: none;
}

.cmd-caret {
  position: absolute;
  left: 30px;
  top: 1px;
  display: inline-block;
  place-items: center;
  color: #a2a2a2;
  font-size: 18px;
  width: 20px;
  height: 18px;
  align-items: start;
  text-align: center;
  line-height: 18px;
  cursor: pointer;
}

.cmd-caret::before {
  content: '\25BE';
}

.cmd-caret:hover::before {
  color: #1b4077;
}

.cmd-caret.collapsed::before {
  content: '\25B8';
}

.cmd-row.selected .cmd-caret {
  color: var(--app-accent-ink);
}

.cmd-row.drop-before {
  box-shadow: inset 0 2px 0 var(--app-accent);
}

.cmd-row.even {
  background: var(--app-bg);
}

.cmd-row:not(.even):not(.selected) {
  background: var(--app-bg-soft);
}

.cmd-row:hover:not(.selected) {
  background: var(--app-accent-soft);
}

.cmd-row.selected {
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

.cmd-row.find-hit:not(.selected) {
  outline: 1px solid var(--app-accent);
  outline-offset: -1px;
  background: var(--app-accent-soft);
}

.cmd-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  font-family: var(--app-font-sans);
  font-size: var(--text-sm);
  line-height: 20px;
  min-height: 20px;
}

/* 续行（台词、移动步骤等）：正文色、缩进一级，与命令头拉开层次 */
.cmd-sub {
  padding-left: calc(1em + 2px);
  color: var(--app-ink);
}

.cmd-row.selected .cmd-line {
  color: var(--app-accent-ink);
}

.cmd-row.tone-text:not(.selected) .cmd-head { color: var(--app-tone-text-strong); }
.cmd-row.tone-flow:not(.selected) .cmd-head { color: var(--app-tone-flow); }
.cmd-row.tone-data:not(.selected) .cmd-head { color: var(--app-tone-data); }
.cmd-row.tone-stage:not(.selected) .cmd-head { color: var(--app-tone-stage); }
.cmd-row.tone-move:not(.selected) .cmd-head { color: var(--app-tone-move); }
.cmd-row.tone-control:not(.selected) .cmd-head { color: var(--app-tone-control-strong); }
.cmd-row.tone-raw:not(.selected) .cmd-head { color: var(--app-danger); }
.cmd-row.role-branch:not(.selected) .cmd-head,
.cmd-row.role-terminator:not(.selected) .cmd-head { color: var(--app-ink-muted); }

.cmd-row.terminator:not(.selected) .cmd-line {
  color: var(--app-ink-soft);
}

.ev-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--app-border);
  background: var(--app-bg-soft);
}

.ev-save-status {
  color: var(--app-ink-muted);
  font-size: var(--text-sm);
}

.ev-footer-actions {
  display: flex;
  gap: 0;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  overflow: hidden;
}

.ev-footer-actions .ev-tool-btn {
  min-width: 72px;
}

.cmd-context-mask {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: auto;
}

.cmd-context-menu {
  position: fixed;
  min-width: 214px;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  box-shadow: var(--app-shadow-3);
  list-style: none;
  pointer-events: auto;
}

.cmd-context-menu li {
  margin: 0;
  padding: 0;
}

.cmd-context-menu li.separator {
  height: 0;
  margin: 4px 0;
  border-top: 1px solid var(--app-border);
}

.cmd-context-menu button {
  width: 100%;
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--app-ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  font-size: var(--text-sm);
  text-align: left;
}

.cmd-context-menu button:hover:not(:disabled) {
  background: var(--app-accent-soft);
}

.cmd-context-menu button:disabled {
  color: var(--app-ink-muted);
  cursor: not-allowed;
  opacity: .55;
}

.cmd-context-menu span {
  color: var(--app-ink-muted);
  font-size: var(--text-xs);
}

@media (max-width: 780px) {
  .ev-meta-bar {
    align-items: stretch;
  }

  .page-tools {
    flex-basis: 100%;
    margin-left: 0;
  }
}

</style>
