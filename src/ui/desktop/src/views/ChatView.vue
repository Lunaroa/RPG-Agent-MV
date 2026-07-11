<template>
  <div class="chat-view" data-ui-id="chat-view">
    <ConversationList
      v-if="view === 'history'"
      data-ui-id="chat-history"
      :sessions="historySessions"
      :active-id="activeSession?.id"
      :loading="historyLoading"
      :error="historyError"
      :resizable="false"
      :show-new-button="false"
      @new-conversation="startNewConversation"
      @select="openConversation"
      @delete="deleteConversation"
    />

    <div
      v-else
      class="chat-pane"
      data-ui-id="chat-pane"
      :class="{ 'is-empty-chat': segments.length === 0 && !isRunning }"
    >
      <header class="chat-header">
        <h1 class="chat-header-title">{{ headerTitle }}</h1>
      </header>

      <div class="chat-pane-body">
        <el-alert
          v-if="preflightBlocker"
          class="preflight-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="preflightBlocker"
        >
          <router-link :to="{ path: '/console', query: { page: 'settings' } }">{{ t('chat.preflight.openSettings') }}</router-link>
        </el-alert>

        <!-- Empty state hero -->
        <div v-if="segments.length === 0 && !isRunning" class="chat-hero">
          <h2 class="hero-title">{{ t('chat.hero.title') }}</h2>
          <p class="hero-sub">{{ t('chat.hero.subtitle') }}</p>
        </div>

        <!-- Transcript -->
        <ChatLog
          v-else
          :session-key="activeSession?.id"
          :segments="segments"
          :running="isRunning"
          :live-markdown-segment-id="liveMarkdownSegmentId"
          :docked-ask-id="activeAsk?.askId"
          :bottom-inset="bottomSlotHeight"
          @approve="handleApprove"
          @revise="handleRevise"
          @reject="handleReject"
          @clarify="handleClarify"
          @multi-choice="handleMultiChoice"
          @action="handleAskAction"
          @event-placement-open="handleEventPlacementOpen"
          @event-placement-orchestrate="handleEventPlacementOrchestrate"
          @event-placement-refresh="handleEventPlacementRefresh"
          @event-placement-send="handleEventPlacementSend"
          @production-board-confirm="handleProductionBoardConfirm"
          @map-selection-existing="handleMapSelectionExisting"
          @map-selection-adjust="handleMapSelectionAdjust"
          @reveal-artifacts="handleRevealArtifacts"
        />
      </div>

      <div
        ref="bottomSlotRef"
        class="chat-bottom-slot"
        :class="{
          'has-ask': !!activeAsk,
          'is-empty': segments.length === 0 && !isRunning && !activeAsk,
        }"
      >
        <!-- Active ASK replaces the composer so there is only one input entry. -->
        <div v-if="activeAsk" class="ask-dock">
          <AskCard
            :ask="activeAsk"
            @approve="handleApprove"
            @revise="handleRevise"
            @reject="handleReject"
            @clarify="handleClarify"
            @multi-choice="handleMultiChoice"
            @action="handleAskAction"
            @event-placement-open="handleEventPlacementOpen"
            @event-placement-orchestrate="handleEventPlacementOrchestrate"
            @event-placement-refresh="handleEventPlacementRefresh"
            @event-placement-send="handleEventPlacementSend"
            @production-board-confirm="handleProductionBoardConfirm"
            @map-selection-existing="handleMapSelectionExisting"
            @map-selection-adjust="handleMapSelectionAdjust"
          />
        </div>

        <ComposerHintBar
          v-if="composerHint"
          :text="composerHint"
          :variant="composerHintVariant"
        />

        <ChatComposer
          v-if="!activeAsk"
          v-model="inputMsg"
          :is-running="isRunning"
          :available-providers="availableProviders"
          v-model:selected-provider="selectedProvider"
          v-model:selected-model="selectedModel"
          v-model:thinking-level="thinkingLevel"
          v-model:plan-mode="planMode"
          :slash-commands="slashCommands"
          :context-percent="contextUsage?.contextPercent ?? null"
          :context-used-tokens="contextUsage?.contextUsedTokens ?? null"
          :context-window-tokens="contextUsage?.contextWindowTokens ?? null"
          @send="sendMessage"
          @stop="handleStop"
          @select-profile="onSelectProfile"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSession } from '../composables/useSession'
import type { Session } from '../composables/useSession'
import {
  useSessionStream,
  registerTranscriptPersister,
  registerEventReviewPreviewListener,
  collectEventPreviewItemsFromSegments,
  type EventPreviewItem,
} from '../composables/useSessionStream'
import { DEFAULT_AGENT_EXECUTION_ENGINE } from '@contract/types'
import { extractChatLogSegments, loadPersistedSegmentsFromChain, shouldPersistChatLog } from '@contract/session-transcript'
import { useEventPlacementAskStore, type PlacementListEvent } from '../stores/eventPlacementAsk'
import { useTaskBoardStore } from '../stores/taskBoard'
import { useSessionPlanStore } from '../stores/sessionPlan'
import { useSubagentStore } from '../stores/subagents'
import { allPlacementEventsPlaced, isPlacedStatus, isPlacementEventDone } from '../utils/placementStatus'
import { asksSharePlacementContracts, resolvePlacementSubmitAsk } from '../utils/placementAsk'
import { resolvePlacementQueueDecision } from '../utils/placementQueueAskDecision'
import {
  buildPlacementReviewAnswers,
  formatPlacementReviewContinuationIntent,
  placementReviewDecision,
  summarizePlacementReviewActions,
  type PlacementReviewAction,
  type PlacementReviewDecision,
} from '../utils/placementReviewResult'
import {
  resolveAskContextMapId,
  resolveEventMapIdWithAsk,
  resolveRegistryContractMapId,
} from '../utils/placementMapId'
import { isAskResultLocked, type Ask, type AskResult } from '../utils/askParser'
import {
  eventRegistry,
  sessions as sessionsApi,
  type ContextUsageSnapshot,
  type SlashCommandListItem,
} from '../api/client'
import {
  activeConversationRootId,
  groupSessionsIntoConversations,
  titleForSession,
  type Conversation,
} from '../utils/conversationGroups'
import { useSettingsStore } from '../stores/settings'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import {
  loadEngineChatSelection,
  resetStoredThinkingLevel,
  resolveChatModelSelection,
  toChatProviderOptions,
} from '../utils/chatProviderOptions'
import { profileIdFromBinding } from '../utils/profile-id'
import { canSubmitChatMessage, isSendDebounced } from '../utils/chatSendGuard'
import { parseSlashSubmit } from '../utils/chatSlashInput'
import {
  approveIntent,
  buildPlanModePrefix,
  clarifyIntent,
  feedbackIntent,
  formatPlacementResultIntent,
  mapSelectionAdjustStoryPrompt,
  mapSelectionUseExistingPrompt,
  multiChoiceIntent,
  placementAllPlacedFollowUp,
  placementPartialFollowUp,
  productionBoardConfirmedPrompt,
} from '../utils/agentIntent'
import type { SessionRuntimeEvent } from '../api/client'
import ChatComposer from '../components/ChatComposer.vue'
import ComposerHintBar from '../components/ComposerHintBar.vue'
import ChatLog from '../components/ChatLog.vue'
import AskCard from '../components/AskCard.vue'
import ConversationList from '../components/ConversationList.vue'
import { useWorkbenchUiStore } from '../stores/workbenchUi'
import { normalizeProductLanguage, useI18n } from '../i18n'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'

