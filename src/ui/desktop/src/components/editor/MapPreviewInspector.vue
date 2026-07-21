<template>
  <aside class="preview-inspector" data-ui-id="map-preview-inspector">
    <div class="inspector-tabs" role="tablist" :aria-label="t('editor.preview.stateControls')">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="kind === tab.id" :class="{ active: kind === tab.id }" @click="kind = tab.id">{{ tab.label }}</button>
    </div>
    <label class="state-search">
      <Search />
      <input v-model="query" type="search" :placeholder="t('editor.preview.searchState')" />
    </label>
    <div ref="stateListRef" class="state-list">
      <template v-if="kind === 'switch'">
        <label v-for="entry in filteredSwitches" :key="entry.id" class="state-row">
          <span><b><i v-if="entry.mapReachable" class="reachable-dot" :title="t('editor.preview.mapReachable')"></i>{{ formatId(entry.id) }}</b><em>{{ displayName(entry) }}</em></span>
          <input type="checkbox" :checked="switchOverrides.get(entry.id) ?? switchValues.get(entry.id) ?? false" @change="setSwitch(entry.id, ($event.target as HTMLInputElement).checked)" />
        </label>
        <p v-if="!filteredSwitches.length" class="empty-state">{{ t('editor.preview.noStateMatches') }}</p>
      </template>
      <template v-else-if="kind === 'variable'">
        <label v-for="entry in filteredVariables" :key="entry.id" class="state-row variable-row" :class="{ unsupported: unsupportedVariableTypes.has(entry.id) }">
          <span><b><i v-if="entry.mapReachable" class="reachable-dot" :title="t('editor.preview.mapReachable')"></i>{{ formatId(entry.id) }}</b><em>{{ displayName(entry) }}</em><small v-if="unsupportedVariableTypes.has(entry.id)">{{ t('editor.preview.unsupportedVariable') }}</small></span>
          <input
            type="text"
            :disabled="unsupportedVariableTypes.has(entry.id)"
            :value="variableDraftValue(entry.id)"
            @focus="beginVariableEdit(entry.id)"
            @input="updateVariableDraft(entry.id, ($event.target as HTMLInputElement).value)"
            @blur="commitVariableDraft(entry.id)"
            @keydown.enter.prevent="commitVariableDraft(entry.id, true)"
            @keydown.escape.prevent="discardVariableDraft(entry.id)"
          />
        </label>
        <p v-if="!filteredVariables.length" class="empty-state">{{ t('editor.preview.noStateMatches') }}</p>
      </template>
      <template v-else>
        <section
          v-for="event in filteredSelfSwitchEvents"
          :key="event.id"
          :ref="(element) => setSelfSwitchGroupRef(event.id, element)"
          class="self-switch-group"
          :class="{ active: event.id === selectedEventId }"
          @click="$emit('selectEvent', event.id)"
        >
          <header><b>{{ formatEventId(event.id) }}</b><span>{{ event.name || t('editor.preview.unnamed') }}</span><small>{{ event.x }}, {{ event.y }}</small></header>
          <div class="self-switch-grid">
            <label v-for="letter in selfSwitchLetters" :key="letter" @click.stop>
              <span>{{ letter }}</span>
              <input type="checkbox" :checked="selfSwitchValue(event.id, letter)" @change="setSelfSwitch(event.id, letter, ($event.target as HTMLInputElement).checked)" />
            </label>
          </div>
        </section>
        <p v-if="!filteredSelfSwitchEvents.length" class="empty-state">{{ t('editor.preview.noStateMatches') }}</p>
      </template>
    </div>
    <button class="reset-button" type="button" :disabled="!overrideCount" @click="$emit('reset')">
      <RefreshLeft />{{ t('editor.preview.resetState') }}<span v-if="overrideCount">{{ overrideCount }}</span>
    </button>
    <p class="inspector-note">{{ t('editor.preview.stateNote') }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { RefreshLeft, Search } from '@element-plus/icons-vue';
import type { MapPreviewSelfSwitchLetter, MapPreviewStateEntry, MapPreviewVariableValue } from '../../api/client';
import { mapPreviewSelfSwitchKey } from '@contract/map-preview-state';
import type { EditorEventListItem } from './editorTypes';
import { useI18n } from '../../i18n';
import { filterPreviewSelfSwitchEvents, previewEventMatchesQuery } from './previewInspectorEvents';
import {
  beginPreviewVariableDraft,
  createPreviewVariableDraftState,
  discardPreviewVariableDraft,
  preparePreviewVariableDraft,
  previewVariableDraftValue as readPreviewVariableDraftValue,
  resetPreviewVariableDrafts as resetVariableDraftState,
  syncPreviewVariableDrafts,
  updatePreviewVariableDraft,
} from './previewVariableDrafts';

type InspectorKind = 'switch' | 'variable' | 'self-switch';
const props = defineProps<{
  currentMapId: number;
  events: EditorEventListItem[];
  selectedEventId: number | null;
  switches: MapPreviewStateEntry[];
  variables: MapPreviewStateEntry[];
  switchOverrides: Map<number, boolean>;
  variableOverrides: Map<number, MapPreviewVariableValue>;
  selfSwitchOverrides: Map<string, boolean>;
  switchValues: Map<number, boolean>;
  variableValues: Map<number, MapPreviewVariableValue>;
  selfSwitchValues: Map<string, boolean>;
  unsupportedVariableTypes: Map<number, string>;
  variableDraftScope: string;
  variableDraftResetEpoch: number;
  eventRevealEpoch: number;
}>();
const emit = defineEmits<{
  setSwitch: [id: number, value: boolean];
  setVariable: [id: number, value: MapPreviewVariableValue];
  setSelfSwitch: [eventId: number, letter: MapPreviewSelfSwitchLetter, value: boolean];
  selectEvent: [eventId: number];
  reset: [];
}>();
const { t } = useI18n();
const kind = ref<InspectorKind>('switch');
const query = ref('');
const selfSwitchLetters: MapPreviewSelfSwitchLetter[] = ['A', 'B', 'C', 'D'];
const variableDraftState = reactive(createPreviewVariableDraftState());
const focusedVariableId = ref<number | null>(null);
const stateListRef = ref<HTMLElement>();
const selfSwitchGroupRefs = new Map<number, HTMLElement>();
const pendingRevealEventId = ref<number | null>(null);
const tabs = computed<Array<{ id: InspectorKind; label: string }>>(() => [
  { id: 'switch', label: t('editor.preview.switches') },
  { id: 'variable', label: t('editor.preview.variables') },
  { id: 'self-switch', label: t('editor.preview.selfSwitches') },
]);
const filteredSwitches = computed(() => filterEntries(props.switches));
const filteredVariables = computed(() => filterEntries(props.variables));
const filteredSelfSwitchEvents = computed(() => filterPreviewSelfSwitchEvents(props.events, query.value));
const overrideCount = computed(() => props.switchOverrides.size + props.variableOverrides.size + props.selfSwitchOverrides.size);

function filterEntries(entries: MapPreviewStateEntry[]) {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => String(entry.id) === needle || displayName(entry).toLocaleLowerCase().includes(needle));
}
function displayName(entry: MapPreviewStateEntry) { return entry.name.trim() || t('editor.preview.unnamed'); }
function formatId(id: number) { return String(id).padStart(4, '0'); }
function formatEventId(id: number) { return `EV${String(id).padStart(3, '0')}`; }
function effectiveVariableValue(id: number): MapPreviewVariableValue {
  return props.variableOverrides.get(id) ?? props.variableValues.get(id) ?? '';
}
function variableDraftValue(id: number): string {
  return readPreviewVariableDraftValue(variableDraftState, id, () => effectiveVariableValue(id));
}
function beginVariableEdit(id: number) {
  focusedVariableId.value = id;
  beginPreviewVariableDraft(variableDraftState, id, effectiveVariableValue(id));
}
function updateVariableDraft(id: number, raw: string) {
  updatePreviewVariableDraft(variableDraftState, id, raw);
}
function commitVariableDraft(id: number, force = false) {
  if (focusedVariableId.value === id) focusedVariableId.value = null;
  const value = preparePreviewVariableDraft(variableDraftState, id, force);
  if (value === null) return;
  emit('setVariable', id, value);
}
function discardVariableDraft(id: number) {
  focusedVariableId.value = null;
  discardPreviewVariableDraft(variableDraftState, id, effectiveVariableValue(id));
}
function setSwitch(id: number, value: boolean) { emit('setSwitch', id, value); }
function selfSwitchValue(eventId: number, letter: MapPreviewSelfSwitchLetter): boolean {
  const key = mapPreviewSelfSwitchKey(props.currentMapId, eventId, letter);
  return props.selfSwitchOverrides.get(key) ?? props.selfSwitchValues.get(key) ?? false;
}
function setSelfSwitch(eventId: number, letter: MapPreviewSelfSwitchLetter, value: boolean) { emit('setSelfSwitch', eventId, letter, value); }
function setSelfSwitchGroupRef(eventId: number, element: unknown) {
  if (element instanceof HTMLElement) selfSwitchGroupRefs.set(eventId, element);
  else selfSwitchGroupRefs.delete(eventId);
}
async function revealPendingSelfSwitchEvent() {
  const eventId = pendingRevealEventId.value;
  if (eventId == null || kind.value !== 'self-switch') return;
  const event = props.events.find((entry) => entry.id === eventId);
  if (!event) {
    pendingRevealEventId.value = null;
    return;
  }
  if (!previewEventMatchesQuery(event, query.value)) query.value = '';
  await nextTick();
  const group = selfSwitchGroupRefs.get(eventId);
  const list = stateListRef.value;
  if (!group || !list || !list.contains(group)) return;
  group.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  pendingRevealEventId.value = null;
}

