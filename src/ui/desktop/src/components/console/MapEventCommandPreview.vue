<template>
  <section class="event-command-preview" :aria-label="t('mapPreview.contents')">
    <div class="preview-title">
      <strong>{{ t('mapPreview.contents') }}</strong>
      <span>{{ t('mapPreview.readonly') }}</span>
    </div>

    <div v-if="!pages.length" class="preview-empty">{{ t('mapPreview.noPages') }}</div>
    <article v-for="(page, pageIndex) in pages" v-else :key="pageIndex" class="preview-page">
      <header class="preview-page-head">
        <strong>{{ t('mapPreview.pageN', { n: pageIndex + 1 }) }}</strong>
        <span>{{ triggerLabel(page.trigger) }}</span>
        <span>{{ conditionLabel(page) }}</span>
      </header>

      <div class="preview-command-list">
        <div v-if="!commandRows(page).length" class="preview-empty compact">{{ t('mapPreview.noCommands') }}</div>
        <div
          v-for="(row, rowIndex) in commandRows(page)"
          :key="`${pageIndex}-${rowIndex}`"
          class="preview-command-row"
          :class="[`tone-${row.tone}`, { even: rowIndex % 2 === 0 }]"
          :style="{ '--command-indent': `${Math.min(row.indent, 8) * 14}px` }"
        >
          <span>{{ row.label }}</span>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import {
  commandDisplay,
  editableCommandSpans,
  type CommandDisplayResult,
  type MvCommandSpan,
  type MvEditorEvent,
  type MvEventPage,
} from '../../composables/useEventEditor';
import { eventEditorText } from '../../utils/eventEditorLocalization';

interface SystemData {
  switches?: string[];
  variables?: string[];
}

const props = defineProps<{
  event: MvEditorEvent;
  systemData: SystemData | null;
}>();

const { language, t } = useI18n();
const pages = computed(() => Array.isArray(props.event.pages) ? props.event.pages : []);

function commandRows(page: MvEventPage): CommandDisplayResult[] {
  return editableCommandSpans(page).map(displaySpan);
}

function displaySpan(span: MvCommandSpan): CommandDisplayResult {
  const head = commandDisplay(span.commands[0], props.systemData, language.value);
  if (span.commands[0].code === 101) {
    return {
      ...head,
      label: `${head.label} · ${span.commands.slice(1).map((item) => item.parameters[0]).join(' / ')}`,
    };
  }
  return head;
}

function triggerLabel(value: number): string {
  const labels = eventEditorText(language.value).triggerLabels;
  return labels[Number(value)] || t('mapPreview.triggerN', { value: String(value) });
}

function conditionLabel(page: MvEventPage): string {
  const conditions = page.conditions;
  if (!conditions) return t('mapPreview.noConditions');
  const parts: string[] = [];
  if (conditions.switch1Valid) parts.push(`${t('mapPreview.switch')} ${named(props.systemData?.switches, conditions.switch1Id)} ON`);
  if (conditions.switch2Valid) parts.push(`${t('mapPreview.switch')} ${named(props.systemData?.switches, conditions.switch2Id)} ON`);
  if (conditions.variableValid) {
    parts.push(`${t('mapPreview.variable')} ${named(props.systemData?.variables, conditions.variableId)} >= ${conditions.variableValue}`);
  }
  if (conditions.selfSwitchValid) parts.push(`${t('mapPreview.selfSwitch')} ${conditions.selfSwitchCh} ON`);
  if (conditions.itemValid) parts.push(`${t('mapPreview.item')} ${String(conditions.itemId).padStart(4, '0')}`);
  if (conditions.actorValid) parts.push(`${t('mapPreview.actor')} ${String(conditions.actorId).padStart(4, '0')}`);
  return parts.length ? parts.join(' / ') : t('mapPreview.noConditions');
}

function named(list: string[] | undefined, id: number): string {
  const name = Array.isArray(list) ? list[id] : '';
  return `${String(id || 0).padStart(4, '0')}${name ? ` ${name}` : ''}`;
}
</script>

<style scoped>
.event-command-preview {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  min-width: 0;
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-title strong {
  color: var(--console-text,#211d17);
  font-size: 12px;
}
.preview-title span {
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.preview-page {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 10px;
  background: var(--console-paper-soft,#faf5ec);
}
.preview-page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--console-border,#e4dcce);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.preview-page-head strong {
  color: var(--console-text,#211d17);
  font-size: 11px;
}
.preview-command-list {
  min-width: 0;
  padding: 6px;
  background: var(--console-paper,#fffdfa);
}
.preview-command-row {
  min-width: 0;
  padding: 4px 7px 4px calc(7px + var(--command-indent));
  border-radius: var(--app-radius-sm);
  color: var(--console-text-soft,#5a5247);
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.preview-command-row.even {
  background: rgba(241, 233, 219, .52);
}
.preview-command-row.tone-text {
  color: var(--console-text,#211d17);
}
.preview-command-row.tone-control {
  color: var(--console-accent,#be5630);
}
.preview-command-row.tone-raw {
  color: var(--app-danger);
}
.preview-empty {
  display: grid;
  place-items: center;
  min-height: 82px;
  padding: 12px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
  text-align: center;
}
.preview-empty.compact {
  min-height: 46px;
}
</style>