const props = withDefaults(defineProps<{
  view?: 'chat' | 'history'
}>(), {
  view: 'chat',
})

const emit = defineEmits<{
  'conversation-selected': []
  'conversation-created': []
}>()

const settingsStore = useSettingsStore()
const workbenchUi = useWorkbenchUiStore()
const projectStore = useProjectStore()
const workspaceStore = useWorkspaceStore()

const {
  activeSession,
  isRunning,
  createSession,
  stopSession,
  updateStatus,
  refreshActiveSession,
  newConversation
} = useSession()

const {
  segments,
  currentStatus,
  isStreaming,
  liveMarkdownSegmentId,
  summaryRevision,
  attachToSession,
  detachFromSession,
  resetState,
  appendUserSegment,
  appendSlashStatusSegment,
  restoreSegments,
  replaySessionEvents,
  setProductLanguage,
  updateAskResult,
  patchAsk,
  getAsk,
} = useSessionStream()

const router = useRouter()
const route = useRoute()
const eventPlacementAsk = useEventPlacementAskStore()
const taskBoard = useTaskBoardStore()
const sessionPlan = useSessionPlanStore()
const subagents = useSubagentStore()
const { t } = useI18n()

const TERMINAL = ['pass', 'blocked', 'failed', 'error', 'stopped', 'interrupted', 'timeout']
const currentProductLanguage = computed(() => normalizeProductLanguage(settingsStore.ui.language))

watch(currentProductLanguage, (language) => {
  setProductLanguage(language)
}, { immediate: true })


function formatErrorText(errorValue: unknown, fallback?: string): string {
  const resolvedFallback = fallback || t('chat.op.failed')
  return formatUserFacingErrorMessage(errorValue || resolvedFallback, 'general', currentProductLanguage.value)
}

// Agent / 思考档与模型选择写入 workspace（SQLite）。
const savedComposerPrefs = workspaceStore.settings.composer || {}

const inputMsg = ref('')
const slashCommands = ref<SlashCommandListItem[]>([])
const composerHint = ref('')
const composerHintVariant = ref<'info' | 'error'>('info')
const contextUsage = ref<ContextUsageSnapshot | null>(null)
let contextUsageRequestId = 0
const sendInFlight = ref(false)
let lastSendAtMs = 0

const composerBusy = computed(() => isRunning.value || sendInFlight.value)
const bottomSlotRef = ref<HTMLElement | null>(null)
const bottomSlotHeight = ref(172)
let bottomSlotObserver: ResizeObserver | null = null

function measureBottomSlot(): void {
  const element = bottomSlotRef.value
  if (!element) return
  bottomSlotHeight.value = Math.max(120, Math.ceil(element.getBoundingClientRect().height))
}

function observeBottomSlot(element: HTMLElement | null): void {
  bottomSlotObserver?.disconnect()
  if (element) bottomSlotObserver?.observe(element)
  measureBottomSlot()
}

// 当前待回答的 ASK：转录里最后一个尚未提交的 ASK 段，停靠在输入框上方。
// 已提交的历史 ASK 仍留在转录中作为记录。
const activeAsk = computed<Ask | null>(() => {
  const list = segments.value
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const seg = list[i]
    if (seg.type === 'ask' && seg.ask && !isAskResultLocked(seg.ask.result)) {
      return seg.ask
    }
  }
  return null
})
watch(activeAsk, (ask) => {
  if (!ask) return
  workbenchUi.setAgentPanelOpen(true)
  if (eventPlacementAsk.isReviewMode && !eventPlacementAsk.reviewAskId) {
    eventPlacementAsk.bindReviewAsk(ask.askId)
  }
})

watch(
  () => sessionPlan.planFor(activeSession.value?.id)?.mode,
  (mode) => {
    if (mode === 'approval_requested' || mode === 'planning') workbenchUi.openSidePanel('plan')
  },
)

const activePlanFilePath = computed(() => {
  const sessionId = activeSession.value?.id
  if (!sessionId) return ''
  const rootId = activeConversationRootId(historySessions.value, sessionId)
  const stored = sessionPlan.planFor(sessionId)?.filePath?.trim()
    || (rootId ? sessionPlan.planFor(rootId)?.filePath?.trim() : '')
  if (stored) return stored
  const anchorId = rootId || sessionId
  return `.opencode/plans/conversations/${anchorId}.md`
})

watch(
  bottomSlotRef,
  (element) => observeBottomSlot(element),
  { flush: 'post' },
)

watch(
  [activeAsk, inputMsg, isRunning],
  () => { void nextTick(measureBottomSlot) },
  { flush: 'post' },
)

const selectedProvider = ref('')
const selectedModel = ref('')
const thinkingLevel = ref(savedComposerPrefs.thinkingLevel || 'default')
const planMode = ref(false)
const historySessions = ref<Session[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const preflightBlocker = ref<string | null>(null)
const availableProviders = ref<Array<{ id: string; label: string; models: Array<{ id: string; label: string }> }>>([])

const headerTitle = computed(() => titleForSession(historySessions.value, activeSession.value?.id, currentProductLanguage.value))

watch(currentStatus, (newStatus) => {
  // 空状态由 resetState 触发（新建对话/加载历史），不覆盖显式设置的会话状态。
  if (!newStatus) return
  updateStatus(newStatus)
  // 每轮终态：把累积转录持久化到链尾会话，并刷新历史列表。
  if (TERMINAL.includes(newStatus) && activeSession.value) {
    persistTranscript()
    void refreshPlacementQueueFromRegistry()
    void taskBoard.loadFromBackend(activeSession.value.id)
    void sessionPlan.loadFromBackend(activeSession.value.id)
    void subagents.loadFromBackend(activeSession.value.id)
    void refreshContextUsage(activeSession.value.id)
  }
})

watch(
  () => activeSession.value?.id,
  (sessionId) => {
    void refreshContextUsage(sessionId ?? null)
  },
  { immediate: true },
)

// summary 在终态之后到达；再次保存可把 artifact 和结果摘要一起落盘。
watch(summaryRevision, () => {
  if (activeSession.value) persistTranscript()
})

// 顶部选择变化即落盘，下次进对话恢复。
watch(() => settingsStore.agentExecution.engine, async () => {
  await settingsStore.loadAgentExecution()
  await loadProviders()
  await runPreflightCheck()
})

watch([selectedProvider, selectedModel, thinkingLevel], () => {
  void runPreflightCheck()
  const engine = settingsStore.agentExecution.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  const selection = selectedProvider.value && selectedModel.value
    ? {
        providerId: selectedProvider.value,
        modelId: selectedModel.value,
      }
    : undefined
  void workspaceStore.patchComposer({
    thinkingLevel: thinkingLevel.value,
    engine,
    selection,
  })
})

watch(
  () => route.name,
  (name) => {
    if (name !== 'chat') return
    void resumeChatView()
  },
)

const LIVE_SESSION_STATUSES = ['created', 'preparing', 'starting', 'running']

let persistTimer: ReturnType<typeof setTimeout> | null = null
let loadHistoryGeneration = 0

async function persistTranscript(): Promise<void> {
  if (!activeSession.value) return
  if (!shouldPersistChatLog(segments.value.length)) return
  try {
    await sessionsApi.saveChatLog(activeSession.value.id, {
      segments: JSON.parse(JSON.stringify(segments.value))
    })
  } catch (error) {
    console.error('Failed to save chat log:', error)
  }
  await loadHistory()
}

function schedulePersistTranscript(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistTranscript()
  }, 250)
}

