<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import {
  TERM_LABELS,
  databaseTermMessageLabel,
  localizeDatabaseLabel,
} from '../../utils/rmmvDatabaseLocalization';
import { normalizeTermsArray, sortedTermsMessageKeys } from '../../utils/rmmvDatabaseEditor';

type DbRecord = Record<string, unknown>;
type TermArraySection = 'basic' | 'params' | 'commands';

const props = defineProps<{ modelValue: unknown }>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { language, t } = useI18n();

const record = computed<DbRecord>(() => (
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as DbRecord
    : {}
));

function sectionValue(section: TermArraySection): string[] {
  return normalizeTermsArray(record.value[section], section);
}

function sectionLabel(section: TermArraySection): string {
  if (section === 'basic') return t('db.document.terms.basic');
  if (section === 'params') return t('db.document.terms.params');
  return t('db.document.terms.commands');
}

function cellLabel(section: TermArraySection, index: number): string {
  return localizeDatabaseLabel(TERM_LABELS[section]?.[index] || t('sf.itemN', { n: index + 1 }), language.value);
}

function updateSection(section: TermArraySection, index: number, value: string): void {
  const next = sectionValue(section);
  next[index] = value;
  emit('update:modelValue', { ...record.value, [section]: next });
}

const messages = computed<DbRecord>(() => (
  record.value.messages && typeof record.value.messages === 'object' && !Array.isArray(record.value.messages)
    ? record.value.messages as DbRecord
    : {}
));

const messageEntries = computed(() => sortedTermsMessageKeys(messages.value).map((key) => ({
  key,
  label: databaseTermMessageLabel(key, language.value),
  value: String(messages.value[key] ?? ''),
})));

function updateMessage(key: string, value: string): void {
  emit('update:modelValue', {
    ...record.value,
    messages: { ...messages.value, [key]: value },
  });
}
</script>

<template>
  <section class="rm-document rm-terms-document" :aria-label="t('db.document.terms.pageLabel')">
    <div class="rm-terms-layout">
      <div class="rm-terms-left">
        <div class="rm-terms-top">
          <section v-for="section in (['basic', 'params'] as const)" :key="section" class="rm-document-panel">
            <h3>{{ sectionLabel(section) }}</h3>
            <div class="rm-term-grid rm-term-grid--pairs">
              <label v-for="(_entry, index) in sectionValue(section)" :key="`${section}-${index}`">
                <span>{{ cellLabel(section, index) }}</span>
                <el-input
                  size="small"
                  :model-value="sectionValue(section)[index]"
                  @update:model-value="updateSection(section, index, $event)"
                />
              </label>
            </div>
          </section>
        </div>

        <section class="rm-document-panel rm-command-panel">
          <h3>{{ sectionLabel('commands') }}</h3>
          <div class="rm-term-grid rm-term-grid--commands">
            <label
              v-for="(_entry, index) in sectionValue('commands')"
              :key="`commands-${index}`"
              :class="{ 'is-group-start': index === 12 }"
            >
              <span>{{ cellLabel('commands', index) }}</span>
              <el-input
                size="small"
                :model-value="sectionValue('commands')[index]"
                @update:model-value="updateSection('commands', index, $event)"
              />
            </label>
          </div>
        </section>
      </div>

      <section class="rm-document-panel rm-message-panel">
        <h3>{{ t('db.document.terms.messages') }}</h3>
        <div class="rm-message-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ t('db.messageTypeCol') }}</th>
                <th scope="col">{{ t('db.messageTextCol') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="message in messageEntries" :key="message.key">
                <th scope="row" :title="message.key">{{ message.label }}</th>
                <td>
                  <el-input
                    size="small"
                    :aria-label="`${message.label} (${message.key})`"
                    :model-value="message.value"
                    @update:model-value="updateMessage(message.key, $event)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.rm-document {
  min-width: 0;
  color: var(--console-text, #211d17);
}
.rm-terms-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr);
  gap: 6px;
  min-width: 0;
  align-items: stretch;
}
.rm-terms-left {
  display: grid;
  gap: 6px;
  min-width: 0;
  align-content: start;
}
.rm-terms-top {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}
.rm-document-panel {
  min-width: 0;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 5px;
  background: var(--console-paper-soft, #faf5ec);
  overflow: hidden;
}
.rm-document-panel h3 {
  margin: 0;
  padding: 6px 8px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper, #fffdfa);
  font-size: 12px;
  line-height: 1.25;
}
.rm-term-grid {
  display: grid;
  gap: 5px 8px;
  padding: 7px;
}
.rm-term-grid--pairs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.rm-term-grid--commands {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.rm-term-grid label {
  min-width: 0;
  display: grid;
  gap: 2px;
  font-size: 11px;
}
.rm-term-grid label > span {
  min-height: 15px;
  overflow: hidden;
  color: var(--console-text-muted, #817669);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-term-grid .el-input {
  width: 100%;
}
.rm-term-grid--commands .is-group-start {
  position: relative;
  margin-top: 7px;
}
.rm-term-grid--commands .is-group-start::before {
  content: '';
  position: absolute;
  top: -7px;
  left: 0;
  width: calc(400% + 24px);
  border-top: 1px solid var(--console-border, #e4dcce);
}
.rm-message-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: min(68vh, 720px);
}
.rm-message-scroll {
  min-height: 0;
  overflow-y: auto;
  background: var(--console-paper, #fffdfa);
}
.rm-message-scroll table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
}
.rm-message-scroll thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-soft, #5a5247);
}
.rm-message-scroll th,
.rm-message-scroll td {
  height: 28px;
  padding: 2px 7px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  text-align: left;
  vertical-align: middle;
}
.rm-message-scroll tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 78%, var(--console-paper, #fffdfa));
}
.rm-message-scroll th:first-child {
  width: 37%;
}
.rm-message-scroll tbody th {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Message inputs sit flush in their table cells; the border only shows on focus. */
.rm-message-scroll .el-input {
  width: 100%;
}
.rm-message-scroll .el-input .el-input__wrapper {
  background: transparent;
  box-shadow: none;
}
.rm-message-scroll .el-input .el-input__wrapper.is-focus {
  background: var(--console-paper, #fffdfa);
  box-shadow: 0 0 0 1px var(--app-accent, #be5630) inset;
}
@container (max-width: 900px) {
  .rm-terms-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .rm-message-panel {
    min-height: 420px;
  }
}
@container (max-width: 560px) {
  .rm-terms-top,
  .rm-term-grid--pairs,
  .rm-term-grid--commands {
    grid-template-columns: minmax(0, 1fr);
  }
  .rm-term-grid--commands .is-group-start::before {
    width: 100%;
  }
}
</style>
