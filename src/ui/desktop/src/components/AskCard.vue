<template>
  <div
    class="ask-card"
    :class="[askCardClass, { 'ask-card-locked': isLocked }]"
    tabindex="0"
    @keydown="handleCardKeydown"
  >
    <div class="ask-kicker">
      <span class="ask-kicker-dot" />
      {{ askKicker }}
    </div>
    <p v-if="failureMessage" class="ask-failed-note">{{ failureMessage }}</p>
    <!-- Plan Approval Card -->
    <template v-if="ask.type === 'plan-approval'">
      <div class="ask-header">
        <strong>{{ ask.title }}</strong>
      </div>
      <p>{{ ask.prompt }}</p>
      <details v-if="(ask.planMarkdown || '').length > 80" class="ask-details plan-details">
        <summary>{{ t('ask.plan.viewDetails') }}</summary>
        <div class="plan-content markdown-body" v-html="renderMarkdown(ask.planMarkdown || '')" />
      </details>
      <div v-else class="plan-content markdown-body" v-html="renderMarkdown(ask.planMarkdown || '')" />
      <div v-if="!isLocked" class="plan-actions">
        <el-button type="primary" @click="handleApprove">{{ t('ask.plan.approve') }}</el-button>
        <el-button type="warning" @click="handleRevise">{{ reviseButtonLabel }}</el-button>
        <el-button type="danger" @click="handleReject">{{ rejectButtonLabel }}</el-button>
      </div>
      <div v-if="showPlanFeedback" class="plan-feedback">
        <el-input
          v-model="feedback"
          type="textarea"
          :rows="3"
          :placeholder="planFeedbackPlaceholder"
        />
      </div>
    </template>

    <!-- Risk Approval Card (通用高危操作审批卡，对齐 Claude Code 权限提示：展示要执行的实际内容) -->
    <template v-else-if="ask.type === 'risk-approval'">
      <p class="risk-action-line">{{ t('ask.riskApproval.actionLead') }}<strong>{{ ask.actionLabel || ask.title }}</strong></p>
      <pre v-if="ask.script" class="risk-script">{{ ask.script }}</pre>
      <div v-if="!isLocked" class="risk-actions">
        <el-button size="small" type="primary" @click="handleApprove">{{ t('ask.riskApproval.allowOnce') }}</el-button>
        <el-button size="small" @click="handleRiskAlwaysAllow">{{ t('ask.riskApproval.alwaysAllow') }}</el-button>
        <el-button size="small" type="danger" @click="handleRiskReject">{{ t('ask.riskApproval.deny') }}</el-button>
      </div>
      <p v-else class="risk-status">{{ riskStatusText }}</p>
    </template>

    <!-- Clarify Card -->
    <template v-else-if="ask.type === 'clarify'">
      <strong class="ask-question">{{ clarifyQuestion }}</strong>
      <p v-if="isCanceled" class="ask-canceled-note">{{ t('ask.canceled') }}</p>
      <div v-if="!isLocked && hasClarifyOptions" class="clarify-options">
        <el-radio-group
          v-if="!ask.multiSelect"
          v-model="clarifySelected"
          class="clarify-option-group"
        >
          <el-radio
            v-for="option in ask.options"
            :key="option.id"
            :value="option.id"
            class="clarify-option-radio"
          >
            <span class="opt-row">
              <span class="opt-label">
                {{ option.label }}
                <span v-if="option.recommended" class="opt-recommended">(Recommended)</span>
              </span>
              <el-tooltip
                v-if="option.description"
                :content="option.description"
                placement="top"
                :show-after="150"
                effect="dark"
              >
                <span class="opt-info" @click.prevent>ⓘ</span>
              </el-tooltip>
              <span v-if="option.id === clarifySelected" class="opt-nav-hint" aria-hidden="true">↑↓</span>
            </span>
          </el-radio>
        </el-radio-group>
        <el-checkbox-group
          v-else
          v-model="clarifySelectedMulti"
          class="mcc-options clarify-option-group"
        >
          <div v-for="option in ask.options" :key="option.id" class="mcc-option">
            <el-checkbox :value="option.id">
              <span class="opt-row">
                <span class="opt-label">{{ option.label }}</span>
                <el-tooltip
                  v-if="option.description"
                  :content="option.description"
                  placement="top"
                  :show-after="150"
                  effect="dark"
                >
                  <span class="opt-info" @click.prevent>ⓘ</span>
                </el-tooltip>
              </span>
            </el-checkbox>
          </div>
        </el-checkbox-group>
        <el-input
          v-if="clarifyAllowOther"
          v-model="clarifyOtherText"
          class="ask-adjust-input"
          :placeholder="t('ask.otherPlaceholder')"
          :aria-label="t('ask.otherPlaceholder')"
          size="large"
          @click.stop
        />
        <div v-if="needsClarifyConfirm" class="ask-footer">
          <el-button text class="ask-ignore-btn" @click="handleClarifyIgnore">
            {{ t('ask.ignore') }} <kbd>Esc</kbd>
          </el-button>
          <span class="ask-kbd-hint">{{ t('ask.enterToSubmit') }} <kbd>↵</kbd></span>
          <el-button
            type="primary"
            class="clarify-confirm-btn"
            :disabled="!canSubmitClarify"
            @click="handleClarifyOptionsSubmit"
          >
            {{ t('ask.submit') }} <span class="ask-submit-icon">↵</span>
          </el-button>
        </div>
      </div>
      <div v-else-if="!isLocked" class="clarify-input">
        <el-input
          v-model="clarifyAnswer"
          type="textarea"
          :rows="3"
          :placeholder="ask.placeholder || t('ask.answerPlaceholder')"
        />
        <div class="ask-footer">
          <el-button text class="ask-ignore-btn" @click="handleClarifyIgnore">
            {{ t('ask.ignore') }} <kbd>Esc</kbd>
          </el-button>
          <el-button type="primary" class="clarify-confirm-btn" @click="handleClarifySubmit">
            {{ t('ask.submit') }} <span class="ask-submit-icon">↵</span>
          </el-button>
        </div>
      </div>
      <div v-else class="clarify-answer">
        <blockquote v-if="clarifyResultDisplay">{{ clarifyResultDisplay }}</blockquote>
      </div>
    </template>

    <!-- Multi-choice Clarify Card -->
    <template v-else-if="ask.type === 'multi-choice-clarify'">
      <div class="ask-header">
        <strong>{{ ask.title }}</strong>
        <span v-if="!isLocked" class="mcc-progress">{{ currentStep + 1 }} / {{ totalSteps }}</span>
      </div>
      <p>{{ ask.prompt }}</p>
      <el-progress v-if="!isLocked" :percentage="progressPercentage" :show-text="false" />
      <div v-if="!isLocked" class="mcc-steps">
        <div v-for="(question, idx) in ask.questions" :key="question.id" v-show="idx === currentStep" class="mcc-step">
          <h4>{{ question.header || t('ask.questionFallback', { index: idx + 1 }) }}</h4>
          <p v-if="question.question">{{ question.question }}</p>
          <el-checkbox-group
            v-if="question.multiSelect"
            v-model="selectedOptions[question.id] as string[]"
            class="mcc-options mcc-option-group clarify-option-group"
          >
            <div v-for="option in question.options" :key="option.id" class="mcc-option">
              <el-checkbox :value="option.id">
                <span class="opt-row">
                  <span class="opt-label">{{ option.label }}</span>
                  <el-tooltip
                    v-if="option.description"
                    :content="option.description"
                    placement="top"
                    :show-after="150"
                    effect="dark"
                  >
                    <span class="opt-info" @click.prevent>ⓘ</span>
                  </el-tooltip>
                </span>
              </el-checkbox>
            </div>
          </el-checkbox-group>
          <el-radio-group
            v-else
            v-model="selectedOptions[question.id] as string"
            class="mcc-options mcc-option-group clarify-option-group"
          >
            <el-radio
              v-for="option in question.options"
              :key="option.id"
              :value="option.id"
              class="mcc-option clarify-option-radio"
            >
              <span class="opt-row">
                <span class="opt-label">{{ option.label }}</span>
                <el-tooltip
                  v-if="option.description"
                  :content="option.description"
                  placement="top"
                  :show-after="150"
                  effect="dark"
                >
                  <span class="opt-info" @click.prevent>ⓘ</span>
                </el-tooltip>
              </span>
            </el-radio>
          </el-radio-group>
          <el-input
            v-if="question.allowOther"
            v-model="otherAnswers[question.id]"
            class="ask-adjust-input"
            :placeholder="t('ask.otherPlaceholder')"
            :aria-label="t('ask.otherPlaceholder')"
            size="large"
            @click.stop
          />
        </div>
      </div>
      <div v-else class="mcc-answers">
        <dl v-for="question in ask.questions" :key="question.id">
          <dt>{{ question.header || question.id }}</dt>
          <dd>{{ getAnswerDisplay(question) }}</dd>
        </dl>
      </div>
      <div v-if="!isLocked" class="mcc-footer">
        <el-button text class="ask-ignore-btn" @click="handleMultiChoiceIgnore">
          {{ t('ask.ignore') }} <kbd>Esc</kbd>
        </el-button>
        <div class="mcc-step-actions">
          <el-button :disabled="currentStep === 0" @click="currentStep--">{{ t('ask.previousQuestion') }}</el-button>
          <el-button v-if="currentStep < totalSteps - 1" @click="currentStep++">{{ t('ask.nextQuestion') }}</el-button>
          <el-button
            v-if="currentStep === totalSteps - 1"
            type="primary"
            class="clarify-confirm-btn"
            @click="handleMultiChoiceSubmit"
          >
            {{ t('ask.submit') }} <span class="ask-submit-icon">↵</span>
          </el-button>
        </div>
      </div>
    </template>

    <!-- Production Board Card -->
    <template v-else-if="ask.type === 'production-board'">
      <div class="ask-header">
        <strong>{{ ask.title }}</strong>
      </div>
      <p>{{ ask.prompt }}</p>
      <div v-if="pbScenes.length" class="pb-section">
        <h4>{{ t('ask.production.scenes') }}</h4>
        <div v-for="scene in pbScenes" :key="scene.id" class="pb-scene">
          <div class="pb-scene-header">
            <strong>{{ scene.name }}</strong>
            <el-tag size="small" :type="scene.status === 'bound' ? 'success' : 'warning'">
              {{ scene.status === 'bound' ? t('ask.production.bound', { mapId: scene.boundMapId }) : t('ask.production.unbound') }}
            </el-tag>
          </div>
          <p v-if="scene.summary" class="pb-summary">{{ scene.summary }}</p>
          <div class="pb-scene-meta">
            <span v-if="scene.mapRequirement">{{ t('ask.production.requirement', { value: scene.mapRequirement }) }}</span>
            <span v-if="scene.visualHint">{{ t('ask.production.visual', { value: scene.visualHint }) }}</span>
          </div>
        </div>
      </div>
      <div v-if="pbEvents.length" class="pb-section">
        <h4>{{ t('ask.production.events') }}</h4>
        <div v-for="event in pbEvents" :key="event.id" class="pb-event">
          <div class="pb-event-header">
            <strong>{{ event.eventName || event.contractId }}</strong>
            <el-tag size="small" :type="event.status === 'placed' ? 'success' : 'info'">
              {{ event.status === 'placed' ? t('ask.production.placed') : t('ask.production.pending') }}
            </el-tag>
          </div>
          <div class="pb-event-meta">
            <span v-if="event.sceneId">{{ t('ask.production.scene', { value: event.sceneId }) }}</span>
            <span v-if="event.targetMapId">{{ t('ask.production.map', { mapId: event.targetMapId }) }}</span>
            <span v-if="event.x != null">({{ event.x }}, {{ event.y }})</span>
          </div>
        </div>
      </div>
      <div v-if="!isLocked" class="ask-actions">
        <el-button type="primary" @click="handleProductionBoardConfirm">{{ t('ask.production.confirm') }}</el-button>
      </div>
    </template>

    <!-- Map Selection Card -->
    <template v-else-if="ask.type === 'map-selection'">
      <div class="ask-header">
        <strong>{{ ask.title }}</strong>
      </div>
      <p>{{ ask.prompt }}</p>
      <p v-if="isLocked" class="map-selection-done">{{ mapSelectionResultText }}</p>
      <div v-if="!isLocked" class="clarify-options">
        <div v-if="mapCandidates.length" class="map-candidate-panel">
          <strong>{{ t('ask.map.existing') }}</strong>
          <el-select v-model="selectedExistingMapId" :placeholder="t('ask.map.selectPlaceholder')">
            <el-option
              v-for="candidate in mapCandidates"
              :key="candidate.mapId"
              :label="t('ask.map.optionLabel', { name: candidate.mapName, mapId: candidate.mapId })"
              :value="candidate.mapId"
            >
              <span>{{ t('ask.map.optionLabel', { name: candidate.mapName, mapId: candidate.mapId }) }}</span>
              <small class="map-candidate-reason">{{ candidate.reason }}</small>
            </el-option>
          </el-select>
          <p v-if="selectedMapCandidate" class="map-candidate-reason">{{ selectedMapCandidate.reason }}</p>
          <el-button
            type="primary"
            :disabled="!selectedExistingMapId"
            @click="handleMapSelectionExisting"
          >
            {{ t('ask.map.useSelected') }}
          </el-button>
        </div>
        <div class="ask-actions">
          <el-button @click="handleMapSelectionAdjust">{{ t('ask.map.adjustStory') }}</el-button>
        </div>
      </div>
    </template>

    <!-- Default Card -->
    <template v-else>
      <div class="ask-header">
        <strong>{{ ask.title }}</strong>
      </div>
      <p>{{ ask.prompt }}</p>
      <div class="ask-actions">
        <el-button type="primary" @click="handleDefaultAction">{{ t('ask.defaultAction') }}</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { renderMarkdown } from '../utils/markdown'