async function flushPersistTranscript(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  await persistTranscript()
}

function buildPlanModePrefixForSend(): string {
  if (!planMode.value) return ''
  return buildPlanModePrefix(activePlanFilePath.value.trim())
}

async function loadSlashCommands(): Promise<void> {
  try {
    slashCommands.value = await sessionsApi.listSlashCommands()
  } catch (error) {
    console.error('Failed to load slash commands:', error)
    slashCommands.value = []
  }
}

async function refreshContextUsage(sessionId?: string | null): Promise<void> {
  const id = sessionId ?? activeSession.value?.id
  if (!id) {
    contextUsage.value = null
    return
  }

  const requestId = ++contextUsageRequestId
  try {
    const result = await sessionsApi.getContextUsage(id)
    if (requestId !== contextUsageRequestId) return
    if (result.ok) {
      contextUsage.value = result.data
      return
    }
    // New / unbound sessions have no opencode context yet — show empty ring, not a stale value.
    if (result.messageKey === 'slash.tokens.noSession' || result.messageKey === 'slash.tokens.noModel') {
      contextUsage.value = null
      return
    }
    // Other failures: keep last good snapshot; do not invent a percent.
    console.warn('Failed to refresh context usage:', result.message)
  } catch (error) {
    if (requestId !== contextUsageRequestId) return
    console.warn('Failed to refresh context usage:', error)
  }
}

async function handleSlashCommand(command: string, args = ''): Promise<void> {
  const sessionId = activeSession.value?.id
  if (!sessionId) {
    composerHintVariant.value = 'error'
    composerHint.value = t('slash.noActiveSession')
    return
  }

  try {
    const result = await sessionsApi.slashCommand(sessionId, command, args)
    if (result.display === 'composer_hint') {
      if (result.ok && result.messageKey === 'slash.tokens.summary') {
        if (
          result.data
          && result.data.contextUsedTokens !== undefined
          && result.data.contextWindowTokens !== undefined
          && result.data.contextPercent !== undefined
        ) {
          contextUsage.value = {
            contextUsedTokens: result.data.contextUsedTokens,
            contextWindowTokens: result.data.contextWindowTokens,
            contextPercent: result.data.contextPercent,
          }
        } else {
          await refreshContextUsage(sessionId)
        }
        composerHint.value = ''
        return
      }
      composerHintVariant.value = result.ok ? 'info' : 'error'
      composerHint.value = result.message
      return
    }
    appendSlashStatusSegment(result.message, result.ok)
    if (command === 'compact' && result.ok) {
      void refreshContextUsage(sessionId)
    }
    void schedulePersistTranscript()
  } catch (error) {
    composerHintVariant.value = 'error'
    composerHint.value = formatErrorText(error)
  }
}

async function sendMessage() {
  const trimmed = inputMsg.value.trim()
  if (!trimmed) return

  const parsed = parseSlashSubmit(trimmed)
  if (parsed.kind === 'slash') {
    inputMsg.value = ''
    await handleSlashCommand(parsed.command, parsed.args)
    return
  }

  if (!canSubmitChatMessage(trimmed, composerBusy.value)) return
  const nowMs = Date.now()
  if (isSendDebounced(lastSendAtMs, nowMs)) return
  lastSendAtMs = nowMs

  const intent = trimmed
  const planModePrefix = buildPlanModePrefixForSend()

  try {
    await runIntent(`${planModePrefix}${intent}`, intent)
    inputMsg.value = ''
  } catch (error) {
    console.error('Failed to create session:', error)
  }
}

// 跑一轮：链尾会话作为 continuationOf 串接同一对话（优先复用 opencode 会话；必要时保留转录）。
// 首轮 continuationOf 为空（fresh），续接轮保留既有转录并追加。
function buildChatSessionModelPayload(): {
  profileId: string
  providerId?: string
  modelId?: string
} {
  if (selectedProvider.value && selectedModel.value) {
    return {
      profileId: profileIdFromBinding(selectedProvider.value, selectedModel.value),
      providerId: selectedProvider.value,
      modelId: selectedModel.value,
    }
  }
  return { profileId: selectedProvider.value || 'default' }
}

function hasSelectedAvailableModel(): boolean {
  const provider = availableProviders.value.find((p) => p.id === selectedProvider.value)
  return Boolean(provider?.models.some((m) => m.id === selectedModel.value))
}

async function runPreflightCheck(): Promise<boolean> {
  if (!hasSelectedAvailableModel()) {
    preflightBlocker.value = null
    return false
  }

  const executionEngine = settingsStore.agentExecution.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  const modelPayload = buildChatSessionModelPayload()
  try {
    const preview = await sessionsApi.preview({
      ...modelPayload,
      executionEngine,
      productLanguage: currentProductLanguage.value,
      intent: t('chat.preflight.title'),
      project: projectStore.currentProject,
    }) as { status?: string; blocker?: string | null }
    if (preview.status === 'blocked' && preview.blocker) {
      preflightBlocker.value = formatErrorText(preview.blocker)
      return false
    }
    preflightBlocker.value = null
    return true
  } catch (error) {
    preflightBlocker.value = formatErrorText(error, t('chat.preflight.failed'))
    return false
  }
}

async function runIntent(
  intent: string,
  displayText: string,
  options: { userMetadata?: Record<string, unknown> } = {},
): Promise<void> {
  if (composerBusy.value) return
  sendInFlight.value = true
  try {
    const modelPayload = buildChatSessionModelPayload()

    const parentId = activeSession.value?.id
    if (parentId) await flushPersistTranscript()
    const continuationOf = parentId
    const fresh = !continuationOf

    const executionEngine = settingsStore.agentExecution.engine || DEFAULT_AGENT_EXECUTION_ENGINE

    const ok = await runPreflightCheck()
    if (!ok) return

    const session = await createSession({
      ...modelPayload,
      executionEngine,
      productLanguage: currentProductLanguage.value,
      project: projectStore.currentProject,
      intent,
      displayText,
      continuationOf,
      thinkingLevel: thinkingLevel.value,
      timeoutMs: 1800000
    })
    await attachToSession(session.id, { fresh })
    // 在重置之后、实时事件到达之前推入用户气泡，保证它排在本轮 agent 输出前面。
    appendUserSegment(displayText, options.userMetadata)
  } finally {
    sendInFlight.value = false
  }
}

