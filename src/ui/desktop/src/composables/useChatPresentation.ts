import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { ChatSegment } from './useSessionStream'
import {
  advanceChatPresentation,
  isChatPresentationDrained,
  pendingChatPresentationSegmentId,
  syncChatPresentation,
} from '../utils/chatPresentation'

const REVEAL_INTERVAL_MS = 28

/** 保留 source 作为完整转录，只让展示副本按顺序追赶实时事件。 */
export function useChatPresentation(options: {
  source: Readonly<Ref<ChatSegment[]>>
  running: Readonly<Ref<boolean | undefined>>
  sessionKey: Readonly<Ref<string | null | undefined>>
  liveSegmentId: Readonly<Ref<string | null | undefined>>
}) {
  const segments = ref<ChatSegment[]>([])
  const presenting = ref(false)
  const drained = ref(true)
  let initialized = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function stopTimer(): void {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  function updateState(): void {
    drained.value = isChatPresentationDrained(segments.value, options.source.value)
    if (presenting.value && !options.running.value && drained.value) {
      presenting.value = false
    }
  }

  function scheduleTick(): void {
    if (timer || !presenting.value || drained.value) return
    timer = setTimeout(() => {
      timer = null
      segments.value = advanceChatPresentation(segments.value, options.source.value)
      updateState()
      scheduleTick()
    }, REVEAL_INTERVAL_MS)
  }

  function synchronize(forceInstant = false): void {
    const animate = initialized && presenting.value && !forceInstant
    segments.value = syncChatPresentation(segments.value, options.source.value, animate)
    initialized = true
    updateState()
    scheduleTick()
  }

  watch(
    options.source,
    () => synchronize(),
    { deep: true, immediate: true, flush: 'sync' },
  )

  watch(
    options.running,
    (running) => {
      if (running) presenting.value = true
      synchronize()
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    options.sessionKey,
    () => {
      stopTimer()
      initialized = false
      presenting.value = Boolean(options.running.value)
      synchronize(true)
    },
    { flush: 'sync' },
  )

  onBeforeUnmount(stopTimer)

  const pipelineActive = computed(() => Boolean(options.running.value) || presenting.value)
  const liveSegmentId = computed(() => {
    if (!pipelineActive.value) return null
    return pendingChatPresentationSegmentId(segments.value, options.source.value)
      || options.liveSegmentId.value
      || null
  })

  return {
    segments,
    drained,
    pipelineActive,
    liveSegmentId,
  }
}