function resetVariableDrafts() {
  focusedVariableId.value = null;
  resetVariableDraftState(variableDraftState, props.variables.map((entry) => entry.id), effectiveVariableValue);
}

watch(
  () => [props.variableOverrides, props.variableValues, props.variables] as const,
  () => syncPreviewVariableDrafts(variableDraftState, props.variables.map((entry) => entry.id), effectiveVariableValue, focusedVariableId.value),
  { immediate: true },
);
watch(() => [props.variableDraftScope, props.variableDraftResetEpoch], resetVariableDrafts);
watch(() => props.eventRevealEpoch, () => {
  pendingRevealEventId.value = props.selectedEventId;
  void revealPendingSelfSwitchEvent();
});
watch(kind, () => { void revealPendingSelfSwitchEvent(); });
watch(() => props.selectedEventId, (eventId) => {
  if (eventId == null) pendingRevealEventId.value = null;
});
</script>

<style scoped>
.preview-inspector{width:270px;min-width:240px;max-width:310px;min-height:0;padding:0 0 8px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--app-border);border-radius:6px;background:var(--app-bg);box-shadow:var(--app-shadow-1)}
.inspector-tabs{height:34px;padding:3px;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;border-bottom:1px solid var(--app-border);background:var(--app-bg-sunken)}.inspector-tabs button{min-width:0;border:0;border-radius:3px;background:transparent;color:var(--app-ink-muted);font:inherit;font-size:10px;font-weight:700;cursor:pointer}.inspector-tabs button.active{background:var(--app-bg);color:var(--app-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}.inspector-tabs button:focus-visible{outline:2px solid var(--app-accent);outline-offset:-1px}
.state-search{height:30px;margin:6px;display:flex;align-items:center;gap:5px;padding:0 7px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink-muted)}.state-search:focus-within{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}.state-search :deep(svg){width:13px}.state-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--app-ink);font:inherit;font-size:11px}
.state-list{min-height:0;flex:1;overflow:auto;padding:0 5px}.state-row{min-height:38px;padding:4px 5px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--app-border);cursor:pointer}.state-row:hover{background:var(--app-bg-soft)}.state-row>span{min-width:0;display:flex;flex-direction:column}.state-row b{display:flex;align-items:center;gap:4px;color:var(--app-ink-muted);font:600 9px var(--app-font-mono)}.reachable-dot{width:6px;height:6px;flex:none;border-radius:50%;background:#d84a3a;box-shadow:0 0 0 1px rgba(216,74,58,.18)}.state-row em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--app-ink);font-style:normal;font-size:11px}.state-row small{color:#c15a48;font-size:9px}.state-row.unsupported{cursor:not-allowed}.state-row input[type=checkbox],.self-switch-grid input{width:30px;height:16px;appearance:none;border:1px solid var(--app-border-strong);border-radius:999px;background:var(--app-bg-sunken);cursor:pointer}.state-row input[type=checkbox]::before,.self-switch-grid input::before{content:"";display:block;width:12px;height:12px;margin:1px;border-radius:50%;background:var(--app-ink-muted);transition:transform .15s}.state-row input[type=checkbox]:checked,.self-switch-grid input:checked{border-color:var(--app-accent);background:var(--app-accent)}.state-row input[type=checkbox]:checked::before,.self-switch-grid input:checked::before{transform:translateX(14px);background:#fff}.state-row input:focus-visible,.self-switch-grid input:focus-visible{outline:2px solid var(--app-accent);outline-offset:2px}.variable-row input[type=text]{width:92px;height:25px;padding:0 6px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink);font:600 11px var(--app-font-mono);text-align:left}.variable-row input:disabled{opacity:.45}
.self-switch-group{margin:5px 1px;padding:6px;border:1px solid var(--app-border);border-radius:4px;cursor:pointer}.self-switch-group:hover{background:var(--app-bg-soft)}.self-switch-group.active{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}.self-switch-group header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px}.self-switch-group header b{font:700 9px var(--app-font-mono);color:var(--app-accent)}.self-switch-group header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.self-switch-group header small{color:var(--app-ink-muted);font:9px var(--app-font-mono)}.self-switch-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:7px}.self-switch-grid label{display:grid;justify-items:center;gap:3px;color:var(--app-ink-muted);font:700 9px var(--app-font-mono);cursor:pointer}
.empty-state{padding:18px 8px;color:var(--app-ink-muted);font-size:11px;text-align:center}.reset-button{min-height:30px;margin:7px 7px 0;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink-soft);font:inherit;font-size:11px;font-weight:650;cursor:pointer}.reset-button:hover:not(:disabled){background:var(--app-bg-soft);color:var(--app-ink)}.reset-button:disabled{opacity:.4;cursor:not-allowed}.reset-button :deep(svg){width:13px}.reset-button span{min-width:17px;padding:1px 4px;border-radius:9px;background:var(--app-accent);color:#fff;font-size:9px}.inspector-note{margin:6px 9px 0;color:var(--app-ink-muted);font-size:9px;line-height:1.45}
</style>