// Submit an ASK result. MCP-driven asks resolve the blocked tool in the
// running session; text-block asks (turn already finished) continue via a
// new session carrying a formatted intent.
async function submitAsk(askId: string, result: AskResult, continuation: { intent: string; displayText: string }): Promise<boolean> {
  const ask = getAsk(askId)
  if (!ask || isAskResultLocked(ask.result)) return false
  const prior = { ...(ask.result || {}) }
  const finalResult: AskResult = { ...prior, ...result, submittedAt: new Date().toISOString() }
  try {
    if (ask.fromMcp && activeSession.value) {
      // placement-review 的 actions / answers 等字段可能嵌套引用 Vue reactive
      // proxy（来自 store ref），浅合并后仍指向 proxy。Electron IPC 用
      // structuredClone 传输，reactive proxy 不可克隆会抛
      // "An object could not be cloned"。这里用 JSON 深拷贝脱壳成纯对象，
      // 给所有 ASK 提交兜底。AskResult 只含 JSON 可表达数据，JSON 拷贝安全。
      const ipcResult = JSON.parse(JSON.stringify(finalResult)) as AskResult
      const response = await sessionsApi.submitAskResult(activeSession.value.id, askId, ipcResult) as {
        ok?: boolean
        reason?: string
      }
      if (response && response.ok === false) {
        throw new Error(response.reason || t('chat.ask.notWaiting'))
      }
    } else {
      await runIntent(continuation.intent, continuation.displayText, { userMetadata: { sourceAskId: askId } })
    }
    const submittedAsk = getAsk(askId) || ask
    if (result.placed && submittedAsk?.type === 'event-placement-list') {
      for (const segment of segments.value) {
        const related = segment.ask
        if (segment.type !== 'ask' || !related) continue
        if (related.type !== 'event-placement-list') continue
        if (!asksSharePlacementContracts(submittedAsk, related)) continue
        updateAskResult(related.askId, finalResult)
      }
    } else {
      updateAskResult(askId, finalResult)
    }
    await flushPersistTranscript()
    return true
  } catch (error) {
    console.error('Failed to submit ASK result:', error)
    const message = formatErrorText(error, t('chat.ask.retry'))
    if (ask.fromMcp) {
      updateAskResult(askId, {
        ...prior,
        ...result,
        failedAt: new Date().toISOString(),
        error: message,
      })
      await flushPersistTranscript()
    }
    ElMessage.error(t('chat.ask.submitFailed', { message }))
    return false
  }
}

function buildReviewEvents(events: EventPreviewItem[]): PlacementListEvent[] {
  return events.map((event) => ({
    contractId: event.contractId,
    eventName: event.eventName || event.contractId,
    sceneId: event.sceneId,
    targetMapId: event.targetMapId ?? null,
    placementHint: event.placementHint,
    summary: event.summary,
    trigger: event.trigger,
    status: 'reviewing',
  }))
}

function handleRegisteredEventPreview(events: EventPreviewItem[]): void {
  if (!events.length) return
  eventPlacementAsk.startReviewSession(buildReviewEvents(events), {
    sessionId: activeSession.value?.id || 'live',
    project: projectStore.currentProject,
  })
  if (activeAsk.value && !eventPlacementAsk.reviewAskId) {
    eventPlacementAsk.bindReviewAsk(activeAsk.value.askId)
  }
  workbenchUi.openSidePanel('placement')
}

function hydrateReviewPreviewFromTranscript(saved?: Array<{ type?: string; metadata?: Record<string, unknown> }>): void {
  const source = saved?.length ? saved : segments.value
  const previews = collectEventPreviewItemsFromSegments(source as never)
  if (!previews.length) return
  if (eventPlacementAsk.isReviewMode && eventPlacementAsk.reviewingCount > 0) return
  handleRegisteredEventPreview(previews)
}

function makePlacementReviewAction(
  askId: string,
  event: PlacementListEvent,
  decision: PlacementReviewDecision,
  feedback = '',
): PlacementReviewAction {
  return {
    askId,
    contractId: event.contractId,
    eventName: event.eventName || event.contractId,
    decision,
    feedback: feedback.trim() || undefined,
    targetMapId: event.targetMapId ?? null,
    summary: event.summary,
    decidedAt: new Date().toISOString(),
  }
}

async function settlePendingEventReviewForAsk(
  askId: string,
  decision: PlacementReviewDecision,
  feedback = '',
): Promise<PlacementReviewAction[]> {
  if (!eventPlacementAsk.isReviewMode || eventPlacementAsk.reviewAskId !== askId) return []
  const reviewing = eventPlacementAsk.sessionEvents.filter((event) => event.status === 'reviewing')
  if (!reviewing.length) return eventPlacementAsk.reviewActionsForAsk(askId)
  const actions: PlacementReviewAction[] = []
  for (const event of reviewing) {
    if (decision === 'approve') {
      const result = await eventRegistry.approve(projectStore.currentProject, event.contractId)
      if (result.status !== 'ok') {
        throw new Error(t('chat.event.approveFailed', { name: event.eventName || event.contractId }))
      }
      const action = makePlacementReviewAction(askId, event, 'approve')
      eventPlacementAsk.recordReviewAction(action)
      actions.push(action)
      await eventPlacementAsk.markReviewEventApproved(event.contractId, projectStore.currentProject)
      continue
    }
    const reason = decision === 'revise'
      ? (feedback.trim()
          ? t('chat.event.userRevised', { feedback: feedback.trim() })
          : t('chat.event.userRevisedGeneric'))
      : t('chat.event.userCanceled')
    const result = await eventRegistry.reject(projectStore.currentProject, event.contractId, { reason })
    if (result.status !== 'ok') {
      throw new Error(
        decision === 'revise'
          ? t('chat.event.reviseFailed', { name: event.eventName || event.contractId })
          : t('chat.event.cancelFailed', { name: event.eventName || event.contractId }),
      )
    }
    const action = makePlacementReviewAction(askId, event, decision, decision === 'revise' ? feedback : '')
    eventPlacementAsk.recordReviewAction(action)
    actions.push(action)
    await eventPlacementAsk.markReviewEventRejected(event.contractId, projectStore.currentProject)
  }
  return eventPlacementAsk.reviewActionsForAsk(askId)
}

// 通用高危操作审批卡（risk-approval）：走和 plan-approval 相同的 submitAsk 通道。
// askId 以 agent-runtime-plan: 开头 → submitAskResult → submitOpencodeAskResult → replyOpencodePermission。
// 批准 = "once"（允许本次），拒绝 = "reject"（阻止工具执行）。
// 工具执行后 handler 落盘 pending 提议并立即返回，useSessionStream 在 tool_result 到达时自动 approveProposal 运行工作流。

async function handleApprove(askId: string) {
  const ask = getAsk(askId)
  if (!ask) return
  if (ask.type === 'risk-approval') {
    await submitAsk(askId, { decision: 'approve' }, {
      intent: '',
      displayText: t('ask.riskApproval.statusApproved'),
    })
    return
  }
  try {
    await settlePendingEventReviewForAsk(askId, 'approve')
  } catch (error) {
    ElMessage.error(formatErrorText(error, t('chat.event.approveFailedGeneric')))
    return
  }
  await submitAsk(askId, { decision: 'approve' }, {
    intent: approveIntent(ask),
    displayText: t('chat.plan.approved')
  })
}

