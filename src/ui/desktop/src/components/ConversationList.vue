<template>
  <aside
    class="conv-list"
    :class="{ 'is-resizing': resizing, 'is-fill': !resizable }"
    :style="resizable ? { width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` } : undefined"
  >
    <div v-if="showNewButton" class="conv-head">
      <button type="button" class="conv-new-btn" @click="emit('new-conversation')">
        <el-icon><EditPen /></el-icon>
        <span>{{ t('conversation.new') }}</span>
      </button>
    </div>

    <div class="conv-scroll">
      <div v-if="loading" class="conv-hint">
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ t('conversation.loading') }}
      </div>
      <div v-else-if="error" class="conv-hint is-error">{{ error }}</div>
      <div v-else-if="groupedConversations.length === 0" class="conv-hint">{{ t('conversation.empty') }}</div>

      <section v-for="group in groupedConversations" v-else :key="group.label" class="conv-group">
        <div class="conv-group-label">{{ group.label }}</div>
        <button
          v-for="conv in group.items"
          :key="conv.rootId"
          type="button"
          class="conv-item"
          :class="{ active: conv.rootId === activeRootId }"
          @click="emit('select', conv.leafId)"
          @contextmenu.prevent="emit('delete', conv)"
        >
          <span class="conv-title">{{ conv.title || t('conversation.untitled') }}</span>
          <span class="conv-time">{{ formatTime(conv.time) }}</span>
          <span
            class="conv-delete"
            role="button"
            tabindex="0"
            :title="t('conversation.delete')"
            :aria-label="t('conversation.delete')"
            @click.stop="emit('delete', conv)"
            @keydown.enter.stop="emit('delete', conv)"
          >
            <el-icon><Delete /></el-icon>
          </span>
        </button>
      </section>
    </div>

    <div
      v-if="resizable"
      class="conv-resizer"
      role="separator"
      :aria-label="t('conversation.resize')"
      aria-orientation="vertical"
      :aria-valuemin="MIN_WIDTH"
      :aria-valuemax="MAX_WIDTH"
      :aria-valuenow="sidebarWidth"
      tabindex="0"
      :title="t('conversation.resizeTitle')"
      @pointerdown="beginResize"
      @dblclick="resetWidth"
      @keydown="handleResizeKeydown"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Delete, EditPen, Loading } from '@element-plus/icons-vue'
import type { Session } from '../composables/useSession'
import {
  activeConversationRootId,
  groupSessionsIntoConversations,
  type Conversation,
} from '../utils/conversationGroups'
import {
  CHAT_HISTORY_DEFAULT_WIDTH,
  CHAT_HISTORY_MAX_WIDTH,
  CHAT_HISTORY_MIN_WIDTH,
  clampChatHistoryWidth,
  parseChatHistoryWidth,
} from '../utils/chatHistoryWidth'
import { useWorkspaceStore } from '../stores/workspace'
import { useI18n } from '../i18n'

const props = defineProps<{
  sessions: Session[]
  activeId?: string | null
  loading?: boolean
  error?: string | null
  resizable?: boolean
  showNewButton?: boolean
}>()

const resizable = computed(() => props.resizable !== false)
const showNewButton = computed(() => props.showNewButton !== false)

const emit = defineEmits<{
  'new-conversation': []
  select: [leafId: string]
  delete: [conversation: Conversation]
}>()

const DEFAULT_WIDTH = CHAT_HISTORY_DEFAULT_WIDTH
const MIN_WIDTH = CHAT_HISTORY_MIN_WIDTH
const MAX_WIDTH = CHAT_HISTORY_MAX_WIDTH

const workspaceStore = useWorkspaceStore()
const { language, t } = useI18n()

function loadSavedWidth(): number {
  const saved = workspaceStore.settings.layout?.chatHistoryWidth
  return parseChatHistoryWidth(saved != null ? String(saved) : null)
}