import type { Ask, AskQuestion } from '../utils/askParser'
import {
  buildClarifySingleSelectPayload,
  buildMultiSelectMccAnswer,
  buildSingleSelectMccAnswer,
} from '../utils/askChoiceAnswer'
import { useI18n } from '../i18n'

const props = defineProps<{
  ask: Ask
}>()

const emit = defineEmits<{
  approve: [askId: string]
  revise: [askId: string, feedback: string]
  reject: [askId: string, feedback: string]
  clarify: [askId: string, payload: { answer: string; selected?: string[]; other?: string }]
  'multi-choice': [askId: string, answers: Record<string, { selected: string[]; other: string }>]
  action: [askId: string]
  // 事件放置清单卡片已下线，但放置链路（ChatLog→ChatView 的去地图编排）仍保留；
  // 这些 emit 声明留作类型契约，AskCard 自身不再触发。
  'event-placement-open': [askId: string, contractId: string]
  'event-placement-orchestrate': [askId: string]
  'event-placement-refresh': [askId: string]
  'event-placement-send': [askId: string]
  'production-board-confirm': [askId: string]
  'map-selection-existing': [askId: string, mapId: number]
  'map-selection-adjust': [askId: string]
}>()

const feedback = ref('')
type FeedbackMode = 'none' | 'revise' | 'reject'
const feedbackMode = ref<FeedbackMode>('none')
const selectedExistingMapId = ref<number | null>(null)
const clarifyAnswer = ref('')
const clarifySelected = ref('')
const clarifySelectedMulti = ref<string[]>([])
const clarifyOtherText = ref('')
const currentStep = ref(0)
const selectedOptions = ref<Record<string, string | string[]>>({})
const otherAnswers = ref<Record<string, string>>({})
const { t } = useI18n()