async function handleRevise(askId: string, feedback: string) {
  const ask = getAsk(askId)
  if (!ask) return
  await submitAsk(askId, { decision: 'revise', feedback }, {
    intent: feedbackIntent(ask, 'revise', feedback),
    displayText: t('chat.plan.revised', { feedback })
  })
}

async function handleReject(askId: string, feedback: string) {
  const ask = getAsk(askId)
  if (!ask) return
  if (ask.type === 'risk-approval') {
    await submitAsk(askId, { decision: 'reject' }, {
      intent: '',
      displayText: t('ask.riskApproval.statusRejected'),
    })
    return
  }
  await submitAsk(askId, { decision: 'reject', feedback }, {
    intent: feedbackIntent(ask, 'reject', feedback),
    displayText: t('chat.plan.rejected')
  })
}

async function handleClarify(
  askId: string,
  payload: { answer: string; selected?: string[]; other?: string }
) {
  const ask = getAsk(askId)
  if (!ask) return
  const result: AskResult = { answer: payload.answer }
  if (payload.selected?.length) {
    result.selected = payload.selected
    result.other = payload.other || ''
  }
  await submitAsk(askId, result, {
    intent: clarifyIntent(ask, payload),
    displayText: t('chat.ask.answered', { answer: payload.answer })
  })
}

function answerForQuestion(
  answers: Record<string, { selected: string[]; other: string }>,
  question: { id?: string; question?: string; header?: string },
) {
  return (question.id ? answers[question.id] : undefined)
    || (question.question ? answers[question.question] : undefined)
    || (question.header ? answers[question.header] : undefined)
    || null
}

function normalizeMultiChoiceAnswers(
  ask: Ask,
  answers: Record<string, { selected: string[]; other: string }>,
): Record<string, { selected: string[]; other: string }> {
  const normalized = { ...answers }
  for (const question of ask.questions || []) {
    const answer = answerForQuestion(normalized, question)
    if (!answer) continue
    if (question.id) normalized[question.id] = answer
    if (question.question) normalized[question.question] = answer
    if (question.header) normalized[question.header] = answer
  }
  return normalized
}

function placementReviewFeedbackFromAnswers(
  ask: Ask,
  answers: Record<string, { selected: string[]; other: string }>,
): string {
  for (const question of ask.questions || []) {
    const text = `${question.header || ''} ${question.question || ''} ${question.id || ''}`
    if (!/应用到待放置队列|待放置队列|待放置事件|pending placement queue|pending placement event|placement queue/i.test(text)) continue
    return answerForQuestion(answers, question)?.other?.trim() || ''
  }
  return ''
}

async function submitPlacementReviewResult(
  askId: string,
  actions: PlacementReviewAction[],
  options: {
    answers?: Record<string, { selected: string[]; other: string }>
    overallFeedback?: string
  } = {},
): Promise<boolean> {
  const ask = getAsk(askId)
  if (!ask || !actions.length) return false
  const overallFeedback = options.overallFeedback?.trim() || ''
  const answers = {
    ...(options.answers ? normalizeMultiChoiceAnswers(ask, options.answers) : {}),
    ...buildPlacementReviewAnswers(ask, actions, overallFeedback, currentProductLanguage.value),
  }
  const summary = summarizePlacementReviewActions(actions, currentProductLanguage.value)
  return submitAsk(askId, {
    decision: placementReviewDecision(actions),
    answers,
    placementReview: {
      actions,
      overallFeedback: overallFeedback || null,
      completedAt: new Date().toISOString(),
    },
  }, {
    intent: formatPlacementReviewContinuationIntent(ask, actions, overallFeedback, currentProductLanguage.value),
    displayText: t('chat.event.placementProcessed', { summary }),
  })
}

async function handleMultiChoice(askId: string, answers: Record<string, { selected: string[]; other: string }>) {
  const ask = getAsk(askId)
  if (!ask) return
  const normalizedAnswers = normalizeMultiChoiceAnswers(ask, answers)
  const placementDecision = resolvePlacementQueueDecision(ask, normalizedAnswers)
  if (placementDecision) {
    if (placementReviewSubmittingAskIds.has(askId)) return
    placementReviewSubmittingAskIds.add(askId)
    const cardDecision: PlacementReviewDecision = placementDecision === 'apply'
      ? 'approve'
      : placementDecision === 'cancel'
        ? 'reject'
        : 'revise'
    const overallFeedback = placementReviewFeedbackFromAnswers(ask, normalizedAnswers)
    try {
      const storedActions = eventPlacementAsk.reviewActionsForAsk(askId)
      const reviewing = eventPlacementAsk.sessionEvents.filter((event) => event.status === 'reviewing')
      const hasSideApprovedEvents = eventPlacementAsk.sessionEvents.some((event) => (
        event.status !== 'reviewing' && eventPlacementAsk.decisionFor(event.contractId) === 'approve'
      ))
      if (eventPlacementAsk.reviewAskId !== askId && !storedActions.length && !hasSideApprovedEvents) return
      if (!reviewing.length && !storedActions.length && !hasSideApprovedEvents) return
      // 从已暂存的侧栏操作开始（如逐条确认的 approve），追加卡片处理的操作。
      // 提交时带上完整 actions，让 Agent 看到全部决策画面。
      const actions: PlacementReviewAction[] = [...storedActions]
      const actionContractIds = new Set(actions.map((action) => action.contractId))
      for (const event of eventPlacementAsk.sessionEvents) {
        if (actionContractIds.has(event.contractId)) continue
        if (event.status === 'reviewing') continue
        if (eventPlacementAsk.decisionFor(event.contractId) !== 'approve') continue
        const action = makePlacementReviewAction(askId, event, 'approve')
        eventPlacementAsk.recordReviewAction(action)
        actions.push(action)
        actionContractIds.add(event.contractId)
      }
      for (const event of reviewing) {
        const storedDecision = eventPlacementAsk.decisionFor(event.contractId)
        const decision = storedDecision || cardDecision
        const feedback = decision === 'revise'
          ? (eventPlacementAsk.feedbackFor(event.contractId) || overallFeedback)
          : ''
        if (decision === 'approve') {
          const result = await eventRegistry.approve(projectStore.currentProject, event.contractId)
          if (result.status !== 'ok') {
            throw new Error(t('chat.event.approveFailed', { name: event.eventName || event.contractId }))
          }
        } else {
          const reason = decision === 'revise'
            ? (feedback.trim()
                ? t('chat.event.userRevised', { feedback: feedback.trim() })
                : t('chat.event.userRevisedGeneric'))
            : t('chat.event.userCanceled')
          const result = await eventRegistry.reject(projectStore.currentProject, event.contractId, { reason })
          if (result.status !== 'ok') {
            throw new Error(
              decision === 'revise'
                ? t('chat.event.reviseFailed', { name: event.eventName || event.contractId })
                : t('chat.event.cancelFailed', { name: event.eventName || event.contractId }),
            )
          }
        }
        const action = makePlacementReviewAction(askId, event, decision, feedback)
        eventPlacementAsk.recordReviewAction(action)
        actions.push(action)
        await (decision === 'approve'
          ? eventPlacementAsk.markReviewEventApproved(event.contractId, projectStore.currentProject)
          : eventPlacementAsk.markReviewEventRejected(event.contractId, projectStore.currentProject))
      }
      if (actions.length) {
        const ok = await submitPlacementReviewResult(askId, actions, {
          answers: normalizedAnswers,
          overallFeedback,
        })
        if (ok) {
          eventPlacementAsk.clearPendingDecisions()
          eventPlacementAsk.clearCompletedReviewBatch(askId)
        }
      }
    } catch (error) {
      ElMessage.error(formatErrorText(error, t('chat.event.processFailed')))
      return
    } finally {
      placementReviewSubmittingAskIds.delete(askId)
    }
    return
  }
  await submitAsk(askId, { answers: normalizedAnswers }, {
    intent: multiChoiceIntent(ask, normalizedAnswers),
    displayText: t('chat.ask.clarificationSubmitted')
  })
}

