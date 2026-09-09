<template>
  <section class="ev-commands" :class="{ locked, searching: findOpen }" @keydown="onLocalKeyDown">
    <strong v-if="title" class="ev-cmd-title">{{ title }}</strong>
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
    <div ref="listHost" class="command-list" @contextmenu.prevent="openCommandContext($event, null)">
      <div v-if="!spans.length" class="command-empty">
        {{ resolvedEmptyText }}
      </div>
      <template v-for="row in commandRows" :key="row.key">
        <button
          v-if="row.kind === 'blank'"
          type="button"
          :disabled="locked"
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
          :disabled="locked"
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
          :draggable="!locked"
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
    </div>
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
        <li><button type="button" :disabled="locked" @click="runCommandMenu(openPasteCommandsFromText)">{{ t('eventEditorDialog.pasteFromText') }}</button></li>
      </ul>
    </div>
  </section>
  <EventCommandDialog ref="commandDialog" :map-id="mapId ?? null" :catalog="catalog" :load-image="imageLoader" :event-x="eventX" :event-y="eventY" :current-events="currentEvents" :troop-members="troopMembers" :allow-this-event="allowThisEvent" @commit="commitCommand" @catalog-changed="emit('catalog-changed')" />
  <EventTextPasteDialog ref="textPasteDialog" @confirm="applyPastedCommandsText" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from '../../i18n';
