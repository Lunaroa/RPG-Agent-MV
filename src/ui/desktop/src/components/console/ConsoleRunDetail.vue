<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SessionDetail } from '../../api/client';
import {
  buildRunTimeline,
  filterRunTimeline,
  type RunTimelineKind,
  type RunTimelineOutcome,
} from '../../utils/consoleRunTimeline';
import ConsoleSearchInput from './ConsoleSearchInput.vue';
import { useI18n, type MessageKey } from '../../i18n';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';

const props = defineProps<{
  detail: SessionDetail | null;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{
  back: [];
}>();

const query = ref('');
const selectedKinds = ref<string[]>([]);
const selectedTools = ref<string[]>([]);
const selectedOutcomes = ref<string[]>([]);
const showInternal = ref(false);
const { language, t } = useI18n();

const kindLabels: Record<RunTimelineKind, MessageKey> = {
  user: 'console.run.kind.user',
  assistant: 'console.run.kind.assistant',
  decision: 'console.run.kind.decision',
  tool: 'console.run.kind.tool',
  error: 'console.run.kind.error',
  artifact: 'console.run.kind.artifact',
  status: 'console.run.kind.status',
  internal: 'console.run.kind.internal',
};
const outcomeLabels: Record<RunTimelineOutcome, MessageKey> = {
  success: 'console.run.outcome.success',
  failure: 'console.run.outcome.failure',
  neutral: 'console.run.outcome.neutral',
};

const timeline = computed(() => buildRunTimeline(props.detail?.chatLog, props.detail?.events, props.detail?.blocker, language.value));
const kinds = computed(() => [...new Set(timeline.value
  .filter((item) => showInternal.value || !item.lowValue)
  .map((item) => item.kind))]);
const tools = computed(() => [...new Set(timeline.value.map((item) => item.tool).filter(Boolean))] as string[]);
const outcomeOptions = computed(() => (Object.keys(outcomeLabels) as RunTimelineOutcome[]).map((value) => ({
  value,
  label: outcomeLabel(value),
})));
const visibleTimeline = computed(() => filterRunTimeline(timeline.value, {
  query: query.value,
  kinds: selectedKinds.value,
  tools: selectedTools.value,
  outcomes: selectedOutcomes.value,
  showInternal: showInternal.value,
}));
const hiddenCount = computed(() => timeline.value.filter((item) => item.lowValue).length);

watch(showInternal, (visible) => {
  if (!visible) selectedKinds.value = selectedKinds.value.filter((item) => item !== 'internal');
});

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 1000) return '--:--:--';
  return new Intl.DateTimeFormat(language.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function kindLabel(kind: RunTimelineKind): string {
  return t(kindLabels[kind]);
}

function outcomeLabel(outcome: RunTimelineOutcome): string {
  return t(outcomeLabels[outcome]);
}

function formatErrorText(errorValue: unknown): string {
  return formatUserFacingErrorMessage(errorValue, 'general', language.value);
}
</script>

<template>
  <section class="run-detail">
    <div class="detail-nav">
      <button type="button" class="back-button" @click="emit('back')">
        <span aria-hidden="true">‹</span>
        {{ t('console.run.back') }}
      </button>
    </div>

    <div v-if="loading && !detail" class="state">{{ t('console.run.loading') }}</div>
    <div v-else-if="error && !detail" class="state error">{{ formatErrorText(error) }}</div>

    <template v-else-if="detail">
      <div class="timeline-toolbar">
        <ConsoleSearchInput v-model="query" :placeholder="t('console.run.searchPlaceholder')" />
        <el-select v-model="selectedKinds" multiple collapse-tags collapse-tags-tooltip clearable :placeholder="t('console.run.allContent')">
          <el-option v-for="item in kinds" :key="item" :label="kindLabel(item)" :value="item" />
        </el-select>
        <el-select v-model="selectedTools" multiple collapse-tags collapse-tags-tooltip clearable :placeholder="t('console.run.allTools')">
          <el-option v-for="item in tools" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="selectedOutcomes" multiple collapse-tags collapse-tags-tooltip clearable :placeholder="t('console.run.allResults')">
          <el-option v-for="item in outcomeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <label class="noise-toggle">
          <input v-model="showInternal" type="checkbox">
          <span>{{ t('console.run.showInternal') }}</span>
          <b v-if="hiddenCount">{{ hiddenCount }}</b>
        </label>
      </div>

      <div class="timeline-scroll">
        <div v-if="visibleTimeline.length" class="timeline">
          <article
            v-for="item in visibleTimeline"
            :key="item.id"
            class="timeline-item"
            :class="[item.kind, item.outcome]"
          >
            <time>{{ formatTime(item.at) }}</time>
            <span class="timeline-dot" />
            <div class="timeline-card">
              <header>
                <span>{{ kindLabel(item.kind) }}</span>
                <strong>{{ item.title }}</strong>
                <em v-if="item.outcome !== 'neutral'">{{ outcomeLabel(item.outcome) }}</em>
              </header>
              <p v-if="item.body">{{ item.body }}</p>
              <div v-if="item.parameters" class="tool-parameters">
                <strong>{{ t('console.run.parameters') }}</strong>
                <pre>{{ item.parameters }}</pre>
              </div>
              <div v-if="item.error" class="tool-error">
                <strong>{{ t('console.run.errorReason') }}</strong>
                <pre>{{ item.error }}</pre>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="state compact">{{ t('console.run.noMatches') }}</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.run-detail{height:100%;min-height:0;display:flex;flex-direction:column;padding:0 10px 10px;overflow:hidden}
.detail-nav{height:38px;flex:0 0 38px;display:flex;align-items:center}
.back-button{height:28px;display:flex;align-items:center;gap:5px;padding:0 10px;border:1px solid var(--app-border);border-radius:var(--app-radius-md);background:var(--app-bg);color:var(--app-ink-soft);font:inherit;font-size:11px;cursor:pointer}.back-button span{font-size:20px;line-height:1}.back-button:hover{border-color:var(--app-border-strong);background:var(--app-bg-soft);color:var(--app-ink)}
.timeline-toolbar{display:grid;grid-template-columns:minmax(210px,1fr) repeat(3,minmax(120px,auto)) auto;gap:7px;padding:10px 0}
.timeline-toolbar :deep(.el-select){min-width:120px}.timeline-toolbar :deep(.el-select__wrapper){min-height:30px;border-radius:var(--app-radius-md);background:var(--app-bg);box-shadow:0 0 0 1px var(--app-border) inset;font-size:10.5px}.timeline-toolbar :deep(.el-select__wrapper.is-focused){box-shadow:var(--app-ring),0 0 0 1px var(--app-accent) inset}
.noise-toggle{height:30px;display:flex;align-items:center;gap:6px;padding:0 9px;border:1px solid var(--app-border);border-radius:var(--app-radius-md);background:var(--app-bg);color:var(--app-ink-soft);font-size:10.5px;cursor:pointer;white-space:nowrap}.noise-toggle input{width:13px;height:13px;margin:0;accent-color:var(--app-accent)}.noise-toggle b{min-width:17px;padding:1px 5px;border-radius:var(--app-radius-pill);background:var(--app-bg-sunken);color:var(--app-ink-muted);font-size:9px;text-align:center}
.timeline-scroll{min-height:0;flex:1;overflow:auto;border:1px solid var(--app-border);border-radius:var(--app-radius-lg);background:var(--app-bg)}
.timeline{max-width:960px;margin:0 auto;padding:14px 20px 30px}.timeline-item{display:grid;grid-template-columns:70px 15px minmax(0,1fr);gap:10px;position:relative}.timeline-item:not(:last-child)::after{content:"";position:absolute;top:27px;bottom:-1px;left:87px;width:1px;background:var(--app-border)}
.timeline-item time{padding-top:10px;color:var(--app-ink-muted);font:9.5px var(--app-font-mono);text-align:right}.timeline-dot{width:9px;height:9px;margin-top:12px;border:2px solid var(--app-bg);border-radius:50%;background:var(--app-ink-muted);box-shadow:0 0 0 1px var(--app-border-strong);z-index:1}
.timeline-card{min-width:0;margin-bottom:9px;padding:10px 12px;border:1px solid var(--app-border);border-radius:var(--app-radius-md);background:var(--app-bg-elevated)}.timeline-card header{display:flex;align-items:center;gap:7px}.timeline-card header span{color:var(--app-ink-muted);font-size:9.5px}.timeline-card header strong{min-width:0;overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.timeline-card header em{margin-left:auto;padding:1px 6px;border-radius:var(--app-radius-pill);font-size:9px;font-style:normal}.timeline-card p{margin:7px 0 0;color:var(--app-ink-soft);font-size:11px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.tool-parameters,.tool-error{margin-top:9px;padding-top:8px;border-top:1px solid var(--app-border)}.tool-parameters>strong,.tool-error>strong{display:block;margin-bottom:5px;color:var(--app-ink-muted);font-size:9.5px}.tool-parameters pre,.tool-error pre{margin:0;padding:8px 10px;border-radius:var(--app-radius-sm);background:var(--app-bg-soft);color:var(--app-ink-soft);font:10.5px/1.6 var(--app-font-mono);white-space:pre-wrap;word-break:break-word}.tool-error pre{background:var(--app-danger-soft);color:var(--app-danger)}
.timeline-item.user .timeline-card{background:var(--app-user-bubble)}.timeline-item.user .timeline-dot,.timeline-item.assistant .timeline-dot{background:var(--app-accent)}.timeline-item.tool .timeline-dot{background:var(--app-tone-control)}.timeline-item.error .timeline-dot,.timeline-item.failure .timeline-dot{background:var(--app-danger)}.timeline-item.artifact .timeline-dot,.timeline-item.success .timeline-dot{background:var(--app-ok)}
.timeline-item.success .timeline-card header em{background:var(--app-ok-soft);color:var(--app-ok)}.timeline-item.failure .timeline-card header em{background:var(--app-danger-soft);color:var(--app-danger)}
.state{min-height:220px;display:grid;flex:1;place-items:center;color:var(--app-ink-muted);font-size:11px}.state.error{color:var(--app-danger)}.state.compact{min-height:160px}
@media(max-width:1200px){.timeline-toolbar{grid-template-columns:1fr 1fr 1fr}.noise-toggle{justify-content:center}.timeline-item{grid-template-columns:55px 15px minmax(0,1fr)}.timeline-item:not(:last-child)::after{left:72px}}
</style>
