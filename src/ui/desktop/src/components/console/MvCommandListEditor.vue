<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  clone,
  commandBlockSpanIndices,
  commandBranchScope,
  commandInsertionSlots,
  commandSpanDisplay,
  dropCommandSpanBlocks,
  editableCommandSpans,
  ensureTerminator,
  moveCommandSpanBlock,
  skipTerminatorIndices,
  type MvCommand,
  type MvCommandInsertionSlot,
  type MvCommandSpanView,
} from '../../composables/useEventEditor';
import EventCommandDialog from '../editor/EventCommandDialog.vue';

type SpanView = MvCommandSpanView;

const props = withDefaults(defineProps<{
  modelValue: unknown;
  catalog: EditorProjectCatalog | null;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
  mapId?: number | null;
  emptyText?: string;
  locked?: boolean;
  /** Enemy names of the owning troop, in member order; enables member-aware enemy index options. */
  troopMembers?: string[];
}>(), {
  mapId: null,
  emptyText: '',
  locked: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: MvCommand[]]; 'catalog-changed': [] }>();
const { language, t } = useI18n();

const commandDialog = ref<InstanceType<typeof EventCommandDialog> | null>(null);
const selectedSpans = ref<number[]>([]);
const selectionAnchor = ref<number | null>(null);
const commandClipboard = ref<MvCommand[] | null>(null);
const commandContext = reactive({ visible: false, x: 0, y: 0 });
const dragSourceIndices = ref<number[]>([]);
const dropIndicator = ref<number | null>(null);
const insertionFocus = ref<number | null>(null);

