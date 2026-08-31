<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { projectConfig as projectConfigApi, type EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import { resolvePluginColor } from '../../utils/pluginColor';
import { findCommandSpanIndices, nextCommandFindCursor } from './command-list-find';
import {
  clone,
  commandBlockSpanIndices,
  commandBranchScope,
  commandInsertionSlots,
  commandSpanDisplay,
  commandStructureBlocks,
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
const commandListRef = ref<HTMLElement | null>(null);
const findInputRef = ref<HTMLInputElement | null>(null);
const findOpen = ref(false);
const findQuery = ref('');
const findCursor = ref(-1);
const findTemporarilyExpandedHeads = ref<Set<number>>(new Set());

const commandList = computed<MvCommand[]>(() => normalizeCommandList(props.modelValue));
const spans = computed(() => editableCommandSpans({ list: commandList.value } as never));
const projectStore = useProjectStore();
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
function pluginNameOf(command: MvCommand | undefined): string {
  if (!command) return '';
  if (command.code === 357) return String(command.parameters[0] ?? '');
  if (command.code === 356) return String(command.parameters[0] ?? '').split(/\s+/).filter(Boolean)[0] || '';
  return '';
}
function pluginColorForSpan(spanIndex: number): string {
  const span = spans.value[spanIndex];
  const name = pluginNameOf(span?.commands[0]);
  return name ? resolvePluginColor(name, pluginColors.value) : '';
}
const skipTerminatorSet = computed(() => skipTerminatorIndices(commandList.value));
const selectedIndices = computed(() => selectedSpans.value
  .filter((index) => index >= 0 && index < spans.value.length)
  .sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
// Blank insertion slots follow the visual selection when both adjacent spans
// are selected (whole-block click or Shift range); they stay non-editable.
function slotSelected(slot: MvCommandInsertionSlot): boolean {
  return selectedSpanSet.value.has(slot.spanIndex) && selectedSpanSet.value.has(slot.spanIndex - 1);
}
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
const findMatches = computed(() => findCommandSpanIndices(spanViews.value, findQuery.value));
const activeFindSpanIndex = computed(() => {
  const cursor = findCursor.value;
  return cursor >= 0 ? findMatches.value[cursor] ?? null : null;
});
// Structure-block collapse mirrors the event editor contract: keyed by the
// head span index; body spans and their insertion slots stay hidden while
// collapsed, the head row remains as the expand handle.
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
const visibleInsertionSlots = computed(() => insertionSlots.value.filter((slot) => !collapsedHiddenSpans.value.has(slot.spanIndex)));
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
watch(() => props.modelValue, () => {
  collapsedStructureHeads.value = new Set();
  findTemporarilyExpandedHeads.value = new Set();
});
watch(findMatches, (matches) => {
  findCursor.value = matches.length ? 0 : -1;
  if (findOpen.value && matches.length) void nextTick(() => scrollToFindMatch(matches[0]!));
});
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
  const row = commandListRef.value?.querySelector<HTMLElement>(`[data-command-span="${index}"]`);
  row?.scrollIntoView({ block: 'nearest' });
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
  const next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
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
  const headSpan = spans.value[block[0] ?? index];
  commandDialog.value?.openEditor(commands, index, commandList.value, headSpan?.index ?? null);
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
  const next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
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
  const raw = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  dropIndicator.value = visibleInsertionTarget(raw);
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
  if (element.closest('input, textarea, select, button:not(.cmd-row), .CodeMirror, .cmd-context-menu, .editor-modal-overlay')) return false;
  return true;
}

function isFindShortcutTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (element.isContentEditable || element.closest('[contenteditable], .CodeMirror')) return false;
  if (element.closest('input, textarea, select, button:not(.cmd-row), .cmd-context-menu, .editor-modal-overlay, [role="dialog"]')) return false;
  return true;
}

function onCommandKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'f' && isFindShortcutTarget(target)) {
    event.preventDefault();
    openFind();
    return;
  }
  if (findOpen.value && !target?.closest('.editor-modal-overlay')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
      return;
    }
    if (target === findInputRef.value && (event.key === 'Enter' || event.key === 'F3' || event.code === 'F3')) {
      event.preventDefault();
      moveFind(event.shiftKey ? -1 : 1);
      return;
    }
  }
  if (props.locked || !isCommandShortcutTarget(target)) return;
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
        <button type="button" @click="openFind">{{ t('cmdList.find') }}</button>
        <button type="button" :disabled="locked" @click="insertionFocus = null; openCommandPicker()">{{ t('cmdList.add') }}</button>
        <button type="button" :disabled="locked || anchorBlockSelection == null" @click="openSelectedCommand">{{ t('cmdList.edit') }}</button>
        <button type="button" :disabled="locked || !canMoveUp" @click="moveSelectedCommand(-1)">{{ t('cmdList.moveUp') }}</button>
        <button type="button" :disabled="locked || !canMoveDown" @click="moveSelectedCommand(1)">{{ t('cmdList.moveDown') }}</button>
        <button type="button" :disabled="locked || !selectedIndices.length" class="danger" @click="deleteSelectedCommands">{{ t('cmdList.delete') }}</button>
      </div>
    </div>
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
    <div ref="commandListRef" class="command-list" @click.self="clearSelection" @dblclick.self="openCommandPicker" @contextmenu.prevent="openCommandContext($event, null)">
      <div v-if="!spans.length" class="command-empty">{{ resolvedEmptyText }}</div>
      <template v-for="slot in visibleInsertionSlots" :key="slot.key">
        <button
          type="button"
          :disabled="locked"
          class="cmd-row cmd-blank"
          :class="{ even: slot.spanIndex % 2 === 0, terminator: slot.spanIndex === spans.length, focused: insertionFocus === slot.spanIndex, 'drop-before': dropIndicator === slot.spanIndex, selected: slotSelected(slot) }"
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
          :class="{ selected: selectedSpanSet.has(slot.spanIndex), even: slot.spanIndex % 2 === 0, 'drop-before': dropIndicator === slot.spanIndex, 'find-hit': activeFindSpanIndex === slot.spanIndex, [`tone-${view.tone}`]: true, [`role-${view.role}`]: true }"
          :data-command-span="slot.spanIndex"
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
          <span
            v-if="view.role === 'head'"
            class="cmd-caret"
            :class="{ collapsed: collapsedStructureHeads.has(slot.spanIndex) }"
            role="button"
            :aria-label="collapsedStructureHeads.has(slot.spanIndex) ? t('eventEditorDialog.expandBlock') : t('eventEditorDialog.collapseBlock')"
            @click.stop="toggleStructureCollapse(slot.spanIndex)"
            @dblclick.stop
          />
          <span v-if="view.role === 'head' && pluginColorForSpan(slot.spanIndex)" class="cmd-plugin-stripe" :style="{ background: pluginColorForSpan(slot.spanIndex) }" />
          <span class="cmd-line cmd-head">{{ view.head }}</span>
          <span v-if="view.lines.length > 1" class="cmd-line cmd-sub cmd-descriptions" :class="{
              'is-table': view.lines[0].split('=').length > 1,
              'is-many': view.lines.length > 4
            }">
            <template v-for="(line, lineIndex) in view.lines" :key="lineIndex">
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
            <span v-for="(line, lineIndex) in view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span>
          </template>
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
.command-find {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 5px;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
}
.command-find input {
  flex: 1 1 140px;
  min-width: 0;
  height: 24px;
  padding: 3px 7px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 5px;
  background: transparent;
  color: var(--console-text,#211d17);
  font: inherit;
  font-size: 11px;
}
.command-find-status {
  min-width: 48px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
  text-align: center;
  white-space: nowrap;
}
.command-find button {
  min-width: 24px;
  height: 24px;
  padding: 2px 5px;
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
.cmd-plugin-stripe {
  position: absolute;
  left: calc(2px + var(--cmd-indent, 0px));
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 1px;
}
.cmd-caret {
  position: absolute;
  left: 2px;
  top: 50%;
  display: grid;
  place-items: center;
  width: 11px;
  height: 12px;
  transform: translateY(-50%);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
}
.cmd-row.role-head {
  padding-left: calc(15px + var(--cmd-indent, 0px));
}
.cmd-caret::before {
  content: '\25BE';
}
.cmd-caret.collapsed::before {
  content: '\25B8';
}
.cmd-row.selected .cmd-caret {
  color: inherit;
}
.cmd-row.cmd-blank {
  /* RM-native compact list: insertion slots are hidden by default and only
     revealed when focused or targeted by a drag. This keeps the command list
     tight (one row per command) instead of spacing every pair. Hover does not
     reveal a slot (display:none cannot be hovered); use the toolbar Add button,
     Enter, or the context menu to insert between commands. */
  display: none;
  min-height: 20px;
  padding-top: 2px;
  padding-bottom: 2px;
  color: var(--console-text-muted,#9a8e7e);
  cursor: default;
  user-select: none;
}
.cmd-row.cmd-blank.focused,
.cmd-row.cmd-blank.drop-before,
.cmd-row.cmd-blank.selected {
  display: block;
}
.cmd-row.cmd-blank .cmd-line {
  visibility: hidden;
}
.cmd-row.cmd-blank.focused .cmd-line,
.cmd-row.cmd-blank.drop-before .cmd-line,
.cmd-row.cmd-blank.selected .cmd-line {
  visibility: visible;
}
.cmd-row.cmd-blank.selected {
  background: var(--console-accent,#be5630);
  color: #fff;
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
.cmd-row.find-hit:not(.selected) {
  outline: 1px solid var(--console-accent,#be5630);
  outline-offset: -1px;
  background: var(--console-accent-soft,#f6e3d7);
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
  row-gap: 6px;
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
  flex-direction: row;
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
  font-size: 10px;
  min-width: 80px;
  text-align: right;
  margin-right: 10px;
  padding: 0px 10px;
}
.cmd-sub.cmd-descriptions > .cmd-description-item > .cmd-description-value {
  text-align: left;
  display: inline-block;
  word-wrap: break-word;
  white-space: normal;
  max-width: calc(100% - 100px);
}
</style>
