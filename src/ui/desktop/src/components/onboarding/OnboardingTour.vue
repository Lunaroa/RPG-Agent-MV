<template>
  <teleport to="body">
    <div
      v-if="active"
      class="tour-shell"
      data-ui-id="onboarding-tour"
      role="dialog"
      aria-modal="true"
      :aria-label="t('tour.aria')"
    >
      <div v-if="!targetRect" class="tour-dim" />
      <div v-if="targetRect" class="tour-target" :style="targetStyle" />
      <section class="tour-card" :style="cardStyle">
        <button
          type="button"
          class="tour-close"
          data-ui-id="onboarding-tour-close"
          :aria-label="t('tour.skip')"
          :title="t('tour.skip')"
          @click="skipTour"
        >
          <X :size="15" :stroke-width="1.7" />
        </button>

        <span class="tour-kicker">{{ t('tour.progress', { current: stepIndex + 1, total: steps.length }) }}</span>
        <h2>{{ t(currentStep.titleKey) }}</h2>
        <p>{{ t(currentStep.bodyKey) }}</p>

        <pre v-if="currentStep.id === 'firstTask'" class="tour-sample">{{ t('tour.step.firstTask.sample') }}</pre>

        <button
          v-if="currentStep.externalUrl"
          type="button"
          class="tour-route-action"
          data-ui-id="onboarding-tour-external-link"
          @click="openExternalLink(currentStep.externalUrl)"
        >
          <span>{{ t(currentStep.actionLabelKey || 'tour.action.openDeepSeek') }}</span>
          <ExternalLink :size="15" :stroke-width="1.8" />
        </button>

        <button
          v-if="currentStep.id === 'firstTask'"
          type="button"
          class="tour-route-action"
          data-ui-id="onboarding-tour-first-task"
          @click="goToFirstTask"
        >
          <span>{{ firstTaskActionLabel }}</span>
          <ChevronRight :size="15" :stroke-width="1.8" />
        </button>

        <div class="tour-actions">
          <button type="button" class="tour-text-btn" @click="skipTour">{{ t('tour.skip') }}</button>
          <span class="tour-action-spacer" />
          <button
            type="button"
            class="tour-step-btn"
            :disabled="stepIndex === 0"
            @click="previousStep"
          >
            <ChevronLeft :size="15" :stroke-width="1.8" />
            <span>{{ t('tour.back') }}</span>
          </button>
          <button v-if="!isLastStep" type="button" class="tour-step-btn primary" @click="nextStep">
            <span>{{ t('tour.next') }}</span>
            <ChevronRight :size="15" :stroke-width="1.8" />
          </button>
          <button v-else type="button" class="tour-step-btn primary" @click="finishTour">
            <Check :size="15" :stroke-width="1.9" />
            <span>{{ t('tour.finish') }}</span>
          </button>
        </div>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Check, ChevronLeft, ChevronRight, ExternalLink, X } from '@lucide/vue'
import { system } from '../../api/client'
import { useProjectStore } from '../../stores/project'
import { useWorkbenchUiStore } from '../../stores/workbenchUi'
import { useI18n, type MessageKey } from '../../i18n'

const START_TOUR_EVENT = 'agent-rpg:onboarding-tour:start'
const TOUR_DONE_STORAGE_KEY = 'rpg-agent-mv.onboarding-tour.v1.done'
const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
const TARGET_PADDING = 8
const CARD_WIDTH = 348
const CARD_MARGIN = 14
const CARD_ESTIMATED_HEIGHT = 280

type TourPlacement = 'bottom' | 'top' | 'left' | 'right' | 'center'

interface TourStep {
  id: string
  titleKey: MessageKey
  bodyKey: MessageKey
  target?: string
  placement: TourPlacement
  route?: { path: string; query?: Record<string, string> }
  openAgentPanel?: boolean
  actionLabelKey?: MessageKey
  externalUrl?: string
}

interface TourRect {
  top: number
  left: number
  width: number
  height: number
  right: number
  bottom: number
}

const router = useRouter()
const projectStore = useProjectStore()
const ui = useWorkbenchUiStore()
const { t } = useI18n()

