<template>
  <!-- 用户消息气泡（右对齐） -->
  <div v-if="segment.type === 'user'" class="seg-user">
    <div class="user-bubble">{{ segment.content }}</div>
  </div>

  <!-- Agent 文本：流式中用纯文本避免整段 markdown 重绘；结束后一次性渲染 markdown -->
  <div v-else-if="segment.type === 'text'" class="seg-text">
    <div v-if="streamPlain" class="md markdown-body stream-plain">{{ segment.content }}</div>
    <div v-else class="md markdown-body" v-html="textHtml" />
  </div>

  <!-- 推理始终直接展示，不参与执行记录折叠。 -->
  <div v-else-if="segment.type === 'reasoning'" class="seg-reasoning">
    <div
      class="reason-body md markdown-body"
      :class="{ 'stream-plain': streamPlain }"
    >
      <template v-if="streamPlain">{{ segment.content }}</template>
      <div v-else v-html="reasonHtml" />
    </div>
  </div>

  <!-- 工具调用：单行中文摘要，可展开看输入 / 输出 -->
  <div v-else-if="segment.type === 'tool'" class="seg-tool">
    <button class="row-toggle" @click="expanded = !expanded">
      <el-icon class="chev" :class="{ open: expanded }"><ArrowRight /></el-icon>
      <span class="tool-status" :class="toolStatusClass">
        <el-icon v-if="isRunning" class="is-loading"><Loading /></el-icon>
        <el-icon v-else-if="isSkipped"><WarningFilled /></el-icon>
        <el-icon v-else-if="isFailed"><CircleCloseFilled /></el-icon>
        <el-icon v-else><Select /></el-icon>
      </span>
      <span class="tool-verb">{{ toolSummary.label }}<template v-if="toolSummary.target">：</template></span>
      <span v-if="toolSummary.target" class="tool-target">{{ toolSummary.target }}</span>
    </button>
    <div v-show="expanded" class="tool-body">
      <div v-if="segment.metadata?.input !== undefined" class="tool-block">
        <div class="tool-block-label">输入</div>
        <pre>{{ formatJson(segment.metadata?.input) }}</pre>
      </div>
      <div v-if="segment.metadata?.output !== undefined" class="tool-block">
        <div class="tool-block-label">输出</div>
        <pre>{{ formatJson(segment.metadata?.output) }}</pre>
      </div>
    </div>
  </div>

  <!-- 状态按发生顺序保留在转录中 -->
  <div v-else-if="segment.type === 'status'" class="seg-status">
    <span class="status-dot" :class="statusType(segment.metadata?.status)" />
    <span class="status-label">{{ statusLabel(segment.metadata?.status) }}</span>
    <span v-if="segment.metadata?.exitCode !== undefined" class="status-extra">exit={{ segment.metadata.exitCode }}</span>
    <span v-if="segment.metadata?.blocker" class="status-blocker">· {{ formatBlocker(segment.metadata.blocker) }}</span>
  </div>

  <!-- 事件预览块：agent 本轮写的事件，独立内嵌、可折叠、无边框 -->
  <EventPreviewList
    v-else-if="segment.type === 'meta' && segment.metadata?.type === 'event-preview-list'"
    :events="(segment.metadata?.events as EventPreviewItem[]) || []"
  />

  <!-- meta：command / artifact / tokens 一行淡色 -->
  <div v-else-if="segment.type === 'meta'" class="seg-meta">
    <!-- 命令：默认折叠成单行，展开看完整命令（弱化底层噪音） -->
    <div v-if="segment.metadata?.type === 'command'" class="cmd-collapsible">
      <button class="row-toggle" @click="expanded = !expanded">
        <el-icon class="chev" :class="{ open: expanded }"><ArrowRight /></el-icon>
        <span class="meta-tag">运行命令<template v-if="commandPreview">：</template></span>
        <span class="cmd-preview">{{ commandPreview }}</span>
      </button>
      <code v-show="expanded" class="command-block">{{ segment.metadata.command }}</code>
    </div>
    <template v-else-if="segment.metadata?.type === 'artifact'">
      <span class="meta-tag">artifacts</span>
      <span class="meta-text">{{ segment.metadata.outDir }}</span>
    </template>
    <template v-else-if="segment.metadata?.type === 'tokens'">
      <span class="meta-tag">tokens</span>
      <span class="meta-text">
        in {{ segment.metadata.inputTokens }} · out {{ segment.metadata.outputTokens }} ·
        total {{ (Number(segment.metadata.inputTokens) || 0) + (Number(segment.metadata.outputTokens) || 0) }}
      </span>
    </template>
    <template v-else-if="segment.metadata?.type === 'preparation'">
      <span class="meta-tag">准备</span>
      <span class="meta-text">
        {{ segment.metadata.stage || '工作区' }}
        <template v-if="segment.metadata.status"> · {{ segment.metadata.status }}</template>
      </span>
    </template>
    <template v-else-if="segment.metadata?.type === 'permission_hint'">
      <span class="meta-tag warn">权限跳过</span>
      <span class="meta-text">{{ segment.metadata.text }}</span>
    </template>
    <template v-else-if="segment.metadata?.type === 'runtime_warning'">
      <span class="meta-tag warn">告警</span>
      <span class="meta-text">{{ segment.metadata.text }}</span>
    </template>
    <template v-else-if="segment.metadata?.type === 'ask_bridge_failed'">
      <span class="meta-tag error">ASK</span>
      <span class="meta-text">{{ segment.metadata.text }}</span>
    </template>
    <template v-else-if="segment.metadata?.type === 'stderr'">
      <span class="meta-tag error">stderr</span>
      <pre class="stderr-text">{{ segment.metadata.text }}</pre>
    </template>
    <template v-else-if="segment.metadata?.type === 'summary'">
      <div class="result-card" :class="statusType(segment.metadata.status)">
        <div class="result-head">
          <strong>{{ summaryTitle(segment.metadata.status) }}</strong>
          <span>{{ formatDuration(segment.metadata.durationMs) }}</span>
        </div>
        <div class="result-grid">
          <span>tokens {{ totalTokens }}</span>
          <span v-if="segment.metadata.outDir">artifacts {{ segment.metadata.outDir }}</span>
        </div>
        <div v-if="segment.metadata.blocker" class="result-blocker">{{ formatBlocker(segment.metadata.blocker) }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { ArrowRight, Loading, Select, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import type { ChatSegment, EventPreviewItem } from '../composables/useSessionStream'
import { renderMarkdown } from '../utils/markdown'
import { summarizeToolCall } from '../utils/toolPresentation'
import EventPreviewList from './EventPreviewList.vue'

const props = defineProps<{
  segment: ChatSegment
  /** 该段正在流式接收（live）：仍渲染 markdown，但解析按帧节流；由 ChatLog 传入 */
  streamPlain?: boolean
}>()

const textHtml = ref('')
const reasonHtml = ref('')

function renderNow(): void {
  if (props.segment.type === 'text') {
    textHtml.value = renderMarkdown(props.segment.content)
  } else if (props.segment.type === 'reasoning') {
    reasonHtml.value = renderMarkdown(props.segment.content)
  }
}

// 流式正文由模板直接绑定纯文本；仅终态与推理段做 markdown 解析。
let rafId: number | null = null
function refreshMarkdown(): void {
  if (props.streamPlain && (props.segment.type === 'text' || props.segment.type === 'reasoning')) return
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  renderNow()
}

watch(
  () => [props.segment.content, props.streamPlain, props.segment.type] as const,
  () => refreshMarkdown(),
  { immediate: true },
)

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
})