const commandList = computed<MvCommand[]>(() => normalizeCommandList(props.modelValue));
const spans = computed(() => editableCommandSpans({ list: commandList.value } as never));
const skipTerminatorSet = computed(() => skipTerminatorIndices(commandList.value));
const selectedIndices = computed(() => selectedSpans.value
  .filter((index) => index >= 0 && index < spans.value.length)
  .sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
const anchorBlockSelection = computed(() => {
  const anchor = selectionAnchor.value;
  if (anchor == null || !selectedSpanSet.value.has(anchor)) return null;
  const block = commandBlockSpanIndices(spans.value, [anchor]);
  return block.length === selectedIndices.value.length && block.every((value, index) => value === selectedIndices.value[index]) ? anchor : null;
});
const systemData = computed(() => ({
  switches: namedArray(props.catalog?.switches || []),
  variables: namedArray(props.catalog?.variables || []),
}));
const spanViews = computed<SpanView[]>(() => spans.value.map((span) => displaySpan(span)));
const insertionSlots = computed(() => commandInsertionSlots(commandList.value, spans.value));
const canMoveUp = computed(() => anchorBlockSelection.value != null && commandBlockSpanIndices(spans.value, [anchorBlockSelection.value])[0] > 0);
const canMoveDown = computed(() => {
  if (anchorBlockSelection.value == null) return false;
  const block = commandBlockSpanIndices(spans.value, [anchorBlockSelection.value]);
  return block.at(-1)! < spans.value.length - 1;
});
const imageLoader = computed(() => props.loadImage || missingImageLoader);
const resolvedEmptyText = computed(() => props.emptyText || t('cmdList.emptyHint'));

function slotViews(slot: MvCommandInsertionSlot): SpanView[] {
  const view = spanViews.value[slot.spanIndex];
  return view ? [view] : [];
}

function missingImageLoader(): Promise<HTMLImageElement | null> {
  return Promise.resolve(null);
}

function namedArray(entries: { id: number; name: string }[]): string[] {
  const result: string[] = [];
  for (const entry of entries) result[entry.id] = entry.name || '';
  return result;
}

function normalizeCommandList(value: unknown): MvCommand[] {
  const source = Array.isArray(value) ? value : [];
  const list = clone(source) as MvCommand[];
  ensureTerminator(list);
  return list;
}

function displaySpan(span: Parameters<typeof commandSpanDisplay>[0]): SpanView {
  return commandSpanDisplay(
    span,
    systemData.value,
    language.value,
    skipTerminatorSet.value.has(span.index),
    t('eventEditor.command.skipEnd'),
  );
}

function commitList(value: MvCommand[]): void {
  const next = clone(value);
  ensureTerminator(next);
  emit('update:modelValue', next);
}

function openCommandPicker(): void {
  if (props.locked) return;
  const focusedSlot = insertionFocus.value == null
    ? null
    : insertionSlots.value.find((slot) => slot.spanIndex === insertionFocus.value) || null;
  if (focusedSlot) {
    openCommandPickerAt(focusedSlot);
    return;
  }
  const selected = selectedIndices.value;
  const next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
  const slot = insertionSlots.value.find((item) => item.spanIndex === next) || insertionSlots.value.at(-1);
  if (slot) openCommandPickerAt(slot);
}

function openCommandPickerAt(slot: MvCommandInsertionSlot): void {
  if (props.locked) return;
  insertionFocus.value = null;
  commandDialog.value?.openPicker(slot.spanIndex, slot.indent);
}

function openCommand(index: number): void {
  if (props.locked) return;
  insertionFocus.value = null;
  const span = spans.value[index];
  if (!span) return;
  const block = commandBlockSpanIndices(spans.value, [index]);
  const commands = block.length > 1 ? block.flatMap((spanIndex) => spans.value[spanIndex]?.commands || []) : span.commands;
  commandDialog.value?.openEditor(commands, index);
}

function openSelectedCommand(): void {
  if (anchorBlockSelection.value != null) openCommand(anchorBlockSelection.value);
}

function selectCommand(index: number, event: MouseEvent): void {
  insertionFocus.value = null;
  if (event.shiftKey && selectionAnchor.value != null) {
    if (commandBranchScope(spans.value, selectionAnchor.value) !== commandBranchScope(spans.value, index)) return;
    const start = Math.min(selectionAnchor.value, index);
    const end = Math.max(selectionAnchor.value, index);
    selectedSpans.value = Array.from({ length: end - start + 1 }, (_entry, offset) => start + offset);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    selectedSpans.value = selectedSpanSet.value.has(index)
      ? selectedIndices.value.filter((item) => item !== index)
      : [...selectedIndices.value, index];
    selectionAnchor.value = index;
    return;
  }
  selectedSpans.value = commandBlockSpanIndices(spans.value, [index]);
  selectionAnchor.value = index;
}

function selectAllCommands(): void {
  selectedSpans.value = spans.value.map((_span, index) => index);
  selectionAnchor.value = selectedSpans.value[0] ?? null;
}

function clearSelection(): void {
  selectedSpans.value = [];
  selectionAnchor.value = null;
  insertionFocus.value = null;
  closeCommandContext();
}

function focusInsertionSlot(slot: MvCommandInsertionSlot): void {
  selectedSpans.value = [];
  selectionAnchor.value = null;
  insertionFocus.value = slot.spanIndex;
  closeCommandContext();
}

function deleteSelectedCommands(): void {
  if (props.locked || !selectedIndices.value.length) return;
  const list = clone(commandList.value);
  for (const index of commandBlockSpanIndices(spans.value, selectedIndices.value).reverse()) {
    const span = spans.value[index];
    if (span) list.splice(span.index, span.commands.length);
  }
  clearSelection();
  commitList(list);
}

function copySelectedCommands(): void {
  if (props.locked || !selectedIndices.value.length) return;
  commandClipboard.value = clone(commandBlockSpanIndices(spans.value, selectedIndices.value)
    .flatMap((index) => spans.value[index]?.commands || []));
}

function cutSelectedCommands(): void {
  if (props.locked || !selectedIndices.value.length) return;
  copySelectedCommands();
  deleteSelectedCommands();
}

function pasteSelectedCommand(): void {
  if (props.locked || !commandClipboard.value) return;
  const list = clone(commandList.value);
  const selected = selectedIndices.value;
  const next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
  const at = next >= spans.value.length ? list.length - 1 : spans.value[next].index;
  list.splice(at, 0, ...clone(commandClipboard.value));
  clearSelection();
  commitList(list);
}

function moveSelectedCommand(offset: -1 | 1): void {
  if (props.locked || anchorBlockSelection.value == null) return;
  const selected = anchorBlockSelection.value;
  const result = moveCommandSpanBlock(commandList.value, spans.value, selected, offset);
  if (!result) return;
  selectedSpans.value = [selected + offset];
  selectionAnchor.value = selected + offset;
  commitList(result.list);
}

function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }): void {
  if (props.locked) return;
  insertionFocus.value = null;
  const list = clone(commandList.value);
  if (payload.editSpan == null) {
    const at = payload.insertSpan == null || payload.insertSpan >= spans.value.length
      ? list.length - 1
      : spans.value[payload.insertSpan].index;
    list.splice(at, 0, ...payload.commands);
  } else {
    const block = commandBlockSpanIndices(spans.value, [payload.editSpan]);
    const first = block[0] == null ? null : spans.value[block[0]];
    const lastIndex = block.at(-1);
    const last = lastIndex == null ? null : spans.value[lastIndex];
    if (first && last) list.splice(first.index, last.index + last.commands.length - first.index, ...payload.commands);
  }
  clearSelection();
  commitList(list);
}

