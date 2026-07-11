<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectManagedEntryInspection, ProjectManagedFieldDiff } from '@contract/types';
import { useI18n } from '../../i18n';

const props = defineProps<{
  inspection?: ProjectManagedEntryInspection;
}>();

const { t } = useI18n();
const errors = computed(() => props.inspection?.issues.filter((issue) => issue.severity === 'error') || []);
const warnings = computed(() => props.inspection?.issues.filter((issue) => issue.severity === 'warning') || []);
const visible = computed(() => Boolean(
  props.inspection?.staged
  && (props.inspection.changed
    || props.inspection.conflict
    || props.inspection.operationId
    || props.inspection.issues.length),
));

function diffValue(diff: ProjectManagedFieldDiff, side: 'before' | 'after'): string {
  if (!Object.hasOwn(diff, side)) return t('story.diffEmpty');
  const value = diff[side];
  if (typeof value === 'string') return value || t('story.diffEmptyString');
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}
</script>

<template>
  <details v-if="visible" class="staged-inspection" :open="errors.length > 0 || Boolean(inspection?.conflict)">
    <summary>
      <span class="inspection-mark" :class="{ danger: errors.length || inspection?.conflict }" aria-hidden="true" />
      <strong>{{ t('story.stagedInspection') }}</strong>
      <span v-if="inspection?.diffs.length" class="inspection-count">
        {{ t('story.stagedFieldCount', { count: inspection.diffs.length }) }}
      </span>
      <span v-if="errors.length" class="inspection-count danger">
        {{ t('story.validationErrorCount', { count: errors.length }) }}
      </span>
      <span v-else-if="warnings.length" class="inspection-count warning">
        {{ t('story.validationWarningCount', { count: warnings.length }) }}
      </span>
    </summary>

    <div class="inspection-body">
      <p v-if="inspection?.conflict" class="inspection-alert">
        {{ t('story.stagedConflict') }}
      </p>
      <p v-if="inspection?.operationId" class="inspection-owner">
        {{ t('story.agentOwnedStaging', { operationId: inspection.operationId }) }}
      </p>

      <div v-if="inspection?.issues.length" class="inspection-issues">
        <div
          v-for="issue in inspection.issues"
          :key="`${issue.code}:${issue.table}:${issue.id ?? ''}:${issue.path}`"
          class="inspection-issue"
          :class="issue.severity"
        >
          <code>{{ issue.path }}</code>
          <span>{{ issue.message }}</span>
        </div>
        <small v-if="inspection.limitations.length">{{ t('story.pluginSemanticsNotValidated') }}</small>
      </div>

      <div v-if="inspection?.diffs.length" class="inspection-diffs">
        <div v-for="diff in inspection.diffs" :key="diff.path" class="inspection-diff">
          <code class="diff-path">{{ diff.path }}</code>
          <div class="diff-values">
            <span class="before" :title="diffValue(diff, 'before')">{{ diffValue(diff, 'before') }}</span>
            <span class="diff-arrow" aria-hidden="true">→</span>
            <span class="after" :title="diffValue(diff, 'after')">{{ diffValue(diff, 'after') }}</span>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.staged-inspection {
  margin: 0 0 8px;
  border: 1px solid var(--console-border, #e4dcce);
  border-left: 3px solid var(--console-accent, #be5630);
  border-radius: 5px;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-soft, #5a5247);
  font-size: 10px;
}
.staged-inspection summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 0 8px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.staged-inspection summary::-webkit-details-marker { display: none; }
.staged-inspection summary::after {
  content: '›';
  margin-left: auto;
  color: var(--console-text-muted, #9a8e7e);
  font-size: 15px;
  transform: rotate(90deg);
  transition: transform 120ms ease;
}
.staged-inspection:not([open]) summary::after { transform: rotate(0deg); }
.inspection-mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--console-accent, #be5630);
}
.inspection-mark.danger { background: var(--app-danger, #b43f3f); }
.inspection-count {
  color: var(--console-text-muted, #9a8e7e);
  font-variant-numeric: tabular-nums;
}
.inspection-count.danger { color: var(--app-danger, #b43f3f); }
.inspection-count.warning { color: #9b6a1f; }
.inspection-body {
  display: grid;
  gap: 7px;
  padding: 0 8px 8px;
  border-top: 1px solid var(--console-border, #e4dcce);
}
.inspection-alert,
.inspection-owner {
  margin: 7px 0 0;
  line-height: 1.4;
}
.inspection-alert { color: var(--app-danger, #b43f3f); }
.inspection-owner { color: var(--console-text-muted, #9a8e7e); }
.inspection-issues,
.inspection-diffs { display: grid; gap: 4px; }
.inspection-issues { margin-top: 7px; }
.inspection-issue {
  display: grid;
  grid-template-columns: minmax(82px, .8fr) minmax(0, 2fr);
  gap: 7px;
  padding: 5px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, #9b6a1f 8%, transparent);
  line-height: 1.35;
}
.inspection-issue.error { background: color-mix(in srgb, var(--app-danger, #b43f3f) 8%, transparent); }
.inspection-issue code,
.diff-path {
  overflow: hidden;
  color: var(--console-text-muted, #9a8e7e);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspection-diff {
  display: grid;
  gap: 3px;
  padding: 5px 0;
  border-top: 1px dotted var(--console-border, #e4dcce);
}
.diff-values {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
}
.diff-values .before,
.diff-values .after {
  overflow: hidden;
  padding: 3px 5px;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-values .before {
  background: color-mix(in srgb, var(--app-danger, #b43f3f) 7%, transparent);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--app-danger, #b43f3f) 45%, transparent);
}
.diff-values .after {
  background: color-mix(in srgb, #2f7d57 9%, transparent);
  color: #276849;
}
.diff-arrow { color: var(--console-text-muted, #9a8e7e); text-align: center; }
</style>
