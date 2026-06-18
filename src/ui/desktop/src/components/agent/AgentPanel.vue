<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ChatDotRound, Close, Clock, Operation, Plus } from '@element-plus/icons-vue'
import ChatView from '../../views/ChatView.vue'
import { useWorkbenchUiStore } from '../../stores/workbenchUi'
import { useWorkspaceStore } from '../../stores/workspace'
import { useSession } from '../../composables/useSession'
import { useTaskBoardStore } from '../../stores/taskBoard'
import { useEventPlacementAskStore } from '../../stores/eventPlacementAsk'
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
  maxAgentPanelWidth,
  parseAgentPanelWidth,
} from '../../utils/agentPanelWidth'

type ChatViewApi = {
  startNewConversation: () => Promise<void>
  loadHistory: () => Promise<void>
}

const ui = useWorkbenchUiStore()
const workspaceStore = useWorkspaceStore()
const { activeSession } = useSession()
const taskBoard = useTaskBoardStore()
const placementAsk = useEventPlacementAskStore()
const taskPendingCount = computed(() =>
  taskBoard.tasksFor(activeSession.value?.id).filter((task) => task.status !== 'completed').length,
)
const placementPendingCount = computed(() => placementAsk.pendingCount)
const panelBadgeCount = computed(() => taskPendingCount.value + placementPendingCount.value)
const panel = ref<HTMLElement | null>(null)

function onPanelCommand(kind: string): void {
  if (kind === 'task' || kind === 'plan' || kind === 'placement' || kind === 'subagent') {
    ui.openSidePanel(kind)
  }
}
const chat = ref<ChatViewApi | null>(null)
const view = ref<'chat' | 'history'>('chat')
const panelWidth = ref(AGENT_PANEL_DEFAULT_WIDTH)
const resizing = ref(false)
let resizeStartX = 0
let resizeStartWidth = AGENT_PANEL_DEFAULT_WIDTH
let previousCursor = ''
let previousUserSelect = ''

// 聊天面板恒为浮层：不占 flex 空间（槽位 0），编辑器满宽不被挤压；内层按真实宽度浮在其上。
const panelStyle = computed(() => ({
  '--agent-panel-full': `${panelWidth.value}px`,
}))

// 把浮层实时宽度同步给编辑器，让地图区右移让出可见空间（工具栏仍满宽被盖住）。
watch(panelWidth, (width) => ui.setAgentPanelWidth(width), { immediate: true })

function availableWidth(): number {
  return panel.value?.parentElement?.clientWidth || window.innerWidth
}

function loadSavedWidth(): void {
  const saved = workspaceStore.settings.layout?.agentPanelWidth
  panelWidth.value = parseAgentPanelWidth(
    saved != null ? String(saved) : null,
    availableWidth(),
  )
}

function saveWidth(): void {
  workspaceStore.patchLayout({ agentPanelWidth: panelWidth.value })
}

function beginResize(event: PointerEvent): void {
  if (event.button !== 0 || !ui.agentPanelOpen) return
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = panelWidth.value
  resizing.value = true
  previousCursor = document.body.style.cursor
  previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', resizeFromPointer)
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
}

function resizeFromPointer(event: PointerEvent): void {
  panelWidth.value = clampAgentPanelWidth(
    resizeStartWidth - (event.clientX - resizeStartX),
    availableWidth(),
  )
}

function finishResize(): void {
  if (!resizing.value) return
  resizing.value = false
  document.body.style.cursor = previousCursor
  document.body.style.userSelect = previousUserSelect
  window.removeEventListener('pointermove', resizeFromPointer)
  window.removeEventListener('pointerup', finishResize)
  window.removeEventListener('pointercancel', finishResize)
  saveWidth()
}

function resetWidth(): void {
  panelWidth.value = clampAgentPanelWidth(AGENT_PANEL_DEFAULT_WIDTH, availableWidth())
  saveWidth()
}

function handleResizeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
  event.preventDefault()
  if (event.key === 'Home') {
    resetWidth()
    return
  }
  panelWidth.value = clampAgentPanelWidth(
    panelWidth.value + (event.key === 'ArrowLeft' ? 8 : -8),
    availableWidth(),
  )
  saveWidth()
}

function clampToViewport(): void {
  panelWidth.value = clampAgentPanelWidth(panelWidth.value, availableWidth())
}

async function openHistory(): Promise<void> {
  view.value = 'history'
  await nextTick()
  await chat.value?.loadHistory()
}

async function startNewConversation(): Promise<void> {
  await chat.value?.startNewConversation()
  view.value = 'chat'
}

function showChat(): void {
  view.value = 'chat'
}

onMounted(() => {
  loadSavedWidth()
  window.addEventListener('resize', clampToViewport)
})

onBeforeUnmount(() => {
  finishResize()
  window.removeEventListener('resize', clampToViewport)
})
</script>

