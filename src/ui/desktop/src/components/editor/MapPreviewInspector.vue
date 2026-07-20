<template>
  <aside class="preview-inspector" data-ui-id="map-preview-inspector">
    <div class="inspector-tabs" role="tablist" :aria-label="t('editor.preview.stateControls')">
      <button type="button" role="tab" :aria-selected="kind === 'switch'" :class="{ active: kind === 'switch' }" @click="kind = 'switch'">{{ t('editor.preview.switches') }}</button>
      <button type="button" role="tab" :aria-selected="kind === 'variable'" :class="{ active: kind === 'variable' }" @click="kind = 'variable'">{{ t('editor.preview.variables') }}</button>
    </div>
    <label class="state-search">
      <Search />
      <input v-model="query" type="search" :placeholder="t('editor.preview.searchState')" />
    </label>
    <div class="state-list">
      <template v-if="kind === 'switch'">
        <label v-for="entry in filteredSwitches" :key="entry.id" class="state-row">
          <span><b>{{ formatId(entry.id) }}</b><em>{{ entry.name || t('editor.preview.unnamed') }}</em></span>
          <input type="checkbox" :checked="switchOverrides.get(entry.id) ?? switchValues.get(entry.id) ?? false" @change="setSwitch(entry.id, ($event.target as HTMLInputElement).checked)" />
        </label>
        <p v-if="!filteredSwitches.length" class="empty-state">{{ t('editor.preview.noStateMatches') }}</p>
      </template>
      <template v-else>
        <label v-for="entry in filteredVariables" :key="entry.id" class="state-row variable-row">
          <span><b>{{ formatId(entry.id) }}</b><em>{{ entry.name || t('editor.preview.unnamed') }}</em></span>
          <input
            type="number"
            :value="variableOverrides.get(entry.id) ?? variableValues.get(entry.id) ?? 0"
            step="1"
            @change="setVariable(entry.id, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <p v-if="!filteredVariables.length" class="empty-state">{{ t('editor.preview.noStateMatches') }}</p>
      </template>
    </div>
    <button class="reset-button" type="button" :disabled="!overrideCount" @click="resetOverrides">
      <RefreshLeft />{{ t('editor.preview.resetState') }}<span v-if="overrideCount">{{ overrideCount }}</span>
    </button>
    <p class="inspector-note">{{ t('editor.preview.stateNote') }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { RefreshLeft, Search } from '@element-plus/icons-vue';
import type { NamedCatalogEntry } from '../../api/client';
import { useI18n } from '../../i18n';

const props = defineProps<{
  switches: NamedCatalogEntry[];
  variables: NamedCatalogEntry[];
  switchOverrides: Map<number, boolean>;
  variableOverrides: Map<number, number>;
  switchValues: Map<number, boolean>;
  variableValues: Map<number, number>;
}>();
const emit = defineEmits<{
  setSwitch: [id: number, value: boolean];
  setVariable: [id: number, value: number];
  reset: [];
}>();
const { t } = useI18n();
const kind = ref<'switch' | 'variable'>('switch');
const query = ref('');

const filteredSwitches = computed(() => filterEntries(props.switches));
const filteredVariables = computed(() => filterEntries(props.variables));
const overrideCount = computed(() => props.switchOverrides.size + props.variableOverrides.size);

function filterEntries(entries: NamedCatalogEntry[]) {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => String(entry.id) === needle || entry.name.toLocaleLowerCase().includes(needle));
}

function formatId(id: number) {
  return String(id).padStart(4, '0');
}

function setSwitch(id: number, value: boolean) {
  emit('setSwitch', id, value);
}

function setVariable(id: number, raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  emit('setVariable', id, value);
}

function resetOverrides() {
  emit('reset');
}
</script>

<style scoped>
.preview-inspector{width:260px;min-width:230px;max-width:300px;min-height:0;padding:0 0 8px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--app-border);border-radius:6px;background:var(--app-bg);box-shadow:var(--app-shadow-1)}
.inspector-tabs{height:34px;padding:3px;display:grid;grid-template-columns:1fr 1fr;gap:2px;border-bottom:1px solid var(--app-border);background:var(--app-bg-sunken)}.inspector-tabs button{border:0;border-radius:3px;background:transparent;color:var(--app-ink-muted);font:inherit;font-size:11px;font-weight:700;cursor:pointer}.inspector-tabs button.active{background:var(--app-bg);color:var(--app-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}.inspector-tabs button:focus-visible{outline:2px solid var(--app-accent);outline-offset:-1px}
.state-search{height:30px;margin:6px;display:flex;align-items:center;gap:5px;padding:0 7px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink-muted)}.state-search:focus-within{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}.state-search :deep(svg){width:13px}.state-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--app-ink);font:inherit;font-size:11px}
.state-list{min-height:0;flex:1;overflow:auto;padding:0 5px}.state-row{min-height:34px;padding:4px 5px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--app-border);cursor:pointer}.state-row:hover{background:var(--app-bg-soft)}.state-row>span{min-width:0;display:flex;flex-direction:column}.state-row b{color:var(--app-ink-muted);font:600 9px var(--app-font-mono)}.state-row em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--app-ink);font-style:normal;font-size:11px}.state-row input[type=checkbox]{width:30px;height:16px;appearance:none;border:1px solid var(--app-border-strong);border-radius:999px;background:var(--app-bg-sunken);cursor:pointer;transition:background-color .15s}.state-row input[type=checkbox]::before{content:"";display:block;width:12px;height:12px;margin:1px;border-radius:50%;background:var(--app-ink-muted);transition:transform .15s,background-color .15s}.state-row input[type=checkbox]:checked{border-color:var(--app-accent);background:var(--app-accent)}.state-row input[type=checkbox]:checked::before{transform:translateX(14px);background:#fff}.state-row input:focus-visible{outline:2px solid var(--app-accent);outline-offset:2px}.variable-row input{width:72px;height:25px;padding:0 5px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink);font:600 11px var(--app-font-mono);text-align:right}.empty-state{padding:18px 8px;color:var(--app-ink-muted);font-size:11px;text-align:center}
.reset-button{min-height:30px;margin:7px 7px 0;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--app-border);border-radius:3px;background:var(--app-bg);color:var(--app-ink-soft);font:inherit;font-size:11px;font-weight:650;cursor:pointer}.reset-button:hover:not(:disabled){background:var(--app-bg-soft);color:var(--app-ink)}.reset-button:disabled{opacity:.4;cursor:not-allowed}.reset-button :deep(svg){width:13px}.reset-button span{min-width:17px;padding:1px 4px;border-radius:9px;background:var(--app-accent);color:#fff;font-size:9px}.inspector-note{margin:6px 9px 0;color:var(--app-ink-muted);font-size:9px;line-height:1.45}
</style>
