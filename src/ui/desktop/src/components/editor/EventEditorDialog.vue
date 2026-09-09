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
            <EventCommandListEditor
              ref="commandListEditor"
              :model-value="currentPage.list"
              :catalog="catalog"
              :load-image="loadImage"
              :system-data="systemData"
              :map-id="mapId"
              :event-x="draft?.x"
              :event-y="draft?.y"
              :current-events="currentEvents"
              :locked="currentPageLocked"
              :title="t('commonEvent.contents')"
              :reset-key="pageIndex"
              global-shortcuts
              :shortcut-gate="commandListShortcutGate"
              @update:model-value="setPageList"
              @change="markDirty"
              @catalog-changed="emit('catalog-changed')"
            />
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
        <span
          v-for="edge in editorResizeEdges"
          :key="edge"
          class="editor-dialog-resize-edge"
          :class="edge"
          :data-ui-id="`event-editor-resize-${edge}`"
          aria-hidden="true"
          @pointerdown="onEditorResizeStart($event, edge)"
          @pointermove="onEditorResizeMove"
          @pointerup="onEditorResizeEnd"
          @pointercancel="onEditorResizeEnd"
          @dblclick="resetEditorDialogSize"
        />
      </section>
    </div>
  </teleport>
  <EventImagePickerDialog ref="imagePicker" :catalog="catalog" :tileset-images="tilesetImages" :extended-tileset-sheets="extendedTilesetSheets" :load-image="loadImage" @commit="setImage" />
  <MoveRouteDialog ref="routeDialog" :preview-x="draft?.x" :preview-y="draft?.y" :catalog="catalog" @commit="setPageRoute" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { confirmAboveModal } from '../../utils/confirmAboveModal';
