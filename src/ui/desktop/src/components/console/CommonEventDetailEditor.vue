<script setup lang="ts">
import { computed } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  clone,
  ensureTerminator,
  type MvCommand,
} from '../../composables/useEventEditor';
import MvCommandListEditor from './MvCommandListEditor.vue';

interface CommonEventDraft {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
  list: MvCommand[];
}

const props = defineProps<{
  modelValue: unknown;
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { t } = useI18n();

const draft = computed<CommonEventDraft>(() => {
  const value = (props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue))
    ? props.modelValue as Partial<CommonEventDraft>
    : {};
  const trigger = Number(value.trigger || 0);
  return {
    id: Number(value.id || 0),
    name: String(value.name || ''),
    trigger,
    switchId: trigger === 0 ? 0 : Number(value.switchId || 1),
    list: Array.isArray(value.list) ? value.list as MvCommand[] : [{ code: 0, indent: 0, parameters: [] }],
  };
});

function patch(fields: Partial<CommonEventDraft>) {
  const next = clone({ ...(props.modelValue as Record<string, unknown>), ...draft.value, ...fields });
  ensureTerminator(next.list as MvCommand[]);
  emit('update:modelValue', next);
}

function updateName(value: string) {
  patch({ name: value });
}

function updateTrigger(value: number) {
  patch({ trigger: value, switchId: value === 0 ? 0 : Math.max(1, draft.value.switchId || 1) });
}

function updateSwitch(value: number) {
  patch({ switchId: value });
}

function updateList(list: MvCommand[]) {
  patch({ list });
}
</script>

<template>
  <div class="common-event-editor">
    <section class="editor-section">
      <div class="section-title"><strong>{{ t('commonEvent.basicSettings') }}</strong></div>
      <div class="settings-grid">
        <label class="field compact"><span>{{ t('commonEvent.id') }}</span><input :value="String(draft.id).padStart(4, '0')" disabled /></label>
        <label class="field name"><span>{{ t('commonEvent.name') }}</span><input :value="draft.name" @input="updateName(($event.target as HTMLInputElement).value)" /></label>
        <label class="field">
          <span>{{ t('commonEvent.trigger') }}</span>
          <select :value="draft.trigger" @change="updateTrigger(Number(($event.target as HTMLSelectElement).value))">
            <option :value="0">{{ t('commonEvent.none') }}</option>
            <option :value="1">{{ t('commonEvent.autorun') }}</option>
            <option :value="2">{{ t('commonEvent.parallel') }}</option>
          </select>
        </label>
        <label class="field" :class="{ muted: draft.trigger === 0 }">
          <span>{{ t('commonEvent.conditionSwitch') }}</span>
          <select :value="draft.switchId" :disabled="draft.trigger === 0" @change="updateSwitch(Number(($event.target as HTMLSelectElement).value))">
            <option :value="0">{{ t('commonEvent.none') }}</option>
            <option v-for="entry in catalog?.switches || []" :key="entry.id" :value="entry.id">
              {{ String(entry.id).padStart(4, '0') }} {{ entry.name || t('commonEvent.unnamed') }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section class="editor-section commands">
      <div class="section-title"><strong>{{ t('commonEvent.contents') }}</strong></div>
      <MvCommandListEditor
        :model-value="draft.list"
        :catalog="catalog"
        :load-image="loadImage"
        :empty-text="t('commonEvent.emptyHint')"
        @update:model-value="updateList"
      />
    </section>
  </div>
</template>

<style scoped>
.common-event-editor { display: grid; gap: 12px; }
.editor-section { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--console-border,#e4dcce); border-radius: 8px; background: var(--console-paper-soft,#faf5ec); }
.settings-grid { display: grid; grid-template-columns: 112px minmax(0,1fr); gap: 8px; }
.field { display: grid; gap: 4px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.field.name { min-width: 0; }
.field.muted { opacity: .6; }
.field input,.field select { min-width: 0; height: 30px; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 7px; background: var(--console-paper,#fffdfa); color: var(--console-text,#211d17); padding: 0 9px; font: inherit; }
.field input:disabled,.field select:disabled { color: var(--console-text-muted,#9a8e7e); }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.section-title strong { color: var(--console-text,#211d17); font-size: 12px; }
.commands { min-height: 0; }
@media (max-width: 1320px) {
  .settings-grid { grid-template-columns: 1fr; }
}
</style>