// clarify 单选默认高亮推荐项（无推荐则第一项），让回车可直接提交。
function applyClarifyDefaults() {
  if (props.ask.type !== 'clarify' || props.ask.multiSelect) return
  const options = props.ask.options || []
  if (options.length < 2) return
  if (props.ask.result?.submittedAt) return
  const recommended = options.find((option) => option.recommended)
  clarifySelected.value = recommended?.id || options[0].id
}

function ensureMultiChoiceSelectionDefaults() {
  if (props.ask.type !== 'multi-choice-clarify' || !props.ask.questions?.length) return
  const next = { ...selectedOptions.value }
  let changed = false
  for (const question of props.ask.questions) {
    const current = next[question.id]
    if (question.multiSelect) {
      if (!Array.isArray(current)) {
        next[question.id] = []
        changed = true
      }
    } else if (typeof current !== 'string') {
      next[question.id] = Array.isArray(current) ? String(current[0] || '') : ''
      changed = true
    }
  }
  if (changed) selectedOptions.value = next
}

watch(
  () => props.ask.askId,
  () => {
    currentStep.value = 0
    selectedOptions.value = {}
    otherAnswers.value = {}
    feedback.value = ''
    feedbackMode.value = 'none'
    selectedExistingMapId.value = null
    clarifySelected.value = ''
    clarifySelectedMulti.value = []
    clarifyOtherText.value = ''
    clarifyAnswer.value = ''
    ensureMultiChoiceSelectionDefaults()
    applyClarifyDefaults()
  },
  { immediate: true },
)

