<template>
  <div
    ref="chatLogRef"
    class="chat-log"
    @scroll.passive="onChatScroll"
  >
    <div class="segments-container">
      <article
        v-for="turn in turns"
        :key="turn.id"
        class="chat-turn"
      >
        <TurnSegment v-if="turn.user && !turn.user.metadata?.sourceAskId" :segment="turn.user" />

        <div class="agent-turn">
          <template v-for="item in turn.timeline" :key="item.id">
            <ExecutionGroup
              v-if="isExecutionGroupItem(item)"
              :group="item"
              :live-segment-id="presentationLiveSegmentId"
            />
            <AskHistory
              v-else-if="item.type === 'ask' && item.ask?.result?.submittedAt"
              :ask="item.ask"
            />
            <AskCard
              v-else-if="item.type === 'ask' && item.ask && item.ask.type !== 'risk-approval'"
              :ask="item.ask"
              @approve="(id) => emit('approve', id)"
              @revise="(id, fb) => emit('revise', id, fb)"
              @reject="(id, fb) => emit('reject', id, fb)"
              @clarify="(id, payload) => emit('clarify', id, payload)"
              @multi-choice="(id, ans) => emit('multi-choice', id, ans)"
              @action="(id) => emit('action', id)"
              @event-placement-open="(id, cid) => emit('event-placement-open', id, cid)"
              @event-placement-orchestrate="(id) => emit('event-placement-orchestrate', id)"
              @event-placement-refresh="(id) => emit('event-placement-refresh', id)"
              @event-placement-send="(id) => emit('event-placement-send', id)"
              @production-board-confirm="(id) => emit('production-board-confirm', id)"
              @map-selection-existing="(id, mapId) => emit('map-selection-existing', id, mapId)"
              @map-selection-adjust="(id) => emit('map-selection-adjust', id)"
            />
            <TurnSegment
              v-else
              :segment="item"
              :stream-plain="item.id === presentationLiveSegmentId"
            />
          </template>

          <button
            v-if="turn.artifact"
            type="button"
            class="turn-artifact"
            @click="emit('reveal-artifacts', artifactSessionId(turn))"
          >
            {{ t('chat.artifacts.logAction') }}
          </button>
        </div>
      </article>
    </div>

    <div
      class="chat-bottom-spacer"
      :style="bottomSpacerStyle"
      aria-hidden="true"
    />

    <button
      v-if="showNewMessages"
      type="button"
      class="chat-new-messages"
      @click="jumpToLatest"
    >
      {{ t('chat.newMessages') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import type { ChatSegment } from '../composables/useSessionStream'
import { buildChatTurns, type ChatTurn, type ExecutionGroup as ExecutionGroupItem } from '../utils/chatTurns'
import { isNearScrollBottom } from '../utils/chatScrollFollow'
import { useChatPresentation } from '../composables/useChatPresentation'
import TurnSegment from './TurnSegment.vue'
import ExecutionGroup from './ExecutionGroup.vue'
import AskCard from './AskCard.vue'
import AskHistory from './AskHistory.vue'
import { useI18n } from '../i18n'

const props = defineProps<{
  segments: ChatSegment[]
  running?: boolean
  liveMarkdownSegmentId?: string | null
  sessionKey?: string | null
  dockedAskId?: string | null
  bottomInset?: number
}>()

const emit = defineEmits<{
  approve: [askId: string]
  revise: [askId: string, feedback: string]
  reject: [askId: string, feedback: string]
  clarify: [askId: string, payload: { answer: string; selected?: string[]; other?: string }]
  'multi-choice': [askId: string, answers: Record<string, { selected: string[]; other: string }>]
  action: [askId: string]
  'event-placement-open': [askId: string, contractId: string]
  'event-placement-orchestrate': [askId: string]
  'event-placement-refresh': [askId: string]
  'event-placement-send': [askId: string]
  'production-board-confirm': [askId: string]
  'map-selection-existing': [askId: string, mapId: number]
  'map-selection-adjust': [askId: string]
  'reveal-artifacts': [sessionId: string]
}>()

const chatLogRef = ref<HTMLElement>()
const { t } = useI18n()
const {
  segments: presentationSegments,
  pipelineActive,
  liveSegmentId: presentationLiveSegmentId,
} = useChatPresentation({
  source: toRef(props, 'segments'),
  running: toRef(props, 'running'),
  sessionKey: toRef(props, 'sessionKey'),
  liveSegmentId: toRef(props, 'liveMarkdownSegmentId'),
})
const turns = computed(() =>
  buildChatTurns(presentationSegments.value, props.dockedAskId)
)

function isExecutionGroupItem(item: unknown): item is ExecutionGroupItem {
  return Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'execution-group')
}

const bottomSpacerStyle = computed(() => ({
  height: `${Math.max(0, Number(props.bottomInset) || 0)}px`,
}))

/** 用户在底部附近时自动跟随新消息；主动上滚后暂停，直到回到底部或点击「有新消息」。 */
const followScroll = ref(true)
const showNewMessages = ref(false)

const scrollCursor = computed(() => {
  const segments = presentationSegments.value
  const last = segments.at(-1)
  return `${props.sessionKey || ''}:${segments.length}:${last?.content.length || 0}:${pipelineActive.value ? 1 : 0}:${props.bottomInset || 0}`
})

function onChatScroll(): void {
  const element = chatLogRef.value
  if (!element) return
  if (isNearScrollBottom(element)) {
    followScroll.value = true
    showNewMessages.value = false
  } else {
    followScroll.value = false
  }
}

function artifactSessionId(turn: ChatTurn): string {
  return String(turn.artifact?.metadata?.sessionId || props.sessionKey || '')
}

async function scrollToBottom(force = false): Promise<void> {
  if (!force && !followScroll.value) {
    showNewMessages.value = true
    return
  }
  showNewMessages.value = false
  await nextTick()
  requestAnimationFrame(() => {
    const element = chatLogRef.value
    if (!element) return
    element.scrollTop = element.scrollHeight
    followScroll.value = true
  })
}

function jumpToLatest(): void {
  void scrollToBottom(true)
}

watch(scrollCursor, () => { void scrollToBottom() }, { flush: 'post', immediate: true })

watch(
  () => props.sessionKey,
  () => {
    followScroll.value = true
    showNewMessages.value = false
    void scrollToBottom(true)
  },
)
</script>

<style scoped>
/* 布局与排版见 styles/chat.css */
</style>
