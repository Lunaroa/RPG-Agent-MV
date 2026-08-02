<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" :class="{ modeless }" data-ui-id="event-editor-overlay" :data-editor-dialog-layer="LAYER_Z.eventEditor" @mousedown.self="onOverlayMouseDown">
      <section ref="modalRef" class="ev-modal editor-modal-shell" data-ui-id="event-editor-dialog" role="dialog" :aria-modal="!modeless" aria-labelledby="event-editor-title" :style="dragStyle">
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
            <section class="ev-commands" :class="{ locked: currentPageLocked }">
              <strong class="ev-cmd-title">{{ t('commonEvent.contents') }}</strong>
              <div ref="listHost" class="command-list" @scroll.passive="onListScroll" @contextmenu.prevent="openCommandContext($event, null)">
                <div v-if="!spans.length" class="command-empty">
                  {{ t('eventEditorDialog.emptyHint') }}
                </div>
                <div class="cmd-virtual-pad" :style="{ height: `${virtualWindow.top}px` }" />
                <button
                  v-for="row in virtualWindow.rows"
                  :key="row.view.key"
                  type="button"
                  :disabled="currentPageLocked"
                  class="cmd-row"
                  :class="{ selected: selectedSpanSet.has(row.index), even: row.index % 2 === 0, 'drop-before': dropIndicator === row.index, [`tone-${row.view.tone}`]: true, [`role-${row.view.role}`]: true }"
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
                ><span class="cmd-line cmd-head">{{ row.view.head }}</span><span v-for="(line, lineIndex) in row.view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span></button>
                <div class="cmd-virtual-pad" :style="{ height: `${virtualWindow.bottom}px` }" />
                <button type="button" class="cmd-row terminator" :disabled="currentPageLocked" :class="{ even: spans.length % 2 === 0, 'drop-before': dropIndicator === spans.length }" @click="clearCommandSelection" @dblclick="openCommandPicker" @contextmenu.stop.prevent="openCommandContext($event, null)" @dragover.prevent="onTerminatorDragOver" @drop.prevent="onRowDrop"><span class="cmd-line">◆</span></button>
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
      </section>
      <div v-if="cmdContext.visible" class="cmd-context-mask" @mousedown.self="closeCommandContext" @contextmenu.self.prevent="closeCommandContext">
        <ul class="cmd-context-menu" :style="{ left: `${cmdContext.x}px`, top: `${cmdContext.y}px` }" role="menu" :aria-label="t('eventEditorDialog.commandActions')">
          <li><button type="button" @click="runCommandMenu(openCommandPicker)">{{ t('eventEditorDialog.newCmd') }}<span>Return</span></button></li>
          <li><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(openSelectedCommand)">{{ t('eventEditorDialog.editCmd') }}<span>Enter</span></button></li>
          <li><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(() => moveSelectedCommandBlock(-1))">{{ t('cmdList.moveUp') }}<span>Alt+↑</span></button></li>
          <li><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandMenu(() => moveSelectedCommandBlock(1))">{{ t('cmdList.moveDown') }}<span>Alt+↓</span></button></li>
          <li class="separator" />
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(cutSelectedCommands)">{{ t('eventEditorDialog.cut') }}<span>Ctrl+X</span></button></li>
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(() => copySelectedCommands())">{{ t('eventEditorDialog.copy') }}<span>Ctrl+C</span></button></li>
          <li><button type="button" :disabled="!commandClipboard" @click="runCommandMenu(pasteSelectedCommand)">{{ t('eventEditorDialog.paste') }}<span>Ctrl+V</span></button></li>
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(deleteSelectedCommands)">{{ t('cmdList.delete') }}<span>Del</span></button></li>
          <li class="separator" />
          <li><button type="button" :disabled="!spans.length" @click="runCommandMenu(selectAllCommands)">{{ t('eventEditorDialog.selectAll') }}<span>Ctrl+A</span></button></li>
          <li class="separator" />
          <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandMenu(copySelectedCommandsAsText)">{{ t('eventEditorDialog.copyAsText') }}</button></li>
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
import { clipboard as clipboardApi, type EditorProjectCatalog, type StoryEventOverview, type StoryEventPageOverview } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import ConditionSelect from './EventConditionSelect.vue';
import EventCommandDialog from './EventCommandDialog.vue';
import EventImagePickerDialog from './EventImagePickerDialog.vue';
import EventTextPasteDialog from './EventTextPasteDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';
import { SELF_SWITCH_CHANNELS, clone, commandBlockSpanIndices, commandBranchScope, commandInsertIndent, commandSpanDisplay, defaultPage, dropCommandSpanBlocks, editableCommandSpans, ensureTerminator, imageSummary, moveCommandSpanBlock, skipTerminatorIndices, type MvCommandSpanView, type MvEditorEvent, type MvEventImage, type MvEventPage, type MvMoveRoute, type MvCommand } from '../../composables/useEventEditor';
import { drawTile, eventCharacterFrame } from '../../composables/useMapRenderer';
import { eventEditorText } from '../../utils/eventEditorLocalization';
import type { EditorEventListItem } from './editorTypes';
const props = withDefaults(defineProps<{ visible: boolean; draft: MvEditorEvent | null; saving: boolean; mapId: number | null; systemData: { switches: string[]; variables: string[] } | null; catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; loadImage: (url: string) => Promise<HTMLImageElement | null>; overview?: StoryEventOverview | null; currentEvents?: EditorEventListItem[]; modeless?: boolean }>(), { currentEvents: () => [], modeless: false });
const emit = defineEmits<{ close: []; save: [closeAfterSave: boolean]; 'catalog-changed': [] }>();
const { language, t } = useI18n();
const projectStore = useProjectStore();
const eventEditorZ = String(LAYER_Z.eventEditor);
const dirty = ref(false), closing = ref(false), pageIndex = ref(0), selectedSpans = ref<number[]>([]), selectionAnchor = ref<number | null>(null), pageClipboard = ref<MvEventPage | null>(null), commandClipboard = ref<MvCommand[] | null>(null);
const pageIdentities = ref<Array<StoryEventPageOverview | undefined>>([]);
const modalRef = ref<HTMLElement>(), previewCanvas = ref<HTMLCanvasElement>(), imagePicker = ref<InstanceType<typeof EventImagePickerDialog>>(), routeDialog = ref<InstanceType<typeof MoveRouteDialog>>(), commandDialog = ref<InstanceType<typeof EventCommandDialog>>(), textPasteDialog = ref<InstanceType<typeof EventTextPasteDialog>>();
// RM-style title-bar drag. The offset is session-less: it resets on close so the
// dialog always reopens centered.
const dragOffset = ref<{ x: number; y: number } | null>(null);
let dragStart: { x: number; y: number; ox: number; oy: number; pointer: number } | null = null;
const dragStyle = computed(() => (dragOffset.value ? { transform: `translate(${dragOffset.value.x}px, ${dragOffset.value.y}px)` } : undefined));
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
function onOverlayMouseDown() { if (!props.modeless) void requestClose(); }
const currentPage = computed(() => props.draft?.pages[pageIndex.value] || null), spans = computed(() => currentPage.value ? editableCommandSpans(currentPage.value) : []);
const skipTerminatorSet = computed(() => currentPage.value ? skipTerminatorIndices(currentPage.value.list) : new Set<number>());
// Virtualized command list. Every span row has a deterministic height
// (line-height 20px per command line + 8px row chrome), so we window by
// prefix-summed pixel offsets and only localize the spans in the viewport.
const CMD_LINE_H = 20, CMD_ROW_CHROME = 8, CMD_OVERSCAN = 8;
const listHost = ref<HTMLElement>();
const listScrollTop = ref(0), listViewportH = ref(0);
function buildSpanView(span: Parameters<typeof commandSpanDisplay>[0]): MvCommandSpanView {
  return commandSpanDisplay(
    span,
    props.systemData,
    language.value,
    skipTerminatorSet.value.has(span.index),
    t('eventEditor.command.skipEnd'),
  );
}
// rowOffsets[i] is the pixel top of span i; the final entry is the total height.
const rowOffsets = computed(() => {
  const offsets = new Array<number>(spans.value.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < spans.value.length; index += 1) {
    offsets[index + 1] = offsets[index] + spans.value[index].commands.length * CMD_LINE_H + CMD_ROW_CHROME;
  }
  return offsets;
});
// Last span whose top offset is at or before `y` (i.e. the span covering pixel y).
function spanAtOffset(y: number): number {
  const offsets = rowOffsets.value;
  let lo = 0, hi = spans.value.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
const virtualWindow = computed(() => {
  const total = spans.value.length;
  const offsets = rowOffsets.value;
  const totalHeight = offsets[total];
  const rows: Array<{ index: number; view: ReturnType<typeof buildSpanView> }> = [];
  if (!total) return { rows, top: 0, bottom: 0 };
  const viewport = listViewportH.value || 400;
  const top = Math.max(0, Math.min(listScrollTop.value, Math.max(0, totalHeight - viewport)));
  let start = spanAtOffset(top) - CMD_OVERSCAN;
  if (start < 0) start = 0;
  let end = spanAtOffset(top + viewport) + CMD_OVERSCAN + 1;
  if (end > total) end = total;
  for (let index = start; index < end; index += 1) rows.push({ index, view: buildSpanView(spans.value[index]) });
  return { rows, top: offsets[start], bottom: totalHeight - offsets[end] };
});
function onListScroll() { if (listHost.value) listScrollTop.value = listHost.value.scrollTop; }
function measureListViewport() { if (listHost.value) listViewportH.value = listHost.value.clientHeight; }
// Scroll the container so span `index` is visible, without relying on a rendered node.
function scrollSpanIntoView(index: number) {
  const host = listHost.value;
  if (!host) return;
  const offsets = rowOffsets.value;
  const top = offsets[index] ?? 0, bottom = offsets[index + 1] ?? top;
  if (top < host.scrollTop) host.scrollTop = top;
  else if (bottom > host.scrollTop + host.clientHeight) host.scrollTop = bottom - host.clientHeight;
  listScrollTop.value = host.scrollTop;
}
const currentPageLocked = computed(() => pageIdentities.value[pageIndex.value]?.origin === 'baseline');
const shellLocked = computed(() => Boolean(props.overview && !props.overview.shellEditable));
const selectedIndices = computed(() => selectedSpans.value.filter((index) => index >= 0 && index < spans.value.length).sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
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
const cmdContext = reactive({ visible: false, x: 0, y: 0 });
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
  if (event.key === 'Escape') {
    event.preventDefault();
    if (cmdContext.visible) closeCommandContext();
    else void requestClose();
    return;
  }
  if (currentPageLocked.value) return;
  if (!isCommandShortcutTarget(event.target)) return;
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === 'Enter' && anchorBlockSelection.value != null) {
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
watch(currentPage, () => { clearCommandSelection(); listScrollTop.value = 0; if (listHost.value) listHost.value.scrollTop = 0; void nextTick(() => { measureListViewport(); paintPreview(); }); });
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
async function deletePage() { if (!props.draft || currentPageLocked.value || props.draft.pages.length <= 1) return; try { await confirmAboveModal(t('eventEditorDialog.deletePageConfirm'), t('eventEditorDialog.deletePageTitle')); } catch { return; } props.draft.pages.splice(pageIndex.value, 1); pageIdentities.value.splice(pageIndex.value, 1); pageIndex.value = Math.max(0, pageIndex.value - 1); markDirty(); }function openCommandPicker() { if (currentPageLocked.value) return; const anchor = anchorBlockSelection.value, selected = selectedIndices.value, next = anchor != null ? anchor + 1 : selected.length ? selected[selected.length - 1] + 1 : spans.value.length; commandDialog.value?.openPicker(next, currentPage.value ? commandInsertIndent(currentPage.value.list, rawIndexForSpan(next)) : 0); }
function openCommand(index: number) {
  if (currentPageLocked.value) return;
  const span = spans.value[index];
  if (!span) return;
  const block = commandBlockSpanIndices(spans.value, [index]);
  const commands = block.length > 1 ? block.flatMap((spanIndex) => spans.value[spanIndex]?.commands || []) : span.commands;
  commandDialog.value?.openEditor(commands, index);
}
function openSelectedCommand() { const anchor = anchorBlockSelection.value; if (anchor != null) openCommand(anchor); }
function rawIndexForSpan(index: number) { return index >= spans.value.length ? Math.max(0, (currentPage.value?.list.length || 1) - 1) : spans.value[index]?.index || 0; }
function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }) {
  if (!currentPage.value || currentPageLocked.value) return;
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
function clearCommandSelection() { selectedSpans.value = []; selectionAnchor.value = null; closeCommandContext(); }
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
  const next = Math.max(0, Math.min(count - 1, focus + offset));
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
  if (!selectedSpanSet.value.has(index)) { selectedSpans.value = [index]; selectionAnchor.value = index; }
  dragSourceIndices.value = commandBlockSpanIndices(spans.value, selectedSpanSet.value.has(index) ? selectedIndices.value : [index]);
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }
}
function onRowDragOver(index: number, event: DragEvent) {
  if (!dragSourceIndices.value.length) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropIndicator.value = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function onTerminatorDragOver(event: DragEvent) {
  if (!dragSourceIndices.value.length) return;
  dropIndicator.value = spans.value.length;
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
  const selected = selectedIndices.value, next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
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
    await clipboardApi.writeText(JSON.stringify(commands, null, 2));
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
  try { parsed = JSON.parse(text); }
  catch { ElMessage.error(t('eventText.invalidJson')); return; }
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every(isMvCommandShape)) { ElMessage.error(t('eventText.invalidCommands')); return; }
  const engine = projectStore.currentProjectInfo?.engine || 'rpg-maker-mv';
  const commands = (parsed as MvCommand[]).map((command) => normalizeEventCommandParameters(clone(command), engine));
  const selected = selectedIndices.value, next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
  const at = next >= spans.value.length ? currentPage.value.list.length - 1 : spans.value[next].index;
  currentPage.value.list.splice(at, 0, ...commands);
  ensureTerminator(currentPage.value.list);
  clearCommandSelection();
  markDirty();
}
function openCommandContext(event: MouseEvent, index: number | null) {
  if (currentPageLocked.value) return;
  if (index == null) clearCommandSelection();
  else if (!selectedSpanSet.value.has(index)) { selectedSpans.value = [index]; selectionAnchor.value = index; }
  const rect = modalRef.value?.getBoundingClientRect();
  const width = 214, height = 330, margin = 8;
  cmdContext.x = rect ? Math.max(rect.left + margin, Math.min(event.clientX, rect.right - width - margin)) : event.clientX;
  cmdContext.y = rect ? Math.max(rect.top + margin, Math.min(event.clientY, rect.bottom - height - margin)) : event.clientY;
  cmdContext.visible = true;
}
function closeCommandContext() { cmdContext.visible = false; }
function runCommandMenu(action: () => void) { closeCommandContext(); action(); }
function isCommandShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (element.closest('.cmd-row')) return true;
  return !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName);
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
  width: min(1040px, calc(100vw - 32px));
  height: min(720px, calc(100vh - 32px));
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
  --app-border: #cac4b6;
  --app-border-strong: #b3ab9c;
  --app-bg-soft: #e6e2d9;
  --app-bg-sunken: #d9d3c7;
  --app-ink-soft: #5c5649;
  --app-ink-muted: #7d776b;
  --app-accent-soft: #f5e6da;
  --app-tone-flow: #8b5d23;
  --app-tone-stage: #3d6d90;
  --app-tone-move: #277772;
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
  min-height: 22px;
  height: auto;
  flex: 0 0 auto;
  display: block;
  padding: 3px 8px 3px calc(14px + var(--cmd-indent, 0px));
  border: 1px solid transparent;
  border-bottom-color: var(--app-border);
  background: var(--app-bg);
  color: var(--app-ink);
  text-align: left;
  cursor: pointer;
  appearance: none;
  border-radius: 0;
}

.cmd-row:not(.terminator):not(:disabled) {
  cursor: grab;
}

.cmd-row:not(.terminator):not(:disabled):active {
  cursor: grabbing;
}

/* 缩进层级参考线：按 --cmd-indent 宽度每 18px 画一条淡竖线 */
.cmd-row::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: var(--cmd-indent, 0px);
  background: repeating-linear-gradient(to right, var(--app-border) 0 1px, transparent 1px 18px);
  pointer-events: none;
}

.cmd-row.selected::before {
  display: none;
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