watch(
  () => props.ask.questions,
  () => ensureMultiChoiceSelectionDefaults(),
  { deep: true },
)

// 选项在 askId 不变时才到位（如流式补全）也能补上默认高亮。
watch(
  () => props.ask.options,
  () => {
    if (!clarifySelected.value) applyClarifyDefaults()
  },
  { deep: true },
)

const pbScenes = computed(() => (props.ask.sceneSlots || []) as Array<Record<string, any>>)
const mapCandidates = computed(() => props.ask.candidates || [])
const selectedMapCandidate = computed(() =>
  mapCandidates.value.find((candidate) => candidate.mapId === selectedExistingMapId.value),
)
const pbEvents = computed(() => (props.ask.eventPlacements || []) as Array<Record<string, any>>)
const isLocked = computed(() => {
  return Boolean(props.ask.result?.submittedAt || props.ask.result?.failedAt)
})
const isCanceled = computed(() => Boolean(props.ask.result?.canceledAt && !props.ask.result?.submittedAt))
const failureMessage = computed(() => {
  const result = props.ask.result as Record<string, unknown> | null | undefined
  if (!result?.failedAt) return ''
  return result.error
    ? t('ask.submitFailed', { message: String(result.error) })
    : t('ask.submitFailedDefault')
})

const hasClarifyOptions = computed(() => (props.ask.options?.length || 0) >= 2)

// 单行加粗问题：优先用 prompt（出题侧通常把问句放这里），缺省回退 title。
const clarifyQuestion = computed(() => props.ask.prompt?.trim() || props.ask.title || '')

// 提问类兜底项默认开启（始终给出「否，请说明如何调整」），
// 仅当后端显式 allowOther:false 时关闭。
const clarifyAllowOther = computed(() => {
  if (!hasClarifyOptions.value) return false
  return props.ask.allowOther !== false
})

const needsClarifyConfirm = computed(() => hasClarifyOptions.value)

const canSubmitClarify = computed(() => buildClarifyOptionsPayload() !== null)

const clarifyResultDisplay = computed(() => {
  const result = props.ask.result
  if (!result) return ''
  if (result.answer) return String(result.answer)
  const selected = Array.isArray(result.selected) ? result.selected : []
  if (!selected.length) return ''
  return formatClarifySelectionLabels(selected, result.other ? String(result.other) : '')
})