const active = ref(false)
const stepIndex = ref(0)
const targetRect = ref<TourRect | null>(null)
const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })

const steps = computed<TourStep[]>(() => [
  {
    id: 'welcome',
    titleKey: 'tour.step.welcome.title',
    bodyKey: 'tour.step.welcome.body',
    placement: 'center',
  },
  {
    id: 'console',
    titleKey: 'tour.step.console.title',
    bodyKey: 'tour.step.console.body',
    target: '[data-ui-id="nav-console"]',
    placement: 'right',
    route: { path: '/console', query: { page: 'home' } },
  },
  {
    id: 'project',
    titleKey: 'tour.step.project.title',
    bodyKey: 'tour.step.project.body',
    target: '[data-ui-id="project-access-browse"]',
    placement: 'bottom',
    route: { path: '/console', query: { page: 'home' } },
  },
  {
    id: 'settings',
    titleKey: 'tour.step.settings.title',
    bodyKey: 'tour.step.settings.body',
    target: '[data-ui-id="settings-tab-model-engine"], [data-ui-id="settings-view-model-engine"], [data-ui-id="nav-settings"]',
    placement: 'right',
    route: { path: '/console', query: { page: 'settings' } },
    actionLabelKey: 'tour.action.openDeepSeek',
    externalUrl: DEEPSEEK_API_KEYS_URL,
  },
  {
    id: 'syncProviders',
    titleKey: 'tour.step.syncProviders.title',
    bodyKey: 'tour.step.syncProviders.body',
    target: '[data-ui-id="settings-sync-providers"], [data-ui-id="settings-sync-providers-empty"], [data-ui-id="settings-add-dialog-sync-providers"], [data-ui-id="settings-provider-sync"]',
    placement: 'bottom',
    route: { path: '/console', query: { page: 'settings' } },
  },
  {
    id: 'fillApiKey',
    titleKey: 'tour.step.fillApiKey.title',
    bodyKey: 'tour.step.fillApiKey.body',
    target: '[data-ui-id^="settings-provider-api-key-"], [data-ui-id^="settings-provider-card-body-"], [data-ui-id="settings-provider-card-list"], [data-ui-id="settings-add-api"], [data-ui-id="settings-add-api-empty"]',
    placement: 'bottom',
    route: { path: '/console', query: { page: 'settings' } },
  },
  {
    id: 'fetchModels',
    titleKey: 'tour.step.fetchModels.title',
    bodyKey: 'tour.step.fetchModels.body',
    target: '[data-ui-id="settings-provider-fetch-models-deepseek"], [data-ui-id="settings-provider-set-default-deepseek"], [data-ui-id="settings-provider-card-deepseek"]',
    placement: 'bottom',
    route: { path: '/console', query: { page: 'settings' } },
  },
  {
    id: 'editor',
    titleKey: 'tour.step.editor.title',
    bodyKey: 'tour.step.editor.body',
    target: '[data-ui-id="nav-workbench"]',
    placement: 'right',
    route: { path: '/workbench' },
  },
  {
    id: 'agent',
    titleKey: 'tour.step.agent.title',
    bodyKey: 'tour.step.agent.body',
    target: '[data-ui-id="chat-composer"], [data-ui-id="agent-panel-inner"], [data-ui-id="agent-panel"]',
    placement: 'left',
    route: { path: '/workbench' },
    openAgentPanel: true,
  },
  {
    id: 'firstTask',
    titleKey: 'tour.step.firstTask.title',
    bodyKey: projectStore.currentProject ? 'tour.step.firstTask.bodyReady' : 'tour.step.firstTask.bodyNoProject',
    target: projectStore.currentProject ? '[data-ui-id="chat-input"]' : '[data-ui-id="workbench-open-project-console"]',
    placement: projectStore.currentProject ? 'left' : 'bottom',
    route: { path: '/workbench' },
    openAgentPanel: true,
  },
  {
    id: 'help',
    titleKey: 'tour.step.help.title',
    bodyKey: 'tour.step.help.body',
    target: '[data-ui-id="topbar-menu-help"]',
    placement: 'bottom',
  },
])

