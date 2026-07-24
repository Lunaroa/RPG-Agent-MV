<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="system-named-overlay editor-modal-overlay"
      :data-editor-dialog-layer="LAYER_Z.subDialog"
      @mousedown.self="close"
    >
      <section
        class="system-named-dialog editor-modal-shell"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="editor-modal-header">
          <strong :id="titleId" class="editor-modal-title">{{ dialogTitle }}</strong>
          <button
            type="button"
            class="editor-modal-close"
            :aria-label="t('eventcmd.close')"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="system-named-body">
          <aside class="system-named-ranges" aria-label="ranges">
            <button
              v-for="range in ranges"
              :key="`${range.start}-${range.end}`"
              type="button"
              class="system-named-range"
              :class="{ active: activeRangeStart === range.start }"
              @click="activeRangeStart = range.start"
            >
              [ {{ formatSystemNamedEntryId(range.start) }} - {{ formatSystemNamedEntryId(range.end) }} ]
            </button>
            <button
              type="button"
              class="system-named-maximum"
              :disabled="busy"
              @click="changeMaximum"
            >
              {{ t('systemNamedEntry.changeMaximum') }}
            </button>
          </aside>

          <div class="system-named-list" role="listbox" :aria-label="dialogTitle">
            <button
              type="button"
              class="system-named-item"
              :class="{ active: selectedId === 0 }"
              role="option"
              :aria-selected="selectedId === 0"
              @click="selectEntry(0)"
              @dblclick="commit"
            >
              {{ formatSystemNamedEntryId(0) }} {{ t('systemNamedEntry.none') }}
            </button>
            <button
              v-for="entry in pageEntries"
              :key="entry.id"
              type="button"
              class="system-named-item"
              :class="{ active: selectedId === entry.id }"
              role="option"
              :aria-selected="selectedId === entry.id"
              @click="selectEntry(entry.id)"
              @dblclick="commit"
            >
              {{ formatSystemNamedEntryId(entry.id) }}
              <span v-if="entry.displayName">{{ entry.displayName }}</span>
            </button>
          </div>
        </div>

        <div class="system-named-name-row">
          <label for="system-named-entry-name">{{ t('systemNamedEntry.name') }}</label>
          <input
            id="system-named-entry-name"
            v-model="draftName"
            type="text"
            spellcheck="false"
            :disabled="busy || selectedId <= 0"
            @keydown.enter.prevent="saveName"
            @blur="saveName"
          />
        </div>

        <p v-if="error" class="system-named-error" role="alert">{{ error }}</p>

        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" :disabled="busy" @click="close">
            {{ t('eventcmd.cancel') }}
          </button>
          <button type="button" class="editor-btn" :disabled="busy" @click="applySelection">
            {{ t('systemNamedEntry.apply') }}
          </button>
          <button type="button" class="editor-btn primary" :disabled="busy" @click="commit">
            {{ t('eventcmd.ok') }}
          </button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { EditorProjectCatalog, NamedCatalogEntry } from '../../api/client';
import { projectManagement } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import {
  SYSTEM_NAMED_ENTRY_LIMIT,
  buildSystemNamedEntryRanges,
  displaySystemNamedEntryName,
  formatSystemNamedEntryId,
} from '../../utils/systemNamedEntryRanges';

export type SystemNamedEntryKind = 'switch' | 'variable';