function openCommandContext(event: MouseEvent, index: number | null, slot: MvCommandInsertionSlot | null = null): void {
  if (props.locked) return;
  if (slot) {
    selectedSpans.value = [];
    selectionAnchor.value = null;
    insertionFocus.value = slot.spanIndex;
    closeCommandContext();
  } else if (index == null) clearSelection();
  else if (!selectedSpanSet.value.has(index)) {
    selectedSpans.value = commandBlockSpanIndices(spans.value, [index]);
    selectionAnchor.value = index;
  }
  const root = (event.currentTarget as HTMLElement | null)?.closest('.mv-command-editor') as HTMLElement | null;
  const rect = root?.getBoundingClientRect();
  const width = 190;
  const height = 260;
  commandContext.x = rect ? Math.max(rect.left + 4, Math.min(event.clientX, rect.right - width - 4)) : event.clientX;
  commandContext.y = rect ? Math.max(rect.top + 4, Math.min(event.clientY, rect.bottom - height - 4)) : event.clientY;
  commandContext.visible = true;
}

function closeCommandContext(): void {
  commandContext.visible = false;
}

function runCommandContext(action: () => void): void {
  closeCommandContext();
  action();
}

function onRowDragStart(index: number, event: DragEvent): void {
  if (props.locked) { event.preventDefault(); return; }
  insertionFocus.value = null;
  if (!selectedSpanSet.value.has(index)) {
    selectedSpans.value = [index];
    selectionAnchor.value = index;
  }
  dragSourceIndices.value = commandBlockSpanIndices(spans.value, selectedSpanSet.value.has(index) ? selectedIndices.value : [index]);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onRowDragOver(index: number, event: DragEvent): void {
  if (!dragSourceIndices.value.length) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropIndicator.value = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function onInsertionDragOver(index: number, event: DragEvent): void {
  if (!dragSourceIndices.value.length) return;
  dropIndicator.value = index;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function onRowDrop(): void {
  const source = dragSourceIndices.value;
  const target = dropIndicator.value;
  resetRowDrag();
  if (props.locked || !source.length || target == null) return;
  const result = dropCommandSpanBlocks(commandList.value, spans.value, source, target);
  if (!result) return;
  clearSelection();
  commitList(result.list);
}

function resetRowDrag(): void {
  dragSourceIndices.value = [];
  dropIndicator.value = null;
}

function isCommandShortcutTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable || element.closest('[contenteditable]')) return false;
  if (element.closest('input, textarea, select, button:not(.cmd-row), .cmd-context-menu, .editor-modal-overlay')) return false;
  return true;
}

function onCommandKeyDown(event: KeyboardEvent): void {
  if (props.locked || !isCommandShortcutTarget(event.target)) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    openCommandPicker();
    return;
  }
  if (event.code === 'Space' && anchorBlockSelection.value != null) {
    event.preventDefault();
    openSelectedCommand();
    return;
  }
  if (event.key === 'Delete' && selectedIndices.value.length) {
    event.preventDefault();
    deleteSelectedCommands();
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'x' && selectedIndices.value.length) {
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
  }
}
</script>