const mapSelectionResultText = computed(() => {
  const result = props.ask.result as Record<string, any> | null | undefined
  if (!result) return t('ask.map.submitted')
  if (result.decision === 'added') return t('ask.map.added')
  if (result.decision === 'use-existing') return t('ask.map.useExistingDone', { mapId: result.selectedMapId })
  if (result.decision === 'adjust-story' || result.decision === 'reject') return t('ask.map.adjustDone')
  if (result.decision === 'jump') return t('ask.map.jumpDone')
  return t('ask.map.submitted')
})

const askCardClass = computed(() => {
  return `ask-card-${props.ask.type}`
})

const ASK_KICKER_LABELS: Record<string, string> = {
  'clarify': 'ask.kicker.waitInput',
  'multi-choice-clarify': 'ask.kicker.waitChoice',
  'plan-approval': 'ask.kicker.waitDecision',
  'risk-approval': 'ask.riskApproval.kicker',
  'production-board': 'ask.kicker.productionBoard',
  'map-selection': 'ask.kicker.mapSelection',
}

const askKicker = computed(() => {
  if (isLocked.value) {
    if (props.ask.type === 'clarify' || props.ask.type === 'multi-choice-clarify') return t('ask.kicker.answered')
    return t('ask.kicker.handled')
  }
  const key = ASK_KICKER_LABELS[props.ask.type] || 'ask.kicker.waitDecision'
  return t(key as Parameters<typeof t>[0])
})

const showPlanFeedback = computed(() => {
  return !isLocked.value && feedbackMode.value !== 'none'
})

const planFeedbackPlaceholder = computed(() => (
  feedbackMode.value === 'reject' ? t('ask.plan.rejectPlaceholder') : t('ask.plan.revisePlaceholder')
))

const reviseButtonLabel = computed(() => (
  feedbackMode.value === 'revise' ? t('ask.plan.submitRevision') : t('ask.plan.revise')
))

const rejectButtonLabel = computed(() => (
  feedbackMode.value === 'reject' ? t('ask.plan.confirmReject') : t('ask.plan.reject')
))

const totalSteps = computed(() => {
  return props.ask.questions?.length || 1
})

const progressPercentage = computed(() => {
  return Math.round(((currentStep.value + 1) / totalSteps.value) * 100)
})

function handleApprove() {
  emit('approve', props.ask.askId)
}

function handleRevise() {
  if (feedbackMode.value !== 'revise') {
    feedbackMode.value = 'revise'
    return
  }
  const text = feedback.value.trim()
  if (!text) {
    ElMessage.warning(t('ask.plan.needRevision'))
    return
  }
  emit('revise', props.ask.askId, text)
}

function handleReject() {
  if (feedbackMode.value !== 'reject') {
    feedbackMode.value = 'reject'
    return
  }
  const text = feedback.value.trim()
  if (!text) {
    ElMessage.warning(t('ask.plan.needRejectReason'))
    return
  }
  emit('reject', props.ask.askId, text)
}

function handleRiskReject() {
  emit('reject', props.ask.askId, '')
}

function handleRiskAlwaysAllow() {
  emit('approve', props.ask.askId)
}

const riskStatusText = computed(() => {
  const status = (props.ask.result as any)?.workflowStatus
  if (status === 'running') return t('ask.riskApproval.statusApproved')
  if (status === 'completed') return t('ask.riskApproval.statusCompleted')
  if (status === 'failed') return t('ask.riskApproval.statusFailed')
  if (status === 'timeout') return t('ask.riskApproval.statusTimeout')
  if (props.ask.result?.decision === 'reject') return t('ask.riskApproval.statusRejected')
  return t('ask.riskApproval.statusApproved')
})

function formatClarifySelectionLabels(selected: string[], otherText: string): string {
  const labels = selected.map((selectedId) => {
    if (selectedId === '__other__') {
      const otherLabel = t('ask.otherLabel')
      return otherText ? `${otherLabel}: ${otherText}` : otherLabel
    }
    const option = props.ask.options?.find((o) => o.id === selectedId)
    return option ? (option.label || option.title || selectedId) : selectedId
  }).filter(Boolean)
  return labels.join(t('ask.separator.list'))
}

function buildClarifyOptionsPayload(): { answer: string; selected: string[]; other: string } | null {
  if (props.ask.multiSelect) {
    const other = clarifyOtherText.value.trim()
    const selected = other ? ['__other__'] : [...clarifySelectedMulti.value]
    if (!selected.length) return null
    const answer = formatClarifySelectionLabels(selected, other)
    if (!answer) return null
    return { answer, selected, other }
  }
  const single = buildClarifySingleSelectPayload(clarifySelected.value, clarifyOtherText.value)
  if (!single) return null
  const answer = formatClarifySelectionLabels(single.selected, single.other)
  if (!answer) return null
  return { answer, selected: single.selected, other: single.other }
}

function emitClarifyPayload(payload: { answer: string; selected?: string[]; other?: string }) {
  emit('clarify', props.ask.askId, payload)
}

