<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  clone,
  commandBlockSpanIndices,
  commandDisplay,
  commandInsertIndent,
  commandTone,
  editableCommandSpans,
  ensureTerminator,
  type MvCommand,
  type MvCommandSpan,
} from '../../composables/useEventEditor';
import EventCommandDialog from '../editor/EventCommandDialog.vue';

interface SpanView {
  key: number;
  tone: string;
  indent: number;
  head: string;
  lines: string[];
}

const props = withDefaults(defineProps<{
  modelValue: unknown;
  catalog: EditorProjectCatalog | null;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
  mapId?: number | null;
  emptyText?: string;
}>(), {
  mapId: null,
  emptyText: '',
});

const emit = defineEmits<{ 'update:modelValue': [value: MvCommand[]] }>();
const { language, t } = useI18n();

const commandDialog = ref<InstanceType<typeof EventCommandDialog> | null>(null);
const selectedSpans = ref<number[]>([]);
const selectionAnchor = ref<number | null>(null);

const commandList = computed<MvCommand[]>(() => normalizeCommandList(props.modelValue));
const spans = computed(() => editableCommandSpans({ list: commandList.value } as never));
const selectedIndices = computed(() => selectedSpans.value
  .filter((index) => index >= 0 && index < spans.value.length)
  .sort((a, b) => a - b));
const selectedSpanSet = computed(() => new Set(selectedIndices.value));
const systemData = computed(() => ({
  switches: namedArray(props.catalog?.switches || []),
  variables: namedArray(props.catalog?.variables || []),
}));
const spanViews = computed<SpanView[]>(() => spans.value.map((span) => displaySpan(span)));
const canMoveUp = computed(() => selectedIndices.value.length === 1 && selectedIndices.value[0] > 0);
const canMoveDown = computed(() => selectedIndices.value.length === 1 && selectedIndices.value[0] < spans.value.length - 1);
const imageLoader = computed(() => props.loadImage || missingImageLoader);
const resolvedEmptyText = computed(() => props.emptyText || t('cmdList.emptyHint'));

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

function displaySpan(span: MvCommandSpan): SpanView {
  const head = commandDisplay(span.commands[0], systemData.value, language.value);
  return {
    key: span.index,
    tone: commandTone(span.commands[0].code),
    indent: head.indent,
    head: head.label,
    lines: span.commands.slice(1).map((command) => commandDisplay(command, systemData.value, language.value).label),
  };
}

function commitList(value: MvCommand[]): void {
  const next = clone(value);
  ensureTerminator(next);
  emit('update:modelValue', next);
}

function rawIndexForSpan(index: number): number {
  return index >= spans.value.length
    ? Math.max(0, commandList.value.length - 1)
    : spans.value[index]?.index || 0;
}

function openCommandPicker(): void {
  const selected = selectedIndices.value;
  const next = selected.length ? selected[selected.length - 1] + 1 : spans.value.length;
  commandDialog.value?.openPicker(next, commandInsertIndent(commandList.value, rawIndexForSpan(next)));
}

function openCommand(index: number): void {
  const span = spans.value[index];
  if (span) commandDialog.value?.openEditor(span.commands, index);
}

function openSelectedCommand(): void {
  if (selectedIndices.value.length === 1) openCommand(selectedIndices.value[0]);
}