<template>
  <section class="mv-command-editor" @keydown="onCommandKeyDown">
    <div class="command-toolbar">
      <span>{{ t('cmdList.commandCount', { count: spans.length }) }}</span>
      <div>
        <button type="button" :disabled="locked" @click="insertionFocus = null; openCommandPicker()">{{ t('cmdList.add') }}</button>
        <button type="button" :disabled="locked || anchorBlockSelection == null" @click="openSelectedCommand">{{ t('cmdList.edit') }}</button>
        <button type="button" :disabled="locked || !canMoveUp" @click="moveSelectedCommand(-1)">{{ t('cmdList.moveUp') }}</button>
        <button type="button" :disabled="locked || !canMoveDown" @click="moveSelectedCommand(1)">{{ t('cmdList.moveDown') }}</button>
        <button type="button" :disabled="locked || !selectedIndices.length" class="danger" @click="deleteSelectedCommands">{{ t('cmdList.delete') }}</button>
      </div>
    </div>
    <div class="command-list" @click.self="clearSelection" @dblclick.self="openCommandPicker" @contextmenu.prevent="openCommandContext($event, null)">
      <div v-if="!spans.length" class="command-empty">{{ resolvedEmptyText }}</div>
      <template v-for="slot in insertionSlots" :key="slot.key">
        <button
          type="button"
          :disabled="locked"
          class="cmd-row cmd-blank"
          :class="{ even: slot.spanIndex % 2 === 0, terminator: slot.spanIndex === spans.length, 'drop-before': dropIndicator === slot.spanIndex }"
          :style="{ '--cmd-indent': `${Math.min(slot.indent, 8) * 16}px` }"
          :aria-label="t('eventEditorDialog.newCmd')"
          :draggable="false"
          @focus="focusInsertionSlot(slot)"
          @click.stop="focusInsertionSlot(slot)"
          @dblclick.stop.prevent="openCommandPickerAt(slot)"
          @contextmenu.stop.prevent="openCommandContext($event, null, slot)"
          @dragover.prevent="onInsertionDragOver(slot.spanIndex, $event)"
          @drop.prevent="onRowDrop"
        ><span class="cmd-line">◆</span></button>
        <button
          v-for="view in slotViews(slot)"
          :key="view.key"
          type="button"
          :disabled="locked"
          class="cmd-row"
          :class="{ selected: selectedSpanSet.has(slot.spanIndex), even: slot.spanIndex % 2 === 0, 'drop-before': dropIndicator === slot.spanIndex, [`tone-${view.tone}`]: true, [`role-${view.role}`]: true }"
          :style="{ '--cmd-indent': `${Math.min(view.indent, 8) * 16}px` }"
          :aria-pressed="selectedSpanSet.has(slot.spanIndex)"
          :draggable="!locked"
          @click="selectCommand(slot.spanIndex, $event)"
          @dblclick="openCommand(slot.spanIndex)"
          @contextmenu.stop.prevent="openCommandContext($event, slot.spanIndex)"
          @dragstart="onRowDragStart(slot.spanIndex, $event)"
          @dragover.prevent="onRowDragOver(slot.spanIndex, $event)"
          @drop.prevent="onRowDrop"
          @dragend="resetRowDrag"
        >
          <span class="cmd-line cmd-head">{{ view.head }}</span>
          <span v-for="(line, lineIndex) in view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span>
        </button>
      </template>
    </div>
    <div v-if="commandContext.visible" class="cmd-context-mask" @mousedown.self="closeCommandContext" @contextmenu.self.prevent="closeCommandContext">
      <ul class="cmd-context-menu" :style="{ left: `${commandContext.x}px`, top: `${commandContext.y}px` }" role="menu" :aria-label="t('eventEditorDialog.commandActions')">
        <li><button type="button" @click="runCommandContext(openCommandPicker)">{{ t('eventEditorDialog.newCmd') }}</button></li>
        <li><button type="button" :disabled="anchorBlockSelection == null" @click="runCommandContext(openSelectedCommand)">{{ t('eventEditorDialog.editCmd') }}</button></li>
        <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandContext(cutSelectedCommands)">{{ t('eventEditorDialog.cut') }}</button></li>
        <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandContext(copySelectedCommands)">{{ t('eventEditorDialog.copy') }}</button></li>
        <li><button type="button" :disabled="!commandClipboard" @click="runCommandContext(pasteSelectedCommand)">{{ t('eventEditorDialog.paste') }}</button></li>
        <li><button type="button" :disabled="!selectedIndices.length" @click="runCommandContext(deleteSelectedCommands)">{{ t('cmdList.delete') }}</button></li>
        <li><button type="button" :disabled="!spans.length" @click="runCommandContext(selectAllCommands)">{{ t('eventEditorDialog.selectAll') }}</button></li>
      </ul>
    </div>
    <EventCommandDialog ref="commandDialog" :map-id="mapId" :catalog="catalog" :load-image="imageLoader" :troop-members="troopMembers" @commit="commitCommand" @catalog-changed="emit('catalog-changed')" />
  </section>