function handleAskAction(askId: string) {
  const ask = getAsk(askId)
  if (!ask) return
  ElMessage.warning(t('chat.ask.unsupported', { type: ask.type }))
}

function findPlacementEvent(ask: Ask, contractId: string): Record<string, unknown> | null {
  const events = (ask.events || []) as Array<Record<string, unknown>>
  return events.find((e) => e.contractId === contractId || e.id === contractId) || null
}

function buildPlacementListFromAsk(ask: Ask) {
  const askContext = { title: ask.title, prompt: ask.prompt }
  return ((ask.events || []) as Array<Record<string, unknown>>).map((row) => ({
    contractId: String(row.contractId || row.id),
    eventName: String(row.eventName || row.contractId || row.id),
    sceneId: row.sceneId ? String(row.sceneId) : undefined,
    targetMapId: resolveEventMapIdWithAsk(row, askContext),
    placementHint: row.placementHint ? String(row.placementHint) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
    trigger: row.trigger ? String(row.trigger) : undefined,
    status: row.status ? String(row.status) : undefined,
    placedEventId: row.placedEventId == null ? null : Number(row.placedEventId) || null,
    x: Number.isInteger(row.x) ? (row.x as number) : null,
    y: Number.isInteger(row.y) ? (row.y as number) : null,
  }))
}

const latestPlacementAsk = computed(() => {
  for (let index = segments.value.length - 1; index >= 0; index -= 1) {
    const ask = segments.value[index]?.ask
    if (ask?.type === 'event-placement-list') return ask
  }
  return null
})

const placementReviewSubmittingAskIds = new Set<string>()

watch(
  latestPlacementAsk,
  (ask) => {
    if (!ask?.events?.length) return
    eventPlacementAsk.syncEventsFromAsk(buildPlacementListFromAsk(ask), {
      askId: ask.askId,
      sessionId: activeSession.value?.id || 'recovery',
      project: projectStore.currentProject,
    })
  },
  { deep: true, immediate: true },
)

async function refreshPlacementQueueFromRegistry(): Promise<void> {
  try {
    await eventPlacementAsk.refreshFromRegistry(projectStore.currentProject)
  } catch (error) {
    console.error('[event-placement] automatic registry refresh failed', error)
    const message = formatErrorText(error, t('chat.refresh.failed'))
    ElMessage.error(t('chat.refresh.placementFailed', { message }))
  }
}

function resolvePlacementEditorTarget(
  listEvents: ReturnType<typeof buildPlacementListFromAsk>,
  options: { contractId?: string } = {},
) {
  const pending = listEvents.filter((e) => !isPlacedStatus(e.status))
  const contractId = options.contractId
    || pending[0]?.contractId
    || listEvents[0]?.contractId
    || null
  return { contractId }
}

async function openPlacementEditor(
  askId: string,
  options: { mapId?: number; contractId?: string } = {},
) {
  const ask = getAsk(askId)
  if (!ask) {
    console.warn('[event-placement] ASK not found in transcript', { askId })
    ElMessage.warning(t('chat.placement.askNotFound'))
    return
  }
  if (ask.type !== 'event-placement-list') {
    console.warn('[event-placement] wrong ask type', { askId, type: ask.type })
    ElMessage.warning(t('chat.placement.unsupportedType', { type: ask.type }))
    return
  }
  const chatSessionId = activeSession.value?.id
  if (!chatSessionId) {
    console.warn('[event-placement] no active chat session', { askId })
    ElMessage.warning(t('chat.placement.noSession'))
    return
  }
  const listEvents = buildPlacementListFromAsk(ask)
  const { contractId } = resolvePlacementEditorTarget(listEvents, options)
  if (!contractId) {
    ElMessage.warning(t('chat.placement.emptyList'))
    return
  }
  try {
    eventPlacementAsk.startPlacementSession(askId, listEvents, {
      sessionId: chatSessionId,
      contractId,
    })
    const query: Record<string, string> = {}
    if (Number.isInteger(options.mapId) && Number(options.mapId) > 0) {
      query.mapId = String(options.mapId)
    }
    void router.push({ path: '/workbench', query })
  } catch (error) {
    console.error('[event-placement] open editor failed', error)
    const message = formatErrorText(error, t('chat.placement.openFailed'))
    ElMessage.error(t('chat.placement.enterFailed', { message }))
  }
}

async function enrichPlacementMapIdsFromRegistry(askId: string): Promise<void> {
  const ask = getAsk(askId)
  if (!ask || ask.type !== 'event-placement-list') return
  const askContext = { title: ask.title, prompt: ask.prompt }
  const events = (ask.events || []) as Array<Record<string, unknown>>
  if (events.every((event) => resolveEventMapIdWithAsk(event, askContext) != null)) return
  try {
    const payload = await eventRegistry.contracts(projectStore.currentProject, { operation: 'add-map-event' }) as {
      contracts?: Array<Record<string, unknown>>
    }
    const byId = new Map((payload.contracts || []).map((item) => [String(item.id), item]))
    if (!byId.size) return
    const askLevelMapId = resolveAskContextMapId(ask)
    patchAsk(askId, (current) => ({
      ...current,
      events: ((current.events || []) as Array<Record<string, unknown>>).map((event) => {
        if (resolveEventMapIdWithAsk(event, askContext) != null) return event
        const reg = byId.get(String(event.contractId || event.id))
        const regMapId = resolveRegistryContractMapId(reg)
        const targetMapId = regMapId ?? askLevelMapId
        if (targetMapId == null) return event
        return {
          ...event,
          targetMapId,
          mapId: event.mapId ?? reg?.mapId ?? null,
        }
      }),
    }))
  } catch (error) {
    console.warn('[event-placement] registry enrich failed', error)
  }
}

function handleEventPlacementOrchestrate(askId: string) {
  void enrichPlacementMapIdsFromRegistry(askId).then(() => {
    void openPlacementEditor(askId)
  })
}

function handleEventPlacementOpen(askId: string, contractId: string) {
  const ask = getAsk(askId)
  if (!ask || ask.type !== 'event-placement-list') return
  const event = findPlacementEvent(ask, contractId)
  if (!event) return
  void openPlacementEditor(askId, {
    contractId: String(event.contractId || event.id),
  })
}