const sidebarWidth = ref(loadSavedWidth())
const resizing = ref(false)
let resizeStartX = 0
let resizeStartWidth = DEFAULT_WIDTH
let previousCursor = ''
let previousUserSelect = ''

const conversations = computed(() => groupSessionsIntoConversations(props.sessions, language.value))
const activeRootId = computed(() => activeConversationRootId(props.sessions, props.activeId))

const groupedConversations = computed(() => {
  const today: Conversation[] = []
  const earlier: Conversation[] = []
  const now = new Date()
  for (const conversation of conversations.value) {
    const date = conversation.time ? new Date(conversation.time) : null
    if (date && date.toDateString() === now.toDateString()) today.push(conversation)
    else earlier.push(conversation)
  }
  const groups: Array<{ label: string; items: Conversation[] }> = []
  if (today.length) groups.push({ label: t('conversation.group.today'), items: today })
  if (earlier.length) groups.push({ label: t('conversation.group.earlier'), items: earlier })
  return groups
})

function formatTime(ts: string): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(language.value, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(language.value, { month: 'numeric', day: 'numeric' })
}

function saveWidth(): void {
  workspaceStore.patchLayout({ chatHistoryWidth: sidebarWidth.value })
}

function beginResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = sidebarWidth.value
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
  sidebarWidth.value = clampChatHistoryWidth(resizeStartWidth + event.clientX - resizeStartX)
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
  sidebarWidth.value = DEFAULT_WIDTH
  saveWidth()
}

function handleResizeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
  event.preventDefault()
  if (event.key === 'Home') resetWidth()
  else {
    sidebarWidth.value = clampChatHistoryWidth(sidebarWidth.value + (event.key === 'ArrowRight' ? 8 : -8))
    saveWidth()
  }
}

onBeforeUnmount(finishResize)
</script>

<style scoped>
.conv-list {
  position: relative;
  flex: 0 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--app-ink);
}

.conv-list.is-fill {
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
}

.conv-head {
  height: var(--app-page-head-height);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: 1px solid var(--app-border);
}

.conv-new-btn {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--app-ink-soft);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.conv-new-btn:hover {
  background: var(--app-bg-soft);
  color: var(--app-ink);
}

.conv-new-btn .el-icon {
  font-size: 18px;
  color: var(--app-ink-soft);
}

.conv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 22px;
}

.conv-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 28px 8px;
  color: var(--app-ink-muted);
  font-size: 13px;
}

.conv-hint.is-error {
  color: var(--app-danger);
}

.conv-group + .conv-group {
  margin-top: 18px;
}

.conv-group-label {
  padding: 8px 8px 7px;
  color: var(--app-ink-muted);
  font-size: 12px;
}

.conv-item {
  position: relative;
  width: 100%;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 16px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--app-ink-soft);
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.conv-item::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 24px;
  border-radius: 0 3px 3px 0;
  background: transparent;
}

.conv-item:hover {
  background: var(--app-bg-page);
  color: var(--app-ink);
}

.conv-item.active {
  background: var(--app-accent-soft);
  color: var(--app-ink);
}

.conv-item.active::before {
  background: var(--app-accent);
}

.conv-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.conv-item.active .conv-title {
  font-weight: 550;
}

.conv-time {
  flex-shrink: 0;
  color: var(--app-ink-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.conv-delete {
  display: none;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: var(--app-ink-muted);
}

.conv-item:hover .conv-time {
  display: none;
}

.conv-item:hover .conv-delete {
  display: inline-flex;
}

.conv-delete:hover {
  background: var(--app-danger-soft);
  color: var(--app-danger);
}

.conv-resizer {
  position: absolute;
  z-index: 5;
  top: 0;
  right: -5px;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  outline: none;
}

.conv-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: var(--app-border);
  transition: background-color 120ms ease, width 120ms ease;
}

.conv-resizer:hover::after,
.conv-resizer:focus-visible::after,
.conv-list.is-resizing .conv-resizer::after {
  width: 2px;
  background: var(--app-accent);
}
</style>