const currentStep = computed(() => steps.value[Math.min(stepIndex.value, steps.value.length - 1)])
const isLastStep = computed(() => stepIndex.value >= steps.value.length - 1)
const firstTaskActionLabel = computed(() =>
  projectStore.currentProject ? t('tour.action.writeFirstTask') : t('tour.action.addProject'),
)

const targetStyle = computed(() => {
  const rect = targetRect.value
  if (!rect) return {}
  return {
    top: `${Math.max(0, rect.top - TARGET_PADDING)}px`,
    left: `${Math.max(0, rect.left - TARGET_PADDING)}px`,
    width: `${rect.width + TARGET_PADDING * 2}px`,
    height: `${rect.height + TARGET_PADDING * 2}px`,
  }
})

const cardStyle = computed(() => {
  const rect = targetRect.value
  if (!rect || currentStep.value.placement === 'center') {
    return {
      top: `${Math.max(CARD_MARGIN, viewport.height / 2 - CARD_ESTIMATED_HEIGHT / 2)}px`,
      left: `${Math.max(CARD_MARGIN, viewport.width / 2 - CARD_WIDTH / 2)}px`,
    }
  }

  let top = rect.bottom + CARD_MARGIN
  let left = rect.left + rect.width / 2 - CARD_WIDTH / 2
  if (currentStep.value.placement === 'top') top = rect.top - CARD_ESTIMATED_HEIGHT - CARD_MARGIN
  if (currentStep.value.placement === 'left') {
    top = rect.top + rect.height / 2 - CARD_ESTIMATED_HEIGHT / 2
    left = rect.left - CARD_WIDTH - CARD_MARGIN
  }
  if (currentStep.value.placement === 'right') {
    top = rect.top + rect.height / 2 - CARD_ESTIMATED_HEIGHT / 2
    left = rect.right + CARD_MARGIN
  }

  if (top + CARD_ESTIMATED_HEIGHT > viewport.height - CARD_MARGIN) {
    top = Math.max(CARD_MARGIN, viewport.height - CARD_ESTIMATED_HEIGHT - CARD_MARGIN)
  }
  if (top < CARD_MARGIN) top = CARD_MARGIN
  left = Math.max(CARD_MARGIN, Math.min(left, viewport.width - CARD_WIDTH - CARD_MARGIN))

  return { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
})

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markCompleted(): void {
  try {
    localStorage.setItem(TOUR_DONE_STORAGE_KEY, '1')
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function startTour(): void {
  stepIndex.value = 0
  active.value = true
  ui.appRailOpen = true
  void prepareStep()
}

function updateViewport(): void {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight
  updateTargetRect()
}

function updateTargetRect(): void {
  const selector = currentStep.value.target
  if (!selector) {
    targetRect.value = null
    return
  }
  const target = resolveTarget(selector)
  if (!target) {
    targetRect.value = null
    return
  }
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' })
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    targetRect.value = null
    return
  }
  targetRect.value = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  }
}

function resolveTarget(selector: string): HTMLElement | null {
  const candidates = selector.split(',').map((candidate) => candidate.trim()).filter(Boolean)
  for (const candidate of candidates) {
    const target = document.querySelector(candidate) as HTMLElement | null
    if (target) return target
  }
  return null
}

async function prepareStep(): Promise<void> {
  if (!active.value) return
  ui.appRailOpen = true
  if (currentStep.value.openAgentPanel) ui.setAgentPanelOpen(true)
  if (currentStep.value.route) {
    await router.push(currentStep.value.route)
    await router.isReady()
  }
  await nextTick()
  await frame()
  await frame()
  updateTargetRect()
}

function previousStep(): void {
  if (stepIndex.value <= 0) return
  stepIndex.value -= 1
  void prepareStep()
}

function nextStep(): void {
  if (isLastStep.value) {
    finishTour()
    return
  }
  stepIndex.value += 1
  void prepareStep()
}

function closeTour(markDone: boolean): void {
  if (markDone) markCompleted()
  active.value = false
  targetRect.value = null
}

function skipTour(): void {
  closeTour(true)
}

function finishTour(): void {
  closeTour(true)
}

async function goToFirstTask(): Promise<void> {
  markCompleted()
  active.value = false
  ui.appRailOpen = true
  if (projectStore.currentProject) {
    ui.setAgentPanelOpen(true)
    await router.push({ path: '/workbench' })
    await nextTick()
    await frame()
    const input = document.querySelector('[data-ui-id="chat-input"]') as HTMLTextAreaElement | null
    input?.focus()
    return
  }
  await router.push({ path: '/console', query: { page: 'home' } })
}

function openExternalLink(url?: string): void {
  if (!url) return
  void system.openExternalUrl(url)
}

function onKeydown(event: KeyboardEvent): void {
  if (!active.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    skipTour()
  }
}

onMounted(() => {
  window.addEventListener(START_TOUR_EVENT, startTour)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('keydown', onKeydown)
  window.setTimeout(() => {
    if (!hasCompletedTour()) startTour()
  }, 400)
})

onBeforeUnmount(() => {
  window.removeEventListener(START_TOUR_EVENT, startTour)
  window.removeEventListener('resize', updateViewport)
  document.removeEventListener('keydown', onKeydown)
})

watch(() => projectStore.currentProject, () => {
  if (active.value) void prepareStep()
})
</script>

<style scoped>
.tour-shell {
  position: fixed;
  inset: 0;
  z-index: 3400;
  pointer-events: auto;
  color: var(--app-ink);
}

.tour-dim {
  position: fixed;
  inset: 0;
  background: rgba(28, 24, 19, .58);
}

.tour-target {
  position: fixed;
  border: 2px solid #f2b36d;
  border-radius: 10px;
  box-shadow:
    0 0 0 9999px rgba(28, 24, 19, .58),
    0 0 0 6px rgba(242, 179, 109, .18),
    0 18px 46px rgba(28, 24, 19, .24);
  pointer-events: none;
}

.tour-card {
  position: fixed;
  width: min(348px, calc(100vw - 28px));
  max-height: calc(100vh - 28px);
  overflow: auto;
  padding: 19px 18px 16px;
  border: 1px solid color-mix(in srgb, var(--app-border-strong, #d7cdbd) 72%, #f2b36d 28%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 253, 249, .98), rgba(250, 246, 239, .98));
  box-shadow: 0 24px 70px rgba(28, 24, 19, .28);
}

.tour-close {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
}

.tour-close:hover {
  background: var(--app-bg-soft);
  color: var(--app-ink);
}

.tour-kicker {
  display: block;
  margin: 0 30px 8px 0;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono);
  font-size: 10.5px;
  font-weight: 650;
}

.tour-card h2 {
  margin: 0;
  color: var(--app-ink);
  font-size: 19px;
  line-height: 1.2;
  font-weight: 680;
}

.tour-card p {
  margin: 9px 0 0;
  color: var(--app-ink-soft);
  font-size: 13px;
  line-height: 1.6;
}

.tour-sample {
  margin: 12px 0 0;
  padding: 10px 11px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-sunken);
  color: var(--app-ink);
  font-family: var(--app-font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.tour-route-action {
  width: 100%;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 11px;
  border: 1px solid #d28a4c;
  border-radius: 8px;
  background: #fff8ef;
  color: #9d4d18;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}

.tour-route-action:hover {
  background: #ffefd9;
}

.tour-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 15px;
}

.tour-action-spacer {
  flex: 1;
}

.tour-text-btn,
.tour-step-btn {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 8px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}

.tour-text-btn {
  border: 0;
  background: transparent;
  color: var(--app-ink-muted);
  padding: 0 3px;
}

.tour-text-btn:hover {
  color: var(--app-ink);
}

.tour-step-btn {
  border: 1px solid var(--app-border-strong);
  background: var(--app-bg);
  color: var(--app-ink-soft);
  padding: 0 10px;
}

.tour-step-btn:hover:not(:disabled) {
  border-color: var(--app-accent);
  color: var(--app-accent);
}

.tour-step-btn.primary {
  border-color: var(--app-accent);
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

.tour-step-btn.primary:hover {
  filter: brightness(.97);
}

.tour-step-btn:disabled {
  opacity: .42;
  cursor: not-allowed;
}
</style>