async function handleEventPlacementRefresh(askId: string) {
  const ask = getAsk(askId)
  if (!ask || ask.type !== 'event-placement-list') return
  try {
    const payload = await eventRegistry.contracts(projectStore.currentProject, { operation: 'add-map-event' }) as {
      contracts?: Array<Record<string, unknown>>
    }
    const byId = new Map((payload.contracts || []).map((item) => [String(item.id), item]))
    if (!byId.size) {
      ElMessage.info(t('chat.registry.disconnected'))
      return
    }
    patchAsk(askId, (current) => ({
      ...current,
      events: ((current.events || []) as Array<Record<string, unknown>>).map((event) => {
        const contractId = String(event.contractId || event.id)
        const reg = byId.get(contractId)
        if (!reg) return event
        const regMapId = resolveRegistryContractMapId(reg)
        return {
          ...event,
          status: String(reg.status || event.status || 'draft'),
          targetMapId: regMapId ?? resolveEventMapIdWithAsk(event, ask) ?? event.targetMapId,
          mapId: event.mapId ?? reg.mapId ?? null,
          placedEventId: reg.eventId ?? event.placedEventId,
          x: Number.isInteger(reg.x) ? reg.x : event.x,
          y: Number.isInteger(reg.y) ? reg.y : event.y,
        }
      }),
    }))
    await eventPlacementAsk.refreshFromRegistry(projectStore.currentProject)
    ElMessage.success(t('chat.placement.refreshed'))
  } catch (error) {
    const message = formatErrorText(error, t('chat.refresh.failed'))
    ElMessage.error(t('chat.placement.refreshFailedMsg', { message }))
  }
}

async function handleEventPlacementSend(askId: string) {
  const visible = getAsk(askId)
  if (!visible || visible.type !== 'event-placement-list') return
  const { askId: submitAskId, ask } = resolvePlacementSubmitAsk(visible, segments.value)
  const ready = allPlacementEventsPlaced(ask.events as Array<{ status?: string; placedEventId?: number | null; x?: number | null; y?: number | null }>)
    || allPlacementEventsPlaced(visible.events as Array<{ status?: string; placedEventId?: number | null; x?: number | null; y?: number | null }>)
  const events = ask.events || visible.events || []
  const missingContractIds = (events as Array<Record<string, unknown>>)
    .filter((event) => !isPlacementEventDone({
      status: String(event.status || ''),
      placedEventId: event.placedEventId as number | null | undefined,
      x: event.x as number | null | undefined,
      y: event.y as number | null | undefined,
    }))
    .map((event) => String(event.contractId || event.id || ''))
    .filter(Boolean)
  await submitAsk(submitAskId, { placed: ready, partial: !ready, events, missingContractIds }, {
    intent: [
      formatPlacementResultIntent({ ...ask, events }),
      ready
        ? placementAllPlacedFollowUp()
        : placementPartialFollowUp(),
    ].join('\n\n'),
    displayText: ready
      ? t('chat.placement.eventsPlacedContinue')
      : t('chat.placement.reportedPartial'),
  })
}

async function handleProductionBoardConfirm(askId: string) {
  const ask = getAsk(askId)
  if (!ask) return
  await submitAsk(askId, { decision: 'confirmed' }, {
    intent: productionBoardConfirmedPrompt(askId),
    displayText: t('chat.board.confirmed')
  })
}

async function handleMapSelectionExisting(askId: string, mapId: number) {
  const ask = getAsk(askId)
  if (!ask) return
  await submitAsk(askId, { decision: 'use-existing', selectedMapId: mapId }, {
    intent: mapSelectionUseExistingPrompt(askId, mapId),
    displayText: t('chat.placement.useMap', { mapId }),
  })
}

async function handleMapSelectionAdjust(askId: string) {
  const ask = getAsk(askId)
  if (!ask) return
  await submitAsk(askId, { decision: 'adjust-story' }, {
    intent: mapSelectionAdjustStoryPrompt(askId),
    displayText: t('chat.placement.adjustStory'),
  })
}

async function handleStop() {
  await stopSession()
}

async function handleRevealArtifacts(sessionId: string) {
  if (!sessionId) return
  try {
    await sessionsApi.revealArtifacts(sessionId)
  } catch (error) {
    ElMessage.error(formatErrorText(error, t('chat.artifacts.openFailed')))
  }
}

// 显式新建对话：断流、清空，回到空态 hero。
async function startNewConversation() {
  const previousSessionId = activeSession.value?.id
  if (activeSession.value) await persistTranscript()
  detachFromSession()
  newConversation()
  resetState()
  contextUsage.value = null
  if (previousSessionId) {
    taskBoard.clear(previousSessionId)
    sessionPlan.clear(previousSessionId)
    subagents.clear(previousSessionId)
  }
  selectAvailableModel()
  emit('conversation-created')
}

async function deleteConversation(conv: Conversation) {
  try {
    await ElMessageBox.confirm(
      t('chat.delete.confirmBody'),
      t('chat.delete.confirmTitle'),
      { type: 'warning', confirmButtonText: t('chat.delete.confirm'), cancelButtonText: t('chat.delete.cancel') },
    )
  } catch {
    return
  }

  const convList = groupSessionsIntoConversations(historySessions.value, currentProductLanguage.value)
  const deletedIndex = convList.findIndex((item) => item.rootId === conv.rootId)
  const fallbackLeafId = deletedIndex >= 0
    ? (convList[deletedIndex + 1]?.leafId ?? convList[deletedIndex - 1]?.leafId ?? null)
    : null

  const activeRootId = activeConversationRootId(historySessions.value, activeSession.value?.id)
  const isActiveDeleted = activeRootId === conv.rootId

  if (isActiveDeleted) {
    detachFromSession()
    newConversation()
    resetState()
  }

  try {
    for (const sessionId of conv.sessionIds) {
      await sessionsApi.delete(sessionId)
    }
    await loadHistory()
    if (isActiveDeleted) {
      if (fallbackLeafId) {
        await selectConversation(fallbackLeafId)
      }
    }
    ElMessage.success(t('chat.delete.success'))
  } catch (error) {
    console.error('Failed to delete conversation:', error)
    ElMessage.error(formatErrorText(error, t('chat.delete.failed')))
    await loadHistory()
  }
}

