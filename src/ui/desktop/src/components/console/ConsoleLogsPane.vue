<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { loadPersistedSegmentsFromChain } from '@contract/session-transcript';
import { sessions as sessionsApi, type SessionDetail, type SessionRuntimeEvent } from '../../api/client';
import {
  groupSessionsIntoRunLogs,
  type RunLogConversation,
  type RunLogSessionLike,
} from '../../utils/consoleRunGroups';
import ConsoleRunDetail from './ConsoleRunDetail.vue';
import ConsoleSearchInput from './ConsoleSearchInput.vue';

type SessionRow = RunLogSessionLike;

const props = defineProps<{ sessions: SessionRow[]; loading: boolean; error: string | null; currentProject: string }>();
const query = ref('');
const status = ref('');
const project = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const detail = ref<SessionDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const listScroll = ref<HTMLElement | null>(null);
let savedScrollTop = 0;
let detailRequestId = 0;

const statusMeta: Record<string, { label: string; tone: string }> = {
  pass: { label: '通过', tone: 'ok' },
  completed: { label: '通过', tone: 'ok' },
  blocked: { label: '被拦截', tone: 'error' },
  failed: { label: '失败', tone: 'error' },
  error: { label: '失败', tone: 'error' },
  interrupted: { label: '中断', tone: 'warn' },
  stopped: { label: '已停止', tone: 'warn' },
  running: { label: '进行中', tone: 'running' },
  preparing: { label: '准备中', tone: 'running' },
  starting: { label: '启动中', tone: 'running' },
};

function meta(value = '') {
  return statusMeta[value] || { label: value || '未知', tone: 'muted' };
}