const expanded = ref(false)

const isRunning = computed(() => props.segment.metadata?.status === 'running')
const isSkipped = computed(() =>
  props.segment.metadata?.status === 'skipped' || props.segment.metadata?.skipped === true
)
const isFailed = computed(() =>
  !isSkipped.value && props.segment.metadata?.status === 'done' && props.segment.metadata?.success === false
)
const toolStatusClass = computed(() =>
  isRunning.value ? 'running' : isSkipped.value ? 'skipped' : isFailed.value ? 'failed' : 'ok'
)
const totalTokens = computed(() => finiteNumber(props.segment.metadata?.inputTokens) + finiteNumber(props.segment.metadata?.outputTokens))

// 命令折叠行的预览：截断的完整命令，展开才看全。
const commandPreview = computed(() => truncate(String(props.segment.metadata?.command || ''), 56))

// 从工具名 + input 推导单行中文摘要，避免直接暴露底层工具名。
const toolSummary = computed(() => {
  const tool = String(props.segment.metadata?.tool || 'tool')
  return summarizeToolCall(tool, props.segment.metadata?.input)
})

function truncate(s: string, n = 80): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatBlocker(blocker: unknown): string {
  if (typeof blocker === 'string') return blocker
  try {
    return JSON.stringify(blocker)
  } catch {
    return String(blocker)
  }
}