</template>

<style scoped>
.mv-command-editor {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.command-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
}
.command-toolbar>div {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-end;
}
button {
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text-soft,#5a5247);
  padding: 5px 8px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: #d2a88c;
  color: var(--console-accent,#be5630);
}
button:disabled {
  opacity: .5;
  cursor: not-allowed;
}
button.danger {
  color: var(--app-danger,#b42318);
}
.command-list {
  min-height: 168px;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 8px;
  background: var(--console-paper,#fffdfa);
  padding: 5px;
}
.command-empty {
  display: grid;
  place-items: center;
  min-height: 110px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
  text-align: center;
}
.cmd-row {
  position: relative;
  width: 100%;
  min-height: 24px;
  display: block;
  padding: 2px 8px 2px calc(8px + var(--cmd-indent, 0px));
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--console-text-soft,#5a5247);
  text-align: left;
  cursor: pointer;
}
.cmd-row.cmd-blank {
  min-height: 20px;
  color: var(--console-text-muted,#9a8e7e);
  cursor: default;
  user-select: none;
}
.cmd-row.cmd-blank:hover:not(:disabled) {
  background: var(--console-accent-soft,#f6e3d7);
  color: var(--console-accent,#be5630);
}
.cmd-row.cmd-blank::before {
  opacity: .55;
}
.cmd-row:not(:disabled) { cursor: grab; }
.cmd-row.cmd-blank:not(:disabled) { cursor: default; }
.cmd-row:not(:disabled):active { cursor: grabbing; }
.cmd-row::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 0;
  bottom: 0;
  width: var(--cmd-indent, 0px);
  background: repeating-linear-gradient(to right, var(--console-border,#e4dcce) 0 1px, transparent 1px 16px);
  pointer-events: none;
}
.cmd-row.selected::before { display: none; }
.cmd-row.drop-before { box-shadow: inset 0 2px 0 var(--console-accent,#be5630); }
.cmd-row.even:not(.selected) {
  background: rgba(241, 233, 219, .44);
}
.cmd-row:hover:not(.selected) {
  background: var(--console-accent-soft,#f6e3d7);
}
.cmd-row.selected {
  background: var(--console-accent,#be5630);
  color: #fff;
}
.cmd-line {
  display: block;
  min-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  font-size: 11px;
  line-height: 18px;
}
.cmd-sub {
  padding-left: 16px;
  color: var(--console-text,#211d17);
}
.cmd-row.selected .cmd-sub,
.cmd-row.selected .cmd-head {
  color: #fff;
}
.cmd-row.tone-text:not(.selected) .cmd-head { color: var(--console-text,#211d17); }
.cmd-row.tone-flow:not(.selected) .cmd-head { color: #6f5b91; }
.cmd-row.tone-data:not(.selected) .cmd-head { color: #4e7a5a; }
.cmd-row.tone-stage:not(.selected) .cmd-head { color: #4a6fa5; }
.cmd-row.tone-move:not(.selected) .cmd-head { color: #277772; }
.cmd-row.tone-raw:not(.selected) .cmd-head { color: var(--app-danger,#b42318); }
.cmd-row.role-branch:not(.selected) .cmd-head,
.cmd-row.role-terminator:not(.selected) .cmd-head { color: var(--console-text-muted,#9a8e7e); }
.cmd-row.terminator:not(.selected) .cmd-line { color: var(--console-text-muted,#9a8e7e); }
.cmd-context-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}
.cmd-context-menu {
  position: fixed;
  min-width: 190px;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
  box-shadow: 0 8px 24px rgb(67 49 33 / 20%);
  list-style: none;
  pointer-events: auto;
}
.cmd-context-menu li { margin: 0; padding: 0; }
.cmd-context-menu button {
  width: 100%;
  min-height: 27px;
  padding: 4px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--console-text-soft,#5a5247);
  text-align: left;
}
.cmd-context-menu button:hover:not(:disabled) { background: var(--console-accent-soft,#f6e3d7); }
.cmd-context-menu button:disabled { color: var(--console-text-muted,#9a8e7e); }
</style>