function handleClarifySubmit() {
  const text = clarifyAnswer.value.trim()
  if (!text) return
  emitClarifyPayload({ answer: text })
}

function handleClarifyIgnore() {
  emitClarifyPayload({ answer: t('ask.ignoredAnswer') })
}

function handleClarifyOptionsSubmit() {
  const payload = buildClarifyOptionsPayload()
  if (!payload) {
    ElMessage.warning(t('ask.needChoice'))
    return
  }
  emitClarifyPayload(payload)
}

// 单选澄清快捷提交：选中选项后按回车直接提交。
// 在文本框 / textarea 中按回车不拦截，交回输入框自身处理。
function handleCardKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  const inputType = tag === 'INPUT' ? (target as HTMLInputElement).type : ''
  const isTextEntry = tag === 'TEXTAREA' || (tag === 'INPUT' && inputType !== 'radio' && inputType !== 'checkbox')
  if (event.key === 'Escape' && !isLocked.value && !isTextEntry) {
    if (props.ask.type === 'clarify') {
      event.preventDefault()
      handleClarifyIgnore()
      return
    }
    if (props.ask.type === 'multi-choice-clarify') {
      event.preventDefault()
      handleMultiChoiceIgnore()
      return
    }
  }
  // ↑↓ 仅在正向单选项之间移动；调整输入框保持独立。
  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    && !isLocked.value
    && !isTextEntry
    && props.ask.type === 'clarify'
    && !props.ask.multiSelect
    && hasClarifyOptions.value
  ) {
    const ids = (props.ask.options || []).map((option) => option.id)
    if (!ids.length) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const current = ids.indexOf(clarifySelected.value)
    const next = current < 0 ? 0 : (current + delta + ids.length) % ids.length
    clarifySelected.value = ids[next]
    return
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  if (tag === 'TEXTAREA') return
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    if (type !== 'radio' && type !== 'checkbox') return
  }
  if (isLocked.value) return
  if (props.ask.type !== 'clarify' || props.ask.multiSelect || !hasClarifyOptions.value) return
  if (!canSubmitClarify.value) return
  event.preventDefault()
  handleClarifyOptionsSubmit()
}

function handleMultiChoiceSubmit() {
  const answers: Record<string, { selected: string[]; other: string }> = {}

  for (const question of props.ask.questions || []) {
    const built = question.multiSelect
      ? buildMultiSelectMccAnswer(
          (selectedOptions.value[question.id] as string[]) || [],
          otherAnswers.value[question.id] || '',
        )
      : buildSingleSelectMccAnswer(
          String(selectedOptions.value[question.id] || ''),
          otherAnswers.value[question.id] || '',
        )
    if (!built || !built.selected.length) return
    answers[question.id] = built
  }

  emit('multi-choice', props.ask.askId, answers)
}

function handleMultiChoiceIgnore() {
  emit('multi-choice', props.ask.askId, {})
}

function handleProductionBoardConfirm() {
  emit('production-board-confirm', props.ask.askId)
}

function handleMapSelectionExisting() {
  if (!selectedExistingMapId.value) return
  emit('map-selection-existing', props.ask.askId, selectedExistingMapId.value)
}

function handleMapSelectionAdjust() {
  emit('map-selection-adjust', props.ask.askId)
}

function handleDefaultAction() {
  emit('action', props.ask.askId)
}

function getAnswerDisplay(question: AskQuestion): string {
  const answer = props.ask.result?.answers?.[question.id]
  if (!answer) return t('ask.unanswered')
  
  const labels = answer.selected.map(selectedId => {
    if (selectedId === '__other__') {
      const otherLabel = t('ask.otherLabel')
      return answer.other ? `${otherLabel}: ${answer.other}` : otherLabel
    }
    const option = question.options.find(o => o.id === selectedId)
    return option ? option.label : selectedId
  }).filter(Boolean)
  return labels.length ? labels.join(t('ask.separator.list')) : t('ask.unanswered')
}
</script>

<style scoped>
/* 卡片容器见 styles/chat.css */
.ask-card {
  margin: 0;
}

.ask-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

/* 提问正文：紧凑、次级色 */
.ask-header + p {
  margin: 0 0 18px;
  font-size: 15px;
  line-height: 1.55;
  color: var(--app-ink);
}

.ask-header :deep(.el-tag) {
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--app-ink-muted);
  font-size: var(--text-xs);
  font-weight: 500;
}

.ask-header strong {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-ink);
}

.ask-card-clarify .ask-header,
.ask-card-multi-choice-clarify .ask-header {
  margin-bottom: 12px;
}

.ask-card-clarify .ask-header strong,
.ask-card-multi-choice-clarify .ask-header strong {
  font-size: 16px;
  line-height: 1.35;
}