interface OpenOptions {
  kind: SystemNamedEntryKind;
  selectedId?: number;
  title?: string;
  allowNone?: boolean;
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  commit: [payload: { kind: SystemNamedEntryKind; id: number }];
  'catalog-changed': [];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const visible = ref(false);
const busy = ref(false);
const error = ref('');
const kind = ref<SystemNamedEntryKind>('switch');
const titleOverride = ref('');
const allowNone = ref(true);
const selectedId = ref(0);
const draftName = ref('');
const activeRangeStart = ref(1);
const localEntries = ref<NamedCatalogEntry[]>([]);
const titleId = 'system-named-entry-title';

const dialogTitle = computed(() =>
  titleOverride.value
  || (kind.value === 'switch'
    ? t('systemNamedEntry.switchTitle')
    : t('systemNamedEntry.variableTitle')),
);

const maximum = computed(() => {
  const fromLocal = localEntries.value.reduce((max, entry) => Math.max(max, entry.id), 0);
  return Math.max(fromLocal, 1);
});

const ranges = computed(() => buildSystemNamedEntryRanges(maximum.value));

const pageEntries = computed(() => {
  const range = ranges.value.find((entry) => entry.start === activeRangeStart.value)
    || ranges.value[0];
  if (!range) return [];
  const byId = new Map(localEntries.value.map((entry) => [entry.id, entry]));
  const rows: Array<{ id: number; displayName: string }> = [];
  for (let id = range.start; id <= range.end; id += 1) {
    const name = byId.get(id)?.name || '';
    rows.push({
      id,
      displayName: displaySystemNamedEntryName(id, name),
    });
  }
  return rows;
});

watch(ranges, (next) => {
  if (!next.some((range) => range.start === activeRangeStart.value)) {
    activeRangeStart.value = next[0]?.start || 1;
  }
});

watch(() => props.catalog, () => {
  if (!visible.value) return;
  syncLocalEntries();
  if (selectedId.value > maximum.value) {
    selectedId.value = maximum.value;
  }
  if (document.activeElement?.id !== 'system-named-entry-name') {
    draftName.value = nameForId(selectedId.value);
  }
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

async function open(options: OpenOptions) {
  kind.value = options.kind;
  titleOverride.value = options.title || '';
  allowNone.value = options.allowNone !== false;
  error.value = '';
  syncLocalEntries();
  const nextId = normalizeSelectedId(options.selectedId);
  selectedId.value = nextId;
  activeRangeStart.value = rangeStartForId(nextId);
  draftName.value = nameForId(nextId);
  visible.value = true;
  await nextTick();
}

function close(): void {
  if (busy.value) return;
  visible.value = false;
  error.value = '';
}

function syncLocalEntries(): void {
  const key = kind.value === 'switch' ? 'switches' : 'variables';
  const source = props.catalog?.[key] || [];
  localEntries.value = source
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0)
    .map((entry) => ({ id: entry.id, name: String(entry.name || '') }))
    .sort((left, right) => left.id - right.id);
}

function normalizeSelectedId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) return allowNone.value ? 0 : 1;
  if (id === 0) return allowNone.value ? 0 : 1;
  if (id > maximum.value) return maximum.value;
  return id;
}

function rangeStartForId(id: number): number {
  if (id <= 0) return ranges.value[0]?.start || 1;
  const match = ranges.value.find((range) => id >= range.start && id <= range.end);
  return match?.start || ranges.value[0]?.start || 1;
}

function nameForId(id: number): string {
  if (id <= 0) return '';
  const entry = localEntries.value.find((item) => item.id === id);
  return displaySystemNamedEntryName(id, entry?.name || '');
}

async function selectEntry(id: number): Promise<void> {
  if (busy.value) return;
  if (selectedId.value > 0) await saveName();
  selectedId.value = id;
  draftName.value = nameForId(id);
  if (id > 0) activeRangeStart.value = rangeStartForId(id);
}

async function saveName(): Promise<void> {
  if (busy.value || selectedId.value <= 0) return;
  const project = projectStore.currentProject;
  if (!project) {
    error.value = t('systemNamedEntry.projectMissing');
    return;
  }
  const nextName = draftName.value;
  const current = nameForId(selectedId.value);
  if (nextName === current) return;
  busy.value = true;
  error.value = '';
  try {
    await projectManagement.updateEntry({
      kind: kind.value,
      id: selectedId.value,
      value: { id: selectedId.value, name: nextName },
    }, project);
    const index = localEntries.value.findIndex((entry) => entry.id === selectedId.value);
    if (index >= 0) {
      localEntries.value[index] = {
        ...localEntries.value[index]!,
        name: nextName || `#${selectedId.value}`,
      };
    } else {
      localEntries.value = [
        ...localEntries.value,
        { id: selectedId.value, name: nextName || `#${selectedId.value}` },
      ].sort((left, right) => left.id - right.id);
    }
    emit('catalog-changed');
  } catch (saveError) {
    error.value = (saveError as Error).message;
  } finally {
    busy.value = false;
  }
}