// 选择历史对话：用链尾会话作为活动会话（后续发言续接同链）。
// 已结束的对话从持久化转录还原；运行中的对话续看实时流。
async function selectConversation(leafId: string) {
  if (activeSession.value) await persistTranscript()
  detachFromSession()
  try {
    const detail = await sessionsApi.get(leafId) as Session & {
      chatLog?: unknown
      lastSequence?: number
      events?: SessionRuntimeEvent[]
    }
    activeSession.value = detail
    updateStatus(detail.status)
    void taskBoard.loadFromBackend(leafId)
    void sessionPlan.loadFromBackend(leafId)
    void subagents.loadFromBackend(leafId)
    const isLive = ['created', 'preparing', 'starting', 'running'].includes(detail.status)
    let saved = extractChatLogSegments(detail.chatLog)
    try {
      const chain = await sessionsApi.history(leafId) as Array<{ chatLog?: unknown }>
      saved = loadPersistedSegmentsFromChain(chain) ?? saved
    } catch {
      // history 不可用时仅用 leaf chatLog。
    }
    if (saved?.length) {
      restoreSegments(saved as never)
      hydrateReviewPreviewFromTranscript(saved as never)
      const playtestEvents = detail.events?.filter((event) => event.type === 'playtest_run') || []
      if (playtestEvents.length) replaySessionEvents(playtestEvents)
    } else {
      resetState()
      const events = detail.events
      if (events?.length) {
        replaySessionEvents(events)
      }
    }
    if (isLive) {
      await attachToSession(leafId, {
        fresh: false,
        fromSequence: Number(detail.lastSequence) || 0
      })
    }
    return true
  } catch (error) {
    console.error('Failed to load conversation:', error)
    ElMessage.error(t('chat.loadFailed'))
    return false
  }
}

async function openConversation(leafId: string) {
  if (await selectConversation(leafId)) {
    emit('conversation-selected')
  }
}

function syncThinkingLevelForModel(providerId: string, modelId: string) {
  if (!providerId || !modelId) return
  const normalized = resetStoredThinkingLevel(providerId, modelId, thinkingLevel.value)
  if (normalized !== thinkingLevel.value) {
    thinkingLevel.value = normalized
  }
}

function selectAvailableModel() {
  const engine = settingsStore.agentExecution.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  const binding = settingsStore.bindingForEngine(engine)
  const resolved = resolveChatModelSelection(availableProviders.value, {
    persisted: loadEngineChatSelection(engine),
    binding,
  })
  selectedProvider.value = resolved?.providerId || ''
  selectedModel.value = resolved?.modelId || ''
  if (resolved?.providerId && resolved?.modelId) {
    syncThinkingLevelForModel(resolved.providerId, resolved.modelId)
  }
}

async function loadProviders(options: { preserveCurrentSelection?: boolean } = {}) {
  try {
    await settingsStore.loadAgentExecution()
    const engine = settingsStore.agentExecution.engine || DEFAULT_AGENT_EXECUTION_ENGINE
    const result = await settingsStore.listCompatibleProviders(engine)
    availableProviders.value = toChatProviderOptions(result.providers || [])

    if (
      options.preserveCurrentSelection
      && selectedProvider.value
      && selectedModel.value
    ) {
      return
    }

    selectAvailableModel()
  } catch (error) {
    console.error('Failed to load providers:', error)
  }
}

function onSelectProfile({ providerId, modelId }: { providerId: string; modelId: string }) {
  selectedProvider.value = providerId
  selectedModel.value = modelId
  syncThinkingLevelForModel(providerId, modelId)
}

async function loadHistory() {
  const generation = ++loadHistoryGeneration
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = await sessionsApi.list()
    historySessions.value = (result as { sessions?: Session[] }).sessions || (result as unknown as Session[]) || []
  } catch (error) {
    console.error('Failed to load history:', error)
    const message = formatErrorText(error)
    historyError.value = t('chat.historyLoadFailed', { message })
  } finally {
    if (generation === loadHistoryGeneration) {
      historyLoading.value = false
    }
  }
}

defineExpose({
  startNewConversation,
  loadHistory,
})

/** 从地图/设置等页回到 Chat：对齐后端会话态、模型列表与历史侧栏。 */
async function resumeChatView(): Promise<void> {
  // 流在切走时可能已写入终态，但 ChatView 的 watch 已卸载，先用内存里的 currentStatus 对齐。
  if (currentStatus.value) {
    updateStatus(currentStatus.value)
  }
  await refreshActiveSession()
  if (currentStatus.value) {
    updateStatus(currentStatus.value)
  }

  const sessionId = activeSession.value?.id
  if (sessionId) {
    void taskBoard.loadFromBackend(sessionId)
    void sessionPlan.loadFromBackend(sessionId)
    void subagents.loadFromBackend(sessionId)
  }
  if (
    sessionId
    && LIVE_SESSION_STATUSES.includes(activeSession.value?.status || '')
    && !isStreaming.value
  ) {
    try {
      const detail = await sessionsApi.get(sessionId) as Session & { lastSequence?: number }
      await attachToSession(sessionId, {
        fresh: false,
        fromSequence: Number(detail.lastSequence) || 0,
      })
    } catch (error) {
      console.error('Failed to re-attach session stream:', error)
    }
  }

  await settingsStore.loadAgentExecution()
  await loadProviders({ preserveCurrentSelection: Boolean(activeSession.value) })
  await loadSlashCommands()
  await runPreflightCheck()
  await loadHistory()
}

onMounted(() => {
  registerTranscriptPersister(schedulePersistTranscript)
  registerEventReviewPreviewListener((events) => handleRegisteredEventPreview(events))
  if (typeof ResizeObserver !== 'undefined') {
    bottomSlotObserver = new ResizeObserver(measureBottomSlot)
  }
  observeBottomSlot(bottomSlotRef.value)
  void nextTick(measureBottomSlot)
  void resumeChatView()
})

watch(inputMsg, (value) => {
  if (!value.trim()) return
  if (composerHint.value) composerHint.value = ''
})

onUnmounted(() => {
  bottomSlotObserver?.disconnect()
  bottomSlotObserver = null
  registerTranscriptPersister(null)
  registerEventReviewPreviewListener(null)
})
</script>

<style scoped>
.chat-view {
  height: 100%;
  display: flex;
}

.chat-pane {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header-title {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.preflight-alert {
  flex: 0 0 auto;
  width: min(var(--app-content-max), calc(100% - var(--space-8)));
  margin: var(--space-3) auto 0;
}

.chat-bottom-slot {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  padding: 14px var(--space-8) var(--space-6);
  pointer-events: none;
}

.chat-bottom-slot::before {
  content: '';
  position: absolute;
  top: 14px;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  background: var(--app-bg);
  pointer-events: none;
}

.chat-bottom-slot.is-empty {
  position: absolute;
  right: 0;
  left: 0;
  top: 60%;
  bottom: auto;
  transform: translateY(-50%);
  background: transparent;
}

.chat-bottom-slot.is-empty::before {
  display: none;
}

.chat-bottom-slot :deep(.chat-composer-wrap) {
  position: relative;
  z-index: 1;
  padding: 0;
  background: transparent;
  pointer-events: auto;
}

.ask-dock {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  width: 100%;
  pointer-events: auto;
}

.ask-dock :deep(.ask-card) {
  width: min(var(--app-composer-max), calc(100% - var(--space-4)));
  max-height: min(58vh, 560px);
  overflow-y: auto;
  border-radius: 20px;
  box-shadow: var(--app-shadow-composer);
}

@media (max-width: 720px) {
  .chat-bottom-slot {
    padding: 12px var(--space-4) var(--space-4);
  }

  .chat-bottom-slot::before {
    width: 100%;
  }

  .ask-dock :deep(.ask-card) {
    width: 100%;
    max-height: min(62vh, 520px);
  }
}
</style>
