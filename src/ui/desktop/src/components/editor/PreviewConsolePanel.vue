<template>
  <EditorBottomWorkbench
    :open="open"
    :title="t('editor.preview.workbench')"
    :badge="t('editor.preview.consoleOutputCount', { count: entries.length })"
    :badge-empty="entries.length === 0"
    :collapse-label="t('editor.bottom.collapse')"
    :expand-label="t('editor.bottom.expand')"
    @toggle="$emit('toggle')"
  >
    <template #actions>
      <button
        type="button"
        class="header-action"
        :disabled="!entries.length"
        :title="t('editor.preview.consoleClear')"
        :aria-label="t('editor.preview.consoleClear')"
        @click="$emit('clear')"
      ><Delete /></button>
    </template>

    <div class="terminal" data-ui-id="preview-console" @keydown.ctrl.f.prevent="openFind">
      <div v-if="findOpen" class="find-bar">
        <input
          ref="findInputRef"
          v-model="query"
          type="text"
          :aria-label="t('editor.preview.consoleFind')"
          :placeholder="t('editor.preview.consoleFind')"
          @keydown.escape.prevent="closeFind"
        />
        <span>{{ t('editor.preview.consoleFindCount', { matched: filteredEntries.length, total: entries.length }) }}</span>
        <button type="button" :title="t('editor.preview.consoleCloseFind')" :aria-label="t('editor.preview.consoleCloseFind')" @click="closeFind"><Close /></button>
      </div>

      <div ref="terminalScrollRef" class="terminal-scroll" @click="focusInputFromTerminal" @scroll.passive="rememberScrollPosition">
        <div class="terminal-transcript" role="log" aria-live="polite">
          <div v-for="entry in filteredEntries" :key="entry.id" class="terminal-line" :class="entry.level">
            <template v-if="entry.level === 'command'">
              <span class="prompt-mark">&gt;</span>
              <pre>{{ entry.text }}</pre>
            </template>
            <template v-else>
              <time>{{ formatTime(entry.timestamp) }}</time>
              <span class="level">{{ entry.level }}</span>
              <span v-if="entry.requestId" class="request">#{{ entry.requestId }}</span>
              <pre>{{ entry.text }}</pre>
            </template>
          </div>
          <p v-if="!filteredEntries.length" class="terminal-empty">{{ t('editor.preview.consoleEmpty') }}</p>
        </div>
        <label class="terminal-prompt">
          <span class="prompt-mark" aria-hidden="true">&gt;</span>
          <textarea
            ref="inputRef"
            v-model="code"
            :aria-label="t('editor.preview.consoleInput')"
            :placeholder="t('editor.preview.consoleInput')"
            rows="1"
            spellcheck="false"
            @input="resizeInput"
            @keydown.ctrl.enter.prevent="execute"
            @keydown.up="browseHistory($event, -1)"
            @keydown.down="browseHistory($event, 1)"
          />
        </label>
      </div>
    </div>
  </EditorBottomWorkbench>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Close, Delete } from '@element-plus/icons-vue';
import { useI18n } from '../../i18n';
import EditorBottomWorkbench from './EditorBottomWorkbench.vue';
import {
  isPreviewTerminalNearBottom,
  previewTerminalEntryMatches,
  type PreviewTerminalEntry,
} from './previewTerminal';

const props = defineProps<{ open: boolean; entries: PreviewTerminalEntry[]; sessionId?: string }>();
const emit = defineEmits<{ execute: [code: string]; clear: []; toggle: [] }>();
const { t } = useI18n();
const query = ref('');
const findOpen = ref(false);
const code = ref('');
const terminalScrollRef = ref<HTMLElement>();
const inputRef = ref<HTMLTextAreaElement>();
const findInputRef = ref<HTMLInputElement>();
const history = ref<string[]>([]);
const historyIndex = ref(0);
const historyDraft = ref('');
const pinnedToBottom = ref(true);
const scrollAfterCommand = ref(false);
const filteredEntries = computed(() => props.entries.filter((entry) => previewTerminalEntryMatches(entry, query.value)));
const MAX_INPUT_LINES = 6;

function execute() {
  if (!code.value.trim()) return;
  scrollAfterCommand.value = true;
  emit('execute', code.value);
  if (history.value.at(-1) !== code.value) history.value.push(code.value);
  historyIndex.value = history.value.length;
  historyDraft.value = '';
  code.value = '';
  resizeInput();
}