function dayKey(date: Date): string {
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

function dayLabel(date: Date): string {
  if (Number.isNaN(date.getTime())) return '日期未知';
  const label = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  return dayKey(date) === dayKey(new Date()) ? `今天 · ${label}` : label;
}

function timeLabel(date: Date): string {
  return Number.isNaN(date.getTime())
    ? '--:--'
    : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function conversationDate(conversation: RunLogConversation): Date {
  return new Date(conversation.time || 0);
}

function mergeDetails(conversation: RunLogConversation, details: SessionDetail[]): SessionDetail {
  const root = details[0];
  const leaf = details[details.length - 1] || root;
  let sequence = 0;
  const events = details.flatMap((detail) =>
    (detail.events || []).map((event) => ({
      ...event,
      sessionId: event.sessionId || detail.id,
      sequence: ++sequence,
    }) as SessionRuntimeEvent),
  );
  const segments = loadPersistedSegmentsFromChain(details.map((item) => ({ chatLog: item.chatLog }))) || [];
  const base = leaf || root || {};
  return {
    ...base,
    id: conversation.leafId,
    status: conversation.status,
    project: conversation.project,
    intent: root?.intent || leaf?.intent || conversation.title,
    displayText: conversation.title,
    parentSessionId: root?.parentSessionId || null,
    updatedAt: conversation.time,
    chatLog: { segments },
    events,
  };
}

const conversations = computed(() => groupSessionsIntoRunLogs(props.sessions));
const projects = computed(() => [...new Set(conversations.value.map((item) => item.project).filter(Boolean))] as string[]);
const projectChoices = computed(() => {
  const choices = [...projects.value];
  if (props.currentProject && !choices.includes(props.currentProject)) choices.unshift(props.currentProject);
  return choices;
});
const statuses = computed(() => [...new Set(conversations.value.map((item) => item.status).filter(Boolean))] as string[]);
const filtered = computed(() => conversations.value.filter((item) => {
  const searchable = item.searchText;
  const day = dayKey(conversationDate(item));
  return (!query.value || searchable.includes(query.value.toLowerCase()))
    && (!status.value || item.status === status.value)
    && (!project.value || item.project === project.value)
    && (!dateFrom.value || day >= dateFrom.value)
    && (!dateTo.value || day <= dateTo.value);
}));
const groups = computed(() => {
  const map = new Map<string, { date: Date; conversations: RunLogConversation[] }>();
  [...filtered.value]
    .sort((a, b) => conversationDate(b).getTime() - conversationDate(a).getTime())
    .forEach((conversation) => {
      const date = conversationDate(conversation);
      const key = dayKey(date);
      const group = map.get(key) || { date, conversations: [] };
      group.conversations.push(conversation);
      map.set(key, group);
    });
  return [...map.values()];
});
const showingDetail = computed(() => Boolean(detail.value || detailLoading.value || detailError.value));

watch(() => props.currentProject, (next) => {
  project.value = next || '';
}, { immediate: true });

async function openDetail(conversation: RunLogConversation) {
  const requestId = ++detailRequestId;
  savedScrollTop = listScroll.value?.scrollTop || 0;
  detail.value = null;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const details = await Promise.all(conversation.sessionIds.map((id) => sessionsApi.get(id) as Promise<SessionDetail>));
    if (requestId === detailRequestId) detail.value = mergeDetails(conversation, details.filter(Boolean));
  } catch (error) {
    if (requestId === detailRequestId) detailError.value = (error as Error).message;
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}

async function closeDetail() {
  detailRequestId += 1;
  detail.value = null;
  detailLoading.value = false;
  detailError.value = '';
  await nextTick();
  if (listScroll.value) listScroll.value.scrollTop = savedScrollTop;
}

</script>

<template>
  <div class="logs">
    <ConsoleRunDetail
      v-if="showingDetail"
      :detail="detail"
      :loading="detailLoading"
      :error="detailError"
      @back="closeDetail"
    />

    <div v-show="!showingDetail" ref="listScroll" class="logs-list">
      <div class="log-toolbar">
        <ConsoleSearchInput v-model="query" placeholder="搜索标题、会话 ID 或项目" />
        <select v-model="status">
          <option value="">全部状态</option>
          <option v-for="item in statuses" :key="item" :value="item">{{ meta(item).label }}</option>
        </select>
        <select v-model="project">
          <option value="">全部项目</option>
          <option v-for="item in projectChoices" :key="item" :value="item">{{ item }}</option>
        </select>
        <input v-model="dateFrom" type="date" title="开始日期">
        <input v-model="dateTo" type="date" title="结束日期">
      </div>

      <div v-if="error" class="empty error">{{ error }}</div>
      <div v-else-if="loading" class="empty">正在读取运行记录…</div>
      <div v-else-if="groups.length" class="log-groups">
        <section v-for="group in groups" :key="dayKey(group.date)" class="log-group">
          <header>{{ dayLabel(group.date) }}</header>
          <button
            v-for="conversation in group.conversations"
            :key="conversation.rootId"
            type="button"
            class="log-entry"
            :class="{ failed: meta(conversation.status).tone === 'error' }"
            @click="openDetail(conversation)"
          >
            <time>{{ timeLabel(conversationDate(conversation)) }}</time>
            <span class="badge" :class="meta(conversation.status).tone">{{ meta(conversation.status).label }}</span>
            <strong>{{ conversation.title }}</strong>
            <span class="log-project">
              <code>{{ conversation.project }}</code>
              <small v-if="conversation.turnCount > 1">{{ conversation.turnCount }} 轮</small>
            </span>
            <em>查看过程 ›</em>
          </button>
        </section>
      </div>
      <div v-else class="empty">没有匹配的运行记录</div>
    </div>
  </div>
</template>

<style scoped>
.logs{height:100%;min-height:0;display:flex;flex:1;flex-direction:column;overflow:hidden}
.logs-list{height:100%;overflow:auto;padding:14px 40px 34px}
.log-toolbar{position:sticky;top:-14px;z-index:3;display:grid;grid-template-columns:minmax(220px,1fr) repeat(2,minmax(110px,auto)) 130px 130px;gap:8px;padding:0 0 12px;background:linear-gradient(180deg,var(--console-page,#f4efe7) 70%,color-mix(in srgb,var(--console-page,#f4efe7) 0%,transparent))}
.log-toolbar select,.log-toolbar input[type="date"]{min-width:0;height:30px;border:1px solid var(--console-border-strong,#ddd3c2);border-radius:9px;background:var(--console-paper,#fffdfa);padding:0 10px;color:var(--console-text,#211d17);font:inherit;font-size:11px}.log-toolbar select:focus,.log-toolbar input[type="date"]:focus{outline:none;box-shadow:var(--app-ring)}
.log-groups{border:1px solid var(--console-border,#e4dcce);border-radius:14px;background:var(--console-paper,#fffdfa);box-shadow:none}
.log-group header{position:sticky;top:32px;z-index:2;padding:10px 18px 8px;background:var(--console-paper-soft,#faf5ec);color:var(--console-text-muted,#9a8e7e);font-size:11px;font-weight:700;letter-spacing:.08em}
.log-entry{width:100%;display:grid;grid-template-columns:54px 72px minmax(0,1fr) 190px 78px;align-items:center;gap:12px;padding:12px 18px;border:0;border-bottom:1px solid #f2eadc;background:transparent;color:inherit;text-align:left;cursor:pointer;font-size:12px}
.log-entry:hover{background:#fbf1e9}.log-entry.failed{background:var(--app-danger-soft)}.log-entry.failed:hover{background:color-mix(in srgb,var(--app-danger-soft) 72%,#f1e9db)}
.log-entry time,.log-entry code{overflow:hidden;color:var(--console-text-muted,#9a8e7e);font:10.5px var(--app-font-mono);text-overflow:ellipsis;white-space:nowrap}.log-entry strong{overflow:hidden;color:var(--console-text-soft,#5a5247);font-size:13.5px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.log-entry>span:not(.badge){overflow:hidden;color:var(--console-text-muted,#9a8e7e);text-overflow:ellipsis;white-space:nowrap}.log-entry em{color:var(--console-accent,#be5630);font-size:12px;font-weight:600;font-style:normal;text-align:right}
.log-project{min-width:0;display:flex;align-items:center;gap:7px}.log-project code{min-width:0}.log-project small{flex:0 0 auto;padding:1px 6px;border-radius:7px;background:var(--console-paper-soft,#faf5ec);color:var(--console-text-muted,#9a8e7e);font-size:10px;font-weight:700}
.badge{justify-self:start;padding:2px 9px;border-radius:7px;font-size:10px;font-weight:700}.badge.ok{background:#e6f0e5;color:#3f7a4d}.badge.warn{background:#f5ecd9;color:#b07a2e}.badge.error{background:var(--app-danger-soft);color:var(--app-danger)}.badge.running{background:var(--console-accent-soft,#f6e3d7);color:var(--console-accent,#be5630)}.badge.muted{background:var(--console-paper-soft,#faf5ec);color:var(--console-text-muted,#9a8e7e)}
.empty{min-height:300px;display:grid;place-items:center;color:var(--console-text-muted,#9a8e7e);font-size:11px}.empty.error{color:var(--app-danger)}
@media(max-width:1280px){.log-toolbar{grid-template-columns:1fr 1fr 1fr}.log-entry{grid-template-columns:52px 68px minmax(0,1fr) 72px}.log-project{display:none}}
</style>