function statusType(status: unknown): string {
  switch (status) {
    case 'preparing': return 'warn'
    case 'starting': return 'warn'
    case 'running': return 'warn'
    case 'pass': return 'ok'
    case 'blocked': return 'warn'
    case 'failed': return 'err'
    case 'error': return 'err'
    case 'timeout': return 'err'
    case 'stopped': return 'muted'
    default: return 'muted'
  }
}

function statusLabel(status: unknown): string {
  const map: Record<string, string> = {
    preparing: '准备中',
    starting: '启动中',
    running: '运行中',
    pass: '完成',
    blocked: '阻塞',
    failed: '失败',
    error: '错误',
    stopped: '已停止',
    interrupted: '已中断',
    timeout: '超时',
  }
  const key = String(status || '')
  return map[key] || key
}

function summaryTitle(status: unknown): string {
  if (status === 'pass') return '完成'
  if (status === 'stopped') return '已停止'
  if (status === 'interrupted') return '已中断'
  return '未完成'
}

function formatDuration(value: unknown): string {
  const ms = Number(value || 0)
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function finiteNumber(value: unknown): number {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}
</script>

<style scoped>
/* 用户气泡 / markdown / command / result 见 styles/chat.css */

/* 折叠行（工具 / 命令）共用 */
.row-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--app-bg-soft);
  cursor: pointer;
  text-align: left;
  color: var(--el-text-color-secondary);
  font-size: 12.5px;
}
.row-toggle:hover { color:var(--app-ink); background:var(--app-bg-sunken); }
.chev {
  transition: transform 0.15s;
  font-size: 12px;
}
.chev.open {
  transform: rotate(90deg);
}

/* 推理：直接展示，和正文同处时间线但保持次级层级。 */
.reason-body {
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}

/* 工具 */
.tool-status {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
}
.tool-status.ok { color: var(--el-color-success); }
.tool-status.skipped { color: var(--el-color-warning); }
.tool-status.failed { color: var(--el-color-danger); }
.tool-status.running { color: var(--app-ink); }
.tool-verb {
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.tool-target {
  font-family: var(--el-font-family-mono, monospace);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-body {
  margin: 4px 0 4px 20px;
}
.tool-block + .tool-block {
  margin-top: 8px;
}
.tool-block-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
  margin-bottom: 2px;
}
.tool-body pre {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  background-color: var(--el-fill-color-light);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow-y: auto;
}

/* 状态 / meta：一行淡色小字 */
.seg-status,
.seg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 2px 2px;
}

/* 技术信息统一等宽，贴近 Codex */
.status-label,
.status-extra,
.meta-text,
.cmd-preview {
  font-family: var(--app-font-mono);
}

/* 中间态弱化：更小更淡，不抢正文 */
.seg-status.is-transient {
  font-size: 11px;
  opacity: .55;
}

/* 命令折叠 */
.cmd-collapsible {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}
.cmd-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-placeholder);
}
.cmd-collapsible .command-block {
  margin-top: 4px;
  border: 0;
  background: #2c2a26;
  color: #f5f3ee;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--el-text-color-placeholder);
}
.status-dot.ok { background-color: var(--el-color-success); }
.status-dot.warn { background-color: var(--el-color-warning); }
.status-dot.err { background-color: var(--el-color-danger); }
.status-dot.muted { background-color: var(--el-text-color-placeholder); }
.status-blocker { color: var(--el-color-danger); }
.meta-tag {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
}
.meta-code {
  font-family: monospace;
  color: var(--el-text-color-regular);
}
.meta-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-tag.error {
  color: var(--el-color-danger);
}
.meta-tag.warn {
  color: var(--el-color-warning);
}
.stderr-text {
  margin: 0;
  color: var(--el-color-danger);
  white-space: pre-wrap;
  font-family: var(--app-font-mono);
  font-size: 12px;
}
.result-blocker {
  margin-top: 8px;
  color: var(--el-color-danger);
  font-size: 12px;
}
</style>