async function changeMaximum(): Promise<void> {
  if (busy.value) return;
  const project = projectStore.currentProject;
  if (!project) {
    error.value = t('systemNamedEntry.projectMissing');
    return;
  }
  try {
    const answer = await ElMessageBox.prompt(
      t('systemNamedEntry.maximumPrompt', {
        current: maximum.value,
        limit: SYSTEM_NAMED_ENTRY_LIMIT,
      }),
      t('systemNamedEntry.maximumTitle', {
        kind: kind.value === 'switch'
          ? t('systemNamedEntry.switchKind')
          : t('systemNamedEntry.variableKind'),
      }),
      {
        inputValue: String(maximum.value),
        confirmButtonText: t('systemNamedEntry.maximumConfirm'),
        cancelButtonText: t('eventcmd.cancel'),
        inputPattern: /^\d+$/,
        inputErrorMessage: t('systemNamedEntry.maximumInvalid', {
          limit: SYSTEM_NAMED_ENTRY_LIMIT,
        }),
      },
    );
    const nextMaximum = Number(answer.value);
    if (!Number.isInteger(nextMaximum) || nextMaximum < 1 || nextMaximum > SYSTEM_NAMED_ENTRY_LIMIT) {
      error.value = t('systemNamedEntry.maximumInvalid', { limit: SYSTEM_NAMED_ENTRY_LIMIT });
      return;
    }
    busy.value = true;
    error.value = '';
    await projectManagement.resizeDatabase({
      kind: kind.value,
      maximum: nextMaximum,
    }, project);
    emit('catalog-changed');
    await refreshLocalFromCatalogAfterResize(nextMaximum);
    if (selectedId.value > nextMaximum) {
      selectedId.value = nextMaximum;
      draftName.value = nameForId(nextMaximum);
    }
    activeRangeStart.value = rangeStartForId(selectedId.value);
  } catch (resizeError) {
    if (resizeError === 'cancel' || resizeError === 'close') return;
    error.value = (resizeError as Error).message;
  } finally {
    busy.value = false;
  }
}

async function refreshLocalFromCatalogAfterResize(nextMaximum: number): Promise<void> {
  // Parent refreshes catalog asynchronously; synthesize slots immediately for UI.
  const byId = new Map(localEntries.value.map((entry) => [entry.id, entry]));
  const next: NamedCatalogEntry[] = [];
  for (let id = 1; id <= nextMaximum; id += 1) {
    const existing = byId.get(id);
    next.push({
      id,
      name: existing?.name || `#${id}`,
    });
  }
  localEntries.value = next;
  await nextTick();
}

async function applySelection(): Promise<void> {
  await saveName();
  if (error.value) return;
  emit('commit', { kind: kind.value, id: selectedId.value });
}

async function commit(): Promise<void> {
  await applySelection();
  if (error.value) return;
  visible.value = false;
}

defineExpose({ open, close });
</script>

<style scoped>
.system-named-dialog {
  width: min(560px, calc(100vw - 48px));
  display: grid;
  gap: 10px;
}
.system-named-body {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 10px;
  min-height: 320px;
}
.system-named-ranges,
.system-named-list {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-bg);
}
.system-named-ranges {
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 4px;
}
.system-named-range,
.system-named-item,
.system-named-maximum {
  width: 100%;
  min-height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.system-named-range.active,
.system-named-item.active {
  background: color-mix(in srgb, var(--app-accent) 18%, transparent);
  color: var(--app-ink);
  font-weight: 650;
}
.system-named-range:hover,
.system-named-item:hover,
.system-named-maximum:hover {
  background: color-mix(in srgb, var(--app-accent) 10%, transparent);
}
.system-named-maximum {
  margin-top: auto;
  border-top: 1px solid var(--app-border);
  border-radius: 0;
  color: var(--app-ink-soft);
  font-size: 11px;
}
.system-named-list {
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
}
.system-named-item {
  display: flex;
  gap: 8px;
  align-items: center;
}
.system-named-item > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.system-named-name-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.system-named-name-row label {
  color: var(--app-ink-muted);
  font-size: 12px;
}
.system-named-name-row input {
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-bg);
  color: var(--app-ink);
  font: inherit;
}
.system-named-name-row input:disabled {
  opacity: 0.6;
}
.system-named-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--app-danger) 38%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--app-danger) 8%, transparent);
  color: var(--app-danger);
  font-size: 12px;
  line-height: 1.45;
}
</style>