function selectCommand(index: number, event: MouseEvent): void {
  if (event.shiftKey && selectionAnchor.value != null) {
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
  selectedSpans.value = [index];
  selectionAnchor.value = index;
}

function clearSelection(): void {
  selectedSpans.value = [];
  selectionAnchor.value = null;
}

function deleteSelectedCommands(): void {
  if (!selectedIndices.value.length) return;
  const list = clone(commandList.value);
  for (const index of commandBlockSpanIndices(spans.value, selectedIndices.value).reverse()) {
    const span = spans.value[index];
    if (span) list.splice(span.index, span.commands.length);
  }
  clearSelection();
  commitList(list);
}

function moveSelectedCommand(offset: -1 | 1): void {
  if (selectedIndices.value.length !== 1) return;
  const selected = selectedIndices.value[0];
  const expanded = commandBlockSpanIndices(spans.value, [selected]);
  const first = expanded[0];
  const last = expanded[expanded.length - 1];
  if (offset < 0 && first <= 0) return;
  if (offset > 0 && last >= spans.value.length - 1) return;

  const list = clone(commandList.value);
  const start = spans.value[first].index;
  const end = spans.value[last].index + spans.value[last].commands.length;
  const block = list.splice(start, end - start);
  if (offset < 0) {
    list.splice(spans.value[first - 1].index, 0, ...block);
    selectedSpans.value = [selected - 1];
    selectionAnchor.value = selected - 1;
  } else {
    const targetEnd = spans.value[last + 1].index + spans.value[last + 1].commands.length;
    list.splice(targetEnd - block.length, 0, ...block);
    selectedSpans.value = [selected + 1];
    selectionAnchor.value = selected + 1;
  }
  commitList(list);
}

function commitCommand(payload: { commands: MvCommand[]; editSpan: number | null; insertSpan: number | null }): void {
  const list = clone(commandList.value);
  if (payload.editSpan == null) {
    const at = payload.insertSpan == null || payload.insertSpan >= spans.value.length
      ? list.length - 1
      : spans.value[payload.insertSpan].index;
    list.splice(at, 0, ...payload.commands);
  } else {
    const span = spans.value[payload.editSpan];
    if (span) list.splice(span.index, span.commands.length, ...payload.commands);
  }
  clearSelection();
  commitList(list);
}
</script>

<template>
  <section class="mv-command-editor">
    <div class="command-toolbar">
      <span>{{ t('cmdList.commandCount', { count: spans.length }) }}</span>
      <div>
        <button type="button" @click="openCommandPicker">{{ t('cmdList.add') }}</button>
        <button type="button" :disabled="selectedIndices.length !== 1" @click="openSelectedCommand">{{ t('cmdList.edit') }}</button>
        <button type="button" :disabled="!canMoveUp" @click="moveSelectedCommand(-1)">{{ t('cmdList.moveUp') }}</button>
        <button type="button" :disabled="!canMoveDown" @click="moveSelectedCommand(1)">{{ t('cmdList.moveDown') }}</button>
        <button type="button" :disabled="!selectedIndices.length" class="danger" @click="deleteSelectedCommands">{{ t('cmdList.delete') }}</button>
      </div>
    </div>
    <div class="command-list" @click.self="clearSelection" @dblclick.self="openCommandPicker">
      <div v-if="!spans.length" class="command-empty">{{ resolvedEmptyText }}</div>
      <button
        v-for="(view, index) in spanViews"
        :key="view.key"
        type="button"
        class="cmd-row"
        :class="{ selected: selectedSpanSet.has(index), even: index % 2 === 0, [`tone-${view.tone}`]: true }"
        :style="{ '--cmd-indent': `${Math.min(view.indent, 8) * 16}px` }"
        :aria-pressed="selectedSpanSet.has(index)"
        @click="selectCommand(index, $event)"
        @dblclick="openCommand(index)"
      >
        <span class="cmd-line cmd-head">{{ view.head }}</span>
        <span v-for="(line, lineIndex) in view.lines" :key="lineIndex" class="cmd-line cmd-sub">{{ line }}</span>
      </button>
      <button type="button" class="cmd-row terminator" :class="{ even: spans.length % 2 === 0 }" @click="clearSelection" @dblclick="openCommandPicker">
        <span class="cmd-line">◆</span>
      </button>
    </div>
    <EventCommandDialog ref="commandDialog" :map-id="mapId" :catalog="catalog" :load-image="imageLoader" @commit="commitCommand" />
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
.cmd-row.terminator:not(.selected) .cmd-line { color: var(--console-text-muted,#9a8e7e); }
</style>