import { clipboard as clipboardApi, projectConfig as projectConfigApi, type EditorProjectCatalog } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { commandDefinition, normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import { commandBlockSpanIndices, commandBranchScope, commandInsertionSlots, commandSpanDisplay, commandStructureBlocks, clone, dropCommandSpanBlocks, editableCommandSpans, ensureTerminator, moveCommandSpanBlock, skipTerminatorIndices, type MvCommand, type MvCommandInsertionSlot, type MvCommandSpanView } from '../../composables/useEventEditor';
import { resolvePluginColor } from '../../utils/pluginColor';
import { findCommandSpanIndices, nextCommandFindCursor } from '../console/command-list-find';
import EventCommandDialog from './EventCommandDialog.vue';
import EventTextPasteDialog from './EventTextPasteDialog.vue';
import type { EditorEventListItem } from './editorTypes';

const props = withDefaults(defineProps<{
  modelValue: MvCommand[];
  catalog: EditorProjectCatalog | null;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
  /** Map-host system data (switches/variables from the map payload); catalog fills the rest. */
  systemData?: { switches: string[]; variables: string[] } | null;
  mapId?: number | null;
  eventX?: number;
  eventY?: number;
  /** Map events of the hosting map; only provided by the map event editor. */
  currentEvents?: EditorEventListItem[];
  /** Enemy names of the owning troop, in member order; enables member-aware enemy index options. */
  troopMembers?: string[];
  /** "本事件" only exists for map events; common/troop hosts pass false. */
  allowThisEvent?: boolean;
  locked?: boolean;
  title?: string;
  emptyText?: string;
  /** Changes outside of edits (e.g. the map page tab) that reset selection/collapse state. */
  resetKey?: unknown;
  /** Map host: handle keys at window level (gated) instead of only when the list has focus. */
  globalShortcuts?: boolean;
  shortcutGate?: () => boolean;
}>(), {
  systemData: null,
  mapId: null,
  eventX: 0,
  eventY: 0,
  currentEvents: undefined,
  allowThisEvent: true,
  locked: false,
  title: '',
  emptyText: '',
  globalShortcuts: false,
});
const emit = defineEmits<{ 'update:modelValue': [value: MvCommand[]]; change: []; 'catalog-changed': [] }>();
const { language, t } = useI18n();
const projectStore = useProjectStore();
const selectedSpans = ref<number[]>([]), selectionAnchor = ref<number | null>(null), insertionFocus = ref<number | null>(null), commandClipboard = ref<MvCommand[] | null>(null);
const findOpen = ref(false), findQuery = ref(''), findCursor = ref(-1), findInputRef = ref<HTMLInputElement | null>(null), findTemporarilyExpandedHeads = ref<Set<number>>(new Set());
const commandDialog = ref<InstanceType<typeof EventCommandDialog>>(), textPasteDialog = ref<InstanceType<typeof EventTextPasteDialog>>();
const commandList = computed(() => props.modelValue);
const imageLoader = computed(() => props.loadImage || (() => Promise.resolve(null)));
const spans = computed(() => editableCommandSpans({ list: commandList.value } as never));
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
const skipTerminatorSet = computed(() => skipTerminatorIndices(commandList.value));
const insertionSlots = computed(() => commandInsertionSlots(commandList.value, spans.value));
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
watch(() => props.resetKey, () => resetListState());
function resetListState() {
  collapsedStructureHeads.value = new Set();
  findTemporarilyExpandedHeads.value = new Set();
  clearCommandSelection();
  if (listHost.value) listHost.value.scrollTop = 0;
}
const CMD_LINE_H = 20, CMD_ROW_CHROME = 8, CMD_BLANK_H = 22;
const listHost = ref<HTMLElement>();
/** Catalog name arrays indexed by entry id, matching the SystemData shape commandSpanDisplay consumes. */
function catalogNamedArray(entries: { id: number; name: string }[] | undefined): string[] {
  const result: string[] = [];
  for (const entry of entries || []) result[entry.id] = entry.name || '';
  return result;
}
function buildSpanView(span: Parameters<typeof commandSpanDisplay>[0]): MvCommandSpanView {
  const catalogSystemData = {
    switches: props.systemData?.switches ?? catalogNamedArray(props.catalog?.switches),
    variables: props.systemData?.variables ?? catalogNamedArray(props.catalog?.variables),
    actors: catalogNamedArray(props.catalog?.actors),
    classes: catalogNamedArray(props.catalog?.classes),
    skills: catalogNamedArray(props.catalog?.skills),
    items: catalogNamedArray(props.catalog?.items),
    weapons: catalogNamedArray(props.catalog?.weapons),
    armors: catalogNamedArray(props.catalog?.armors),
    states: catalogNamedArray(props.catalog?.states),
    enemies: catalogNamedArray(props.catalog?.enemies),
    troops: catalogNamedArray(props.catalog?.troops),
    tilesets: catalogNamedArray(props.catalog?.tilesets),
    commonEvents: catalogNamedArray(props.catalog?.commonEvents),
    animations: catalogNamedArray(props.catalog?.animations),
  };
  const view = commandSpanDisplay(
    span,
    catalogSystemData,
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
  }

  const tail = slotBySpanIndex.get(spans.value.length);
  if (tail) rows.push({ kind: 'blank', key: tail.key, no, slot: tail });

  return rows;
});
function commandRowHeight(row: CommandRenderRow): number {
  if (row.kind === 'blank') return CMD_BLANK_H;
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
const resolvedEmptyText = computed(() => props.emptyText || t('eventEditorDialog.emptyHint'));
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
function openCommandPicker() { if (props.locked) return; const focusedSlot = insertionFocus.value == null ? null : insertionSlots.value.find((slot) => slot.spanIndex === insertionFocus.value) || null; if (focusedSlot) { openCommandPickerAt(focusedSlot); return; } const anchor = anchorBlockSelection.value, selected = selectedIndices.value, next = visibleInsertionTarget(anchor != null ? anchor + 1 : selected.length ? selected[selected.length - 1] + 1 : spans.value.length); const slot = insertionSlots.value.find((item) => item.spanIndex === next) || insertionSlots.value.at(-1); if (slot) openCommandPickerAt(slot); }
function openCommandPickerAt(slot: MvCommandInsertionSlot) { if (props.locked) return; insertionFocus.value = null; commandDialog.value?.openPicker(slot.spanIndex, slot.indent); }
function openCommand(index: number) {
  if (props.locked) return;
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
  commandDialog.value?.openEditor(commands, index, commandList.value, headSpan?.index ?? null);
}
function openSelectedCommand() { const anchor = anchorBlockSelection.value; if (anchor != null) openCommand(anchor); }
function commitList(list: MvCommand[]) {
  ensureTerminator(list);
  emit('update:modelValue', list);
  emit('change');
}
function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }) {
  if (props.locked) return;
  insertionFocus.value = null;
  const list = clone(commandList.value);
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
  clearCommandSelection();
  commitList(list);
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
  if (!result) return;
  const spanIndex = editableCommandSpans({ list: result.list } as never).findIndex((span) => span.index === result.headIndex);
  selectedSpans.value = spanIndex >= 0 ? [spanIndex] : [];
  selectionAnchor.value = spanIndex >= 0 ? spanIndex : null;
  commitList(result.list);
}
function moveSelectedCommandBlock(offset: -1 | 1) {
  const anchor = anchorBlockSelection.value;
  if (props.locked || anchor == null) return;
  applyCommandListMutation(moveCommandSpanBlock(commandList.value, spans.value, anchor, offset));
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
  if (props.locked) { event.preventDefault(); return; }
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
  if (!source.length || target == null || props.locked) return;
  applyCommandListMutation(dropCommandSpanBlocks(commandList.value, spans.value, source, target));
}
function resetRowDrag() { dragSourceIndices.value = []; dropIndicator.value = null; }
function deleteSelectedCommands() {
  if (props.locked || !selectedIndices.value.length) return;
  const list = clone(commandList.value);
  for (const index of commandBlockSpanIndices(spans.value, selectedIndices.value).reverse()) {
    const span = spans.value[index];
    if (span) list.splice(span.index, span.commands.length);
  }
  clearCommandSelection();
  commitList(list);
}
function copySelectedCommands(showMessage = true) {
  if (props.locked || !selectedIndices.value.length) return;
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
  if (!commandClipboard.value || props.locked) return;
  const list = clone(commandList.value);
  const selected = selectedIndices.value, next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
  const at = next >= spans.value.length ? list.length - 1 : spans.value[next].index;
  list.splice(at, 0, ...clone(commandClipboard.value));
  clearCommandSelection();
  commitList(list);
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
  if (props.locked) return;
  textPasteDialog.value?.open(t('eventText.pasteCommandsTitle'), t('eventText.commandsPlaceholder'));
}
// Paste RM-native command JSON. Reject malformed input loudly instead of guessing a shape.
function applyPastedCommandsText(text: string) {
  if (props.locked) return;
  let parsed: unknown;
  const json = text.startsWith('◆') ? text.slice(1) : text;
  try { parsed = JSON.parse(json); }
  catch { ElMessage.error(t('eventText.invalidJson')); return; }
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every(isMvCommandShape)) { ElMessage.error(t('eventText.invalidCommands')); return; }
  const engine = projectStore.currentProjectInfo?.engine || 'rpg-maker-mv';
  const commands = (parsed as MvCommand[]).map((command) => normalizeEventCommandParameters(clone(command), engine));
  const list = clone(commandList.value);
  const selected = selectedIndices.value, next = visibleInsertionTarget(selected.length ? selected[selected.length - 1] + 1 : spans.value.length);
  const at = next >= spans.value.length ? list.length - 1 : spans.value[next].index;
  list.splice(at, 0, ...commands);
  clearCommandSelection();
  commitList(list);
}
function openCommandContext(event: MouseEvent, index: number | null, slot: MvCommandInsertionSlot | null = null) {
  if (props.locked) return;
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
  return true;
}
/** Escape handling shared by both key modes; returns true when it closed something. */
function handleEscape(): boolean {
  if (cmdContext.visible) { closeCommandContext(); return true; }
  if (findOpen.value) { closeFind(); return true; }
  return false;
}
function handleCommandKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'f' && isFindShortcutTarget(target)) {
    event.preventDefault();
    openFind();
    return;
  }
  if (findOpen.value && target === findInputRef.value && (event.key === 'Enter' || event.key === 'F3' || event.code === 'F3')) {
    event.preventDefault();
    moveFind(event.shiftKey ? -1 : 1);
    return;
  }
  if (props.locked) return;
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
function onGlobalKeyDown(event: KeyboardEvent) {
  if (props.shortcutGate && !props.shortcutGate()) return;
  if (event.key === 'Escape') return;
  handleCommandKeyDown(event);
}
function onLocalKeyDown(event: KeyboardEvent) {
  if (props.globalShortcuts) return;
  if (event.key === 'Escape') {
    if (handleEscape()) event.preventDefault();
    return;
  }
  handleCommandKeyDown(event);
}
onMounted(() => {
  if (props.globalShortcuts) window.addEventListener('keydown', onGlobalKeyDown);
});
onUnmounted(() => {
  if (props.globalShortcuts) window.removeEventListener('keydown', onGlobalKeyDown);
});
defineExpose({ handleEscape });
</script>

<style scoped>
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

.ev-commands.locked {
  opacity: 0.68;
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
  min-height: 168px;
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

.cmd-row {
  position: relative;
  width: 100%;
  min-height: 18px;
  height: auto;
  flex: 0 0 auto;
  display: block;
  padding: 0px 8px 0px calc(50px + var(--cmd-indent, 0px));
  border: 1px solid transparent;
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
  font-family: Consolas;
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
</style>