function browseHistory(event: KeyboardEvent, direction: -1 | 1) {
  const input = inputRef.value;
  if (!input || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const atFirstLine = !code.value.slice(0, input.selectionStart).includes('\n');
  const atLastLine = !code.value.slice(input.selectionEnd).includes('\n');
  if ((direction < 0 && !atFirstLine) || (direction > 0 && !atLastLine) || !history.value.length) return;
  event.preventDefault();
  if (historyIndex.value === history.value.length) historyDraft.value = code.value;
  historyIndex.value = Math.max(0, Math.min(history.value.length, historyIndex.value + direction));
  code.value = historyIndex.value === history.value.length ? historyDraft.value : history.value[historyIndex.value];
  nextTick(() => {
    input.setSelectionRange(code.value.length, code.value.length);
    resizeInput();
  });
}

function openFind() {
  findOpen.value = true;
  nextTick(() => findInputRef.value?.select());
}
function closeFind() {
  findOpen.value = false;
  query.value = '';
  nextTick(() => inputRef.value?.focus());
}
function formatTime(timestamp: number) { return new Date(timestamp).toLocaleTimeString([], { hour12: false }); }
function focusInputFromTerminal(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('.terminal-line, .terminal-prompt, .find-bar')) return;
  if (window.getSelection()?.toString()) return;
  inputRef.value?.focus();
}
function resizeInput() {
  nextTick(() => {
    const input = inputRef.value;
    if (!input) return;
    input.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 16;
    const maxHeight = lineHeight * MAX_INPUT_LINES;
    input.style.height = `${Math.max(lineHeight, Math.min(input.scrollHeight || lineHeight, maxHeight))}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    if (pinnedToBottom.value || scrollAfterCommand.value) scrollToBottom();
  });
}
function rememberScrollPosition() {
  const terminal = terminalScrollRef.value;
  if (terminal) pinnedToBottom.value = isPreviewTerminalNearBottom(terminal);
}
function scrollToBottom() {
  nextTick(() => {
    const terminal = terminalScrollRef.value;
    if (!terminal) return;
    terminal.scrollTop = terminal.scrollHeight;
    pinnedToBottom.value = true;
    scrollAfterCommand.value = false;
  });
}

watch(() => props.entries.length, () => {
  if (pinnedToBottom.value || scrollAfterCommand.value) scrollToBottom();
});
watch(() => props.open, (open) => { if (open) resizeInput(); });
watch(() => props.sessionId, () => {
  history.value = [];
  historyIndex.value = 0;
  historyDraft.value = '';
  code.value = '';
  query.value = '';
  findOpen.value = false;
  pinnedToBottom.value = true;
  resizeInput();
});
</script>

<style scoped>
.header-action{width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:var(--app-radius-sm);background:transparent;color:var(--app-ink-muted);cursor:pointer}
.header-action:hover:not(:disabled){background:var(--app-bg-sunken);color:var(--app-ink)}
.header-action:disabled{opacity:.35;cursor:not-allowed}.header-action:focus-visible{outline:2px solid var(--app-accent);outline-offset:-2px}.header-action :deep(svg){width:13px;height:13px}
.terminal{min-height:0;flex:1;display:grid;grid-template-rows:auto minmax(0,1fr);background:#101419;color:#d6dce4;font-family:var(--app-font-mono)}
.find-bar{height:30px;display:flex;align-items:center;gap:8px;padding:0 7px;border-bottom:1px solid #2a3038;background:#171c22}
.find-bar input{width:min(300px,40vw);height:22px;padding:0 7px;border:1px solid #3b444f;border-radius:2px;outline:0;background:#0d1116;color:#e0e6ed;font:10px var(--app-font-mono)}
.find-bar input:focus{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}.find-bar span{color:#7e8997;font-size:9px}.find-bar button{width:24px;height:24px;margin-left:auto;display:grid;place-items:center;border:0;background:transparent;color:#8994a2;cursor:pointer}.find-bar button:hover{color:#fff}.find-bar button :deep(svg){width:12px}
.terminal-scroll{min-height:0;padding:5px 9px 7px;overflow:auto;font:10px/1.55 var(--app-font-mono);user-select:text;scrollbar-color:#3b434d transparent;cursor:text}
.terminal-transcript{min-width:0}
.terminal-line{display:flex;align-items:flex-start;gap:7px;min-height:17px}.terminal-line time{flex:none;color:#65707e}.terminal-line .level{width:34px;flex:none;color:#8197ad;text-transform:uppercase}.terminal-line.warn .level{color:#e3b75e}.terminal-line.error .level{color:#ef836f}.terminal-line.result .level{color:#75c797}.terminal-line .request{flex:none;color:#9a86cd}.terminal-line pre{min-width:0;margin:0;color:#d3dae2;white-space:pre-wrap;overflow-wrap:anywhere}.terminal-line.command{margin:4px 0 2px;color:#f0f3f7}.terminal-line.command .prompt-mark{width:12px;flex:none;color:#75c797;font-weight:800}.terminal-line.command pre{color:#f0f3f7}.terminal-empty{margin:4px 0;color:#697482}
.terminal-prompt{min-height:17px;display:grid;grid-template-columns:12px minmax(0,1fr);align-items:start;gap:7px;margin-top:2px;color:#75c797;font:700 11px/1.55 var(--app-font-mono);cursor:text}
.terminal-prompt textarea{box-sizing:border-box;min-width:0;width:100%;height:17px;max-height:102px;padding:0;border:0;outline:0;resize:none;background:transparent;color:#edf1f5;font:11px/1.55 var(--app-font-mono);scrollbar-color:#3b434d transparent}.terminal-prompt textarea::placeholder{color:#65707e}.terminal-prompt:focus-within .prompt-mark{color:#9ae6b4}
</style>