.mcc-progress {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.plan-content {
  background-color: var(--app-bg-soft);
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  margin-bottom: 10px;
  max-height: 200px;
  overflow-y: auto;
}

.plan-details .plan-content {
  margin-top: 8px;
  margin-bottom: 0;
}

.ask-canceled-note {
  margin: 0 0 8px;
  font-size: var(--text-xs);
  color: var(--el-color-warning);
}

.ask-failed-note {
  margin: 0 0 8px;
  padding: 7px 9px;
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: var(--app-radius-sm);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-xs);
}

.ask-details {
  margin: 8px 0 12px;
  border-top: 1px solid var(--app-border);
  border-bottom: 1px solid var(--app-border);
  color: var(--app-ink-soft);
}

.ask-details summary {
  cursor: pointer;
  padding: 7px 0;
  font-size: var(--text-sm);
  color: var(--app-ink-soft);
}

.risk-action-line {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  color: var(--app-ink-soft);
}

.risk-action-line strong {
  color: var(--el-text-color-primary);
  font-weight: 600;
  margin-left: 4px;
}

.risk-script {
  margin: 0 0 10px;
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: var(--app-mono-font, monospace);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.risk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.risk-status {
  margin: 8px 0 0;
  font-size: var(--text-sm);
  color: var(--app-ink-soft);
}

.plan-meta {
  margin-bottom: 8px;
}

.plan-meta dt {
  font-weight: 600;
  color: var(--app-ink-soft);
}

.plan-meta dd {
  margin-left: 16px;
  color: var(--el-text-color-regular);
}

.plan-meta dd code {
  background-color: var(--el-fill-color);
  padding: 2px 4px;
  border-radius: 2px;
  margin-right: 4px;
}

.plan-meta dd ul {
  margin: 0;
  padding-left: 16px;
}

.plan-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--app-border);
}

.plan-feedback {
  margin-top: 12px;
}

/* 单行加粗问题（Codex 风格），替代原 ask-header + 正文两段 */
.ask-question {
  display: block;
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--app-ink);
}

.clarify-options {
  margin-top: 8px;
}

.map-candidate-panel {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-soft);
}

.map-candidate-panel .el-button {
  justify-self: start;
}

.map-candidate-reason {
  display: block;
  margin: 0;
  color: var(--app-ink-soft);
  font-size: var(--text-xs);
}

.clarify-option-group {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  width: 100%;
  counter-reset: askopt;
}

.clarify-option-radio {
  counter-increment: askopt;
  display: flex;
  align-items: center;
  gap: 0;
  height: auto;
  min-height: 40px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  white-space: normal;
  transition: background var(--app-dur) var(--app-ease);
}

.clarify-option-radio:hover {
  border-color: var(--app-accent);
  background: var(--app-bg-soft);
}

.clarify-option-radio.is-checked {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
}

/* 用小序号替代默认单选圆点（Codex 风格）；
   只隐藏圆点本身，保留原生 input 可聚焦，使回车提交生效 */
.clarify-option-radio :deep(.el-radio__inner) {
  display: none;
}

.clarify-option-radio :deep(.el-radio__input) {
  margin: 0;
  width: 0;
  overflow: hidden;
}

.clarify-option-radio::before {
  content: counter(askopt) ".";
  flex: 0 0 auto;
  width: 20px;
  margin-right: 10px;
  text-align: left;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--app-ink-muted);
}

.clarify-option-radio.is-checked::before {
  color: var(--app-ink);
  font-weight: 600;
}

.clarify-option-radio :deep(.el-radio__label) {
  flex: 1;
  min-width: 0;
  padding-left: 0;
  line-height: 1.4;
}

.clarify-option-radio strong {
  color: var(--app-ink);
  font-size: 15px;
  font-weight: 500;
}

.clarify-option-radio small {
  display: block;
  margin-top: 2px;
  color: var(--app-ink-muted);
  font-size: var(--text-xs);
  line-height: 1.35;
}

/* 选项内容：标签单行 + 右侧 ⓘ 提示 */
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.opt-label {
  flex: 1;
  min-width: 0;
  color: var(--app-ink);
  font-size: 15px;
  font-weight: 400;
  line-height: 1.35;
}

.clarify-option-radio.is-checked .opt-label {
  font-weight: 500;
}

/* 推荐项浅色后缀 */
.opt-recommended {
  margin-left: 6px;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--app-ink-muted);
}

/* 当前高亮行右侧的 ↑↓ 键盘导航提示 */
.opt-nav-hint {
  flex: 0 0 auto;
  font-family: var(--app-font-mono);
  font-size: var(--text-xs);
  color: var(--app-ink-muted);
}

.opt-info {
  flex: 0 0 auto;
  color: var(--app-ink-muted);
  font-size: var(--text-sm);
  cursor: help;
}

.opt-info:hover {
  color: var(--app-ink-soft);
}

.ask-adjust-input {
  width: 100%;
  margin-top: 8px;
}

.ask-adjust-input :deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 10px;
  background: transparent;
  box-shadow: 0 0 0 1px var(--app-border) inset;
  transition:
    background var(--app-dur) var(--app-ease),
    box-shadow var(--app-dur) var(--app-ease);
}