import { appTitlebarHeight } from '../../utils/appTitlebar';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { centeredDialogTranslation, DIALOG_RESIZE_EDGES, resizeDialogFromEdge, type DialogRect, type DialogResizeEdge } from '../../utils/dialog-edge-resize';
import type { EditorProjectCatalog, StoryEventOverview, StoryEventPageOverview } from '../../api/client';
import ConditionSelect from './EventConditionSelect.vue';
import EventCommandListEditor from './EventCommandListEditor.vue';
import EventImagePickerDialog from './EventImagePickerDialog.vue';
import type { ExtendedTilesetSheetDescriptor } from '@contract/types';
import MoveRouteDialog from './MoveRouteDialog.vue';
import { SELF_SWITCH_CHANNELS, clone, defaultPage, imageSummary, type MvEditorEvent, type MvEventImage, type MvEventPage, type MvMoveRoute, type MvCommand } from '../../composables/useEventEditor';
import { drawTile, eventCharacterFrame } from '../../composables/useMapRenderer';
import { eventEditorText } from '../../utils/eventEditorLocalization';
import type { EditorEventListItem } from './editorTypes';
const props = withDefaults(defineProps<{ visible: boolean; draft: MvEditorEvent | null; saving: boolean; mapId: number | null; systemData: { switches: string[]; variables: string[] } | null; catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; extendedTilesetSheets: ExtendedTilesetSheetDescriptor[]; loadImage: (url: string) => Promise<HTMLImageElement | null>; overview?: StoryEventOverview | null; currentEvents?: EditorEventListItem[]; modeless?: boolean }>(), { currentEvents: () => [], extendedTilesetSheets: () => [], modeless: false });
const emit = defineEmits<{ close: []; save: [closeAfterSave: boolean]; 'catalog-changed': [] }>();
const { language, t } = useI18n();
const eventEditorZ = String(LAYER_Z.eventEditor);
const dirty = ref(false), closing = ref(false), pageIndex = ref(0), pageClipboard = ref<MvEventPage | null>(null);
const pageIdentities = ref<Array<StoryEventPageOverview | undefined>>([]);
const modalRef = ref<HTMLElement>(), previewCanvas = ref<HTMLCanvasElement>(), imagePicker = ref<InstanceType<typeof EventImagePickerDialog>>(), routeDialog = ref<InstanceType<typeof MoveRouteDialog>>(), commandListEditor = ref<InstanceType<typeof EventCommandListEditor>>();
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
  // Keep the title bar reachable: never under the OS-drag title strip, always 48px visible.
  const minVisible = 48;
  const nx = Math.min(Math.max(dragStart.ox + (event.clientX - dragStart.x), minVisible - baseLeft - rect.width), window.innerWidth - baseLeft - minVisible);
  const ny = Math.min(Math.max(dragStart.oy + (event.clientY - dragStart.y), appTitlebarHeight() - baseTop), window.innerHeight - baseTop - minVisible);
  dragOffset.value = { x: Math.round(nx), y: Math.round(ny) };
}
function onDragEnd(event: PointerEvent) { if (dragStart?.pointer === event.pointerId) dragStart = null; }
const EDITOR_SIZE_KEY = 'rpgmv.eventEditorDialogSize';
const editorResizeEdges = DIALOG_RESIZE_EDGES;
const editorDialogSize = ref<{ w: number; h: number } | null>(null);
let editorResizeStart: { edge: DialogResizeEdge; x: number; y: number; rect: DialogRect; pointer: number } | null = null;
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
function resetEditorDialogSize() { editorDialogSize.value = null; dragOffset.value = null; saveEditorDialogSize(); }
function onEditorResizeStart(event: PointerEvent, edge: DialogResizeEdge) {
  if (event.button !== 0) return;
  const rect = modalRef.value?.getBoundingClientRect();
  if (!rect) return;
  event.preventDefault();
  event.stopPropagation();
  editorResizeStart = {
    edge,
    x: event.clientX,
    y: event.clientY,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    pointer: event.pointerId,
  };
  editorDialogSize.value = { w: Math.round(rect.width), h: Math.round(rect.height) };
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
}
function onEditorResizeMove(event: PointerEvent) {
  if (editorResizeStart?.pointer !== event.pointerId) return;
  const next = resizeDialogFromEdge(
    editorResizeStart.rect,
    editorResizeStart.edge,
    event.clientX - editorResizeStart.x,
    event.clientY - editorResizeStart.y,
    {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      minWidth: Math.min(640, Math.max(1, window.innerWidth - 32)),
      minHeight: Math.min(420, Math.max(1, window.innerHeight - 32)),
      margin: 16,
    },
  );
  editorDialogSize.value = { w: next.width, h: next.height };
  dragOffset.value = centeredDialogTranslation(next, window.innerWidth, window.innerHeight);
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
const currentPage = computed(() => props.draft?.pages[pageIndex.value] || null);
const currentPageLocked = computed(() => pageIdentities.value[pageIndex.value]?.origin === 'baseline');
const shellLocked = computed(() => Boolean(props.overview && !props.overview.shellEditable));
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
function commandListShortcutGate() {
  return props.visible && isTopmostEditorDialog(LAYER_Z.eventEditor);
}
function onKeyDown(event: KeyboardEvent) {
  if (!commandListShortcutGate()) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (commandListEditor.value?.handleEscape()) return;
    void requestClose();
  }
}
onMounted(() => { window.addEventListener('keydown', onKeyDown); });
onUnmounted(() => { window.removeEventListener('keydown', onKeyDown); });
watch(() => props.visible, (value) => {
  if (value) {
    dirty.value = props.draft?.id === 0;
    pageIndex.value = 0;
    loadEditorDialogSize();
    pageIdentities.value = (props.draft?.pages || []).map((_, index) =>
      props.overview?.pages.find((page) => page.pageIndex === index));
    void nextTick(paintPreview);
  } else {
    dragOffset.value = null;
    dragStart = null;
    editorResizeStart = null;
  }
});
watch(currentPage, () => { void nextTick(paintPreview); });
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
async function deletePage() { if (!props.draft || currentPageLocked.value || props.draft.pages.length <= 1) return; try { await confirmAboveModal(t('eventEditorDialog.deletePageConfirm'), t('eventEditorDialog.deletePageTitle')); } catch { return; } props.draft.pages.splice(pageIndex.value, 1); pageIdentities.value.splice(pageIndex.value, 1); pageIndex.value = Math.max(0, pageIndex.value - 1); markDirty(); }
function setPageList(list: MvCommand[]) {
  if (!currentPage.value || currentPageLocked.value) return;
  currentPage.value.list = list;
}
function setImage(image: MvEventImage) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.image = image; markDirty(); } }
function openImagePicker() { if (currentPage.value && !currentPageLocked.value) imagePicker.value?.open(currentPage.value.image); }
function setPageRoute(route: MvMoveRoute) { if (currentPage.value && !currentPageLocked.value) { currentPage.value.moveRoute = route; markDirty(); } }
async function paintPreview() { const canvas = previewCanvas.value, image = currentPage.value?.image; if (!canvas || !image) return; const context = canvas.getContext('2d')!; context.clearRect(0,0,canvas.width,canvas.height); if (image.tileId) return drawTile(context, props.tilesetImages, image.tileId, 14, 10, 48, props.extendedTilesetSheets); const asset = props.catalog?.assets.characters.find((item) => item.name === image.characterName); if (!asset) return; const bitmap = await props.loadImage(asset.url); const frame = bitmap && eventCharacterFrame(bitmap, image); if (!bitmap || !frame) return; const scale = Math.min(1, 64 / frame.sw, 88 / frame.sh); context.imageSmoothingEnabled = false; context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, Math.round((canvas.width-frame.sw*scale)/2), Math.round((canvas.height-frame.sh*scale)/2), frame.sw*scale, frame.sh*scale); }
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