<template>
  <aside
    ref="panel"
    class="agent-panel"
    :class="{ collapsed: !ui.agentPanelOpen, 'is-resizing': resizing }"
    :style="panelStyle"
    data-ui-id="agent-panel"
    aria-label="聊天"
  >
    <div v-show="ui.agentPanelOpen" class="agent-panel-inner" data-ui-id="agent-panel-inner">
      <div
        class="agent-panel-resizer"
        data-ui-id="agent-panel-resizer"
        role="separator"
        aria-label="调整聊天侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="AGENT_PANEL_MIN_WIDTH"
        :aria-valuemax="maxAgentPanelWidth(availableWidth())"
        :aria-valuenow="panelWidth"
        tabindex="0"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown="beginResize"
        @dblclick="resetWidth"
        @keydown="handleResizeKeydown"
      />
      <header class="agent-panel-head">
        <h3><ChatDotRound /><span>聊天</span></h3>
        <div class="head-actions">
          <el-dropdown trigger="click" placement="bottom-end" @command="onPanelCommand">
            <button type="button" class="head-btn panel-menu-btn" data-ui-id="agent-panel-menu" title="面板（TASK / PLAN / 待放置事件 / subagent）">
              <Operation />
              <span v-if="panelBadgeCount > 0" class="head-badge">{{ panelBadgeCount }}</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="task" :class="{ 'is-active': ui.sidePanel === 'task' }">
                  <span class="panel-menu-row">
                    <span>TASK</span>
                    <span v-if="taskPendingCount > 0" class="panel-menu-count">{{ taskPendingCount }}</span>
                  </span>
                </el-dropdown-item>
                <el-dropdown-item command="plan" :class="{ 'is-active': ui.sidePanel === 'plan' }">PLAN</el-dropdown-item>
                <el-dropdown-item command="placement" :class="{ 'is-active': ui.sidePanel === 'placement' }">
                  <span class="panel-menu-row">
                    <span>待放置事件</span>
                    <span v-if="placementPendingCount > 0" class="panel-menu-count">{{ placementPendingCount }}</span>
                  </span>
                </el-dropdown-item>
                <el-dropdown-item command="subagent" :class="{ 'is-active': ui.sidePanel === 'subagent' }">subagent</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button v-if="view === 'history'" type="button" class="head-btn" data-ui-id="agent-panel-back-chat" title="返回聊天" @click="showChat">
            <ArrowLeft />
          </button>
          <button v-else type="button" class="head-btn" data-ui-id="agent-panel-history" title="会话历史" @click="openHistory">
            <Clock />
          </button>
          <button type="button" class="head-btn" data-ui-id="agent-panel-new-chat" title="新建会话" @click="startNewConversation">
            <Plus />
          </button>
          <button type="button" class="head-btn" data-ui-id="agent-panel-close" title="关闭" @click="ui.setAgentPanelOpen(false)">
            <Close />
          </button>
        </div>
      </header>
      <ChatView
        ref="chat"
        class="agent-chat"
        :view="view"
        @conversation-selected="showChat"
        @conversation-created="showChat"
      />
    </div>
  </aside>
</template>

<style scoped>
/* 面板不占 flex 空间（槽位 0），编辑器满宽不被挤压；内容由内层浮在其上。 */
.agent-panel {
  position: relative;
  width: 0;
  min-width: 0;
  flex: 0 0 0;
  overflow: visible;
}

/* 内层贴右边、按真实宽度铺开，始终浮在编辑器之上实心遮罩（不压暗地图），左缘加深阴影分隔。 */
.agent-panel-inner {
  position: absolute;
  z-index: 20;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--agent-panel-full);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
  border-radius: 12px;
  box-shadow: -16px 0 36px rgba(40, 34, 22, 0.18), var(--app-shadow-1);
  transition: width 200ms ease;
}

.agent-panel.is-resizing .agent-panel-inner {
  transition: none;
}

.agent-panel.collapsed .agent-panel-inner {
  box-shadow: none;
}

.agent-panel-head {
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  background: var(--app-bg-soft);
}

.agent-panel-head h3 {
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 650;
}

.agent-panel-head h3 :deep(svg) {
  width: 14px;
  color: var(--app-ink-soft);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.panel-menu-btn {
  position: relative;
}

.head-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--app-accent);
  color: var(--app-accent-ink, #fff);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.head-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.head-btn:hover {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
  box-shadow: var(--app-shadow-1);
}

.head-btn:focus-visible,
.agent-panel-resizer:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.head-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.panel-menu-row {
  min-width: 116px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-menu-count {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border-radius: var(--app-radius-pill);
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

/* 手柄贴内层左缘内侧（内层 overflow:hidden，不能用负偏移），浮层时即跟随视觉左边。 */
.agent-panel-resizer {
  position: absolute;
  z-index: 25;
  top: 0;
  bottom: 0;
  left: 0;
  width: 10px;
  cursor: col-resize;
  outline: none;
}

.agent-panel-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  background: transparent;
  transition: background-color 120ms ease, width 120ms ease;
}

.agent-panel-resizer:hover::after,
.agent-panel-resizer:focus-visible::after,
.agent-panel.is-resizing .agent-panel-resizer::after {
  width: 2px;
  background: var(--app-accent);
}

.agent-chat {
  min-height: 0;
  flex: 1;
}

.agent-chat :deep(.chat-view) {
  height: 100%;
}

.agent-chat :deep(.chat-header) {
  display: none;
}

.agent-chat :deep(.chat-pane-body) {
  padding: 0;
}

/* 转录文字收紧到与输入框同一列：左右留白对齐输入框（底部槽 space-8 + composer margin 10）。 */
.agent-chat :deep(.chat-log) {
  padding: 12px calc(var(--space-8) + 10px);
}

.agent-chat :deep(.chat-hero) {
  padding: 20px;
  text-align: center;
}

.agent-chat :deep(.chat-pane.is-empty-chat .chat-hero) {
  padding: 20px 20px 180px;
}

.agent-chat :deep(.hero-title) {
  font-size: 14px;
}

.agent-chat :deep(.hero-sub) {
  font-size: 12px;
}

/* 输入框窄面板保持原宽（不加宽），宽面板封顶居中，与收紧后的转录文字同一列对齐。 */
.agent-chat :deep(.chat-composer) {
  width: calc(100% - 20px);
  max-width: var(--app-composer-max);
  margin: 0 auto 10px;
}
</style>