.ask-adjust-input :deep(.el-input__wrapper:hover) {
  background: var(--app-bg-soft);
  box-shadow: 0 0 0 1px var(--app-accent) inset;
}

.ask-adjust-input :deep(.el-input__wrapper.is-focus) {
  background: var(--app-bg-soft);
  box-shadow: 0 0 0 2px var(--app-accent) inset;
}

.clarify-confirm-btn {
  min-width: 84px;
  min-height: 40px;
  margin: 0;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
}

/* 卡片底部操作区：右对齐，主按钮在最右（Codex 风格） */
.ask-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
  padding-top: 0;
}

.ask-kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--app-ink-muted);
}

.ask-kbd-hint kbd,
.ask-ignore-btn kbd {
  min-width: 16px;
  padding: 1px 5px;
  font-family: var(--app-font-mono);
  font-size: var(--text-xs);
  color: var(--app-ink-soft);
  background: var(--app-bg-sunken);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
}

.ask-ignore-btn {
  min-height: 36px;
  margin-left: auto;
  padding: 0 8px;
  color: var(--app-ink-muted);
  font-size: 14px;
  font-weight: 500;
}

.ask-ignore-btn kbd {
  margin-left: 4px;
  color: var(--app-ink-muted);
}

.ask-submit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  border-radius: 6px;
  background: rgba(255, 255, 255, .16);
  font-family: var(--app-font-mono);
  font-size: 12px;
}

.clarify-input {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.clarify-answer blockquote {
  background-color: var(--app-bg-sunken);
  padding: 12px;
  border-left: 3px solid var(--app-border-strong);
  margin: 0;
  border-radius: 0 var(--app-radius-md) var(--app-radius-md) 0;
}

.mcc-steps {
  margin: 12px 0 0;
}

.ask-card-multi-choice-clarify :deep(.el-progress) {
  margin: 2px 0 8px;
}

.mcc-step h4 {
  margin: 0 0 8px 0;
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
}

.mcc-step p {
  margin: 0 0 12px 0;
  color: var(--app-ink);
  font-size: 15px;
  line-height: 1.55;
}

.mcc-options {
  list-style: none;
  padding: 0;
  margin: 0;
}

.mcc-option {
  min-height: 40px;
  padding: 7px 10px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  transition: background var(--app-dur) var(--app-ease);
}

.mcc-option:hover {
  border-color: var(--app-accent);
  background: var(--app-bg-soft);
}

.mcc-option:has(.el-checkbox.is-checked) {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
}

.mcc-option:not(.clarify-option-radio) {
  counter-increment: askopt;
  display: flex;
  align-items: center;
  min-height: 34px;
}

.mcc-option:not(.clarify-option-radio)::before {
  content: counter(askopt) ".";
  flex: 0 0 auto;
  width: 20px;
  margin-right: 10px;
  text-align: left;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--app-ink-muted);
}

.mcc-option label,
.mcc-option :deep(.el-checkbox) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: auto;
}

.mcc-option :deep(.el-checkbox__label) {
  flex: 1;
  min-width: 0;
  padding-left: var(--space-2);
}

.mcc-option strong {
  color: var(--app-ink);
  font-weight: 500;
}

.mcc-answers dl {
  margin: 8px 0;
}

.mcc-answers dt {
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.mcc-answers dd {
  margin-left: 16px;
  color: var(--el-text-color-regular);
}

.mcc-status {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.mcc-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}

.mcc-step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

@media (max-width: 720px) {
  .ask-card {
    padding: 16px;
  }

  .ask-header {
    align-items: flex-start;
  }

  .ask-footer,
  .mcc-footer,
  .plan-actions {
    justify-content: flex-end;
  }

  .ask-ignore-btn {
    margin-left: 0;
  }

  .clarify-confirm-btn {
    flex: 1 1 120px;
  }

  .ask-kbd-hint {
    display: none;
  }
}

.ask-option-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 10px;
  border-top: 1px solid var(--app-border);
}

.ask-option {
  background-color: transparent;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--app-border);
}

.ask-option.selected {
  padding-left: 8px;
  background-color: var(--app-accent-soft);
  box-shadow: inset 2px 0 0 var(--app-accent);
}

.ask-option strong {
  color: var(--el-text-color-primary);
}

.ask-option p {
  margin: 8px 0;
  color: var(--el-text-color-regular);
}

.ask-meta {
  margin-bottom: 12px;
}

.ask-meta dt {
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.ask-meta dd {
  margin-left: 16px;
  color: var(--el-text-color-regular);
}

.ask-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

/* Production Board */
.pb-section {
  margin: 12px 0;
}

.pb-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.pb-scene, .pb-event {
  background-color: transparent;
  padding: 9px 0;
  border-bottom: 1px solid var(--app-border);
  border-radius: 0;
  margin-bottom: 0;
}

.pb-scene-header, .pb-event-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.pb-summary {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.pb-scene-meta, .pb-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
