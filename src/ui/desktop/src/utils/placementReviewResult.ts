import type { Ask, AskQuestion } from './askParser.ts'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate, type MessageKey } from '../i18n/messages.ts'

export type PlacementReviewDecision = 'approve' | 'reject' | 'revise'

export interface PlacementReviewAction {
  askId: string
  contractId: string
  eventName: string
  decision: PlacementReviewDecision
  feedback?: string
  targetMapId?: number | null
  summary?: string
  decidedAt: string
}

export interface PlacementReviewBatch {
  askId: string
  sessionId: string
  actions: PlacementReviewAction[]
  completedAt: string
}

const PLACEMENT_REVIEW_TEXT = /应用到待放置队列|待放置队列|待放置事件|pending placement queue|pending placement event|placement queue/i

function placementQuestionText(question: AskQuestion): string {
  return `${question.header || ''} ${question.question || ''} ${question.id || ''}`.trim()
}

function isPlacementReviewQuestion(question: AskQuestion): boolean {
  return PLACEMENT_REVIEW_TEXT.test(placementQuestionText(question))
}

function decisionLabel(decision: PlacementReviewDecision, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  const normalized = normalizeProductLanguage(language)
  const keyMap: Record<PlacementReviewDecision, MessageKey> = {
    approve: 'placement.review.decision.approve',
    reject: 'placement.review.decision.reject',
    revise: 'placement.review.decision.revise',
  }
  return translate(keyMap[decision], normalized)
}

export function placementReviewDecision(actions: PlacementReviewAction[]): string {
  const decisions = new Set(actions.map((action) => action.decision))
  if (decisions.size === 1) {
    const only = actions[0]?.decision
    if (only === 'approve') return 'approve'
    if (only === 'reject') return 'reject'
    if (only === 'revise') return 'revise'
  }
  if (decisions.has('revise')) return 'revise'
  return 'mixed'
}

export function summarizePlacementReviewActions(actions: PlacementReviewAction[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  const lang = normalizeProductLanguage(language)
  const approved = actions.filter((action) => action.decision === 'approve').length
  const rejected = actions.filter((action) => action.decision === 'reject').length
  const revised = actions.filter((action) => action.decision === 'revise').length
  const parts: string[] = []
  if (approved) parts.push(translate('placement.review.summary.approved', lang, { count: String(approved) }))
  if (rejected) parts.push(translate('placement.review.summary.rejected', lang, { count: String(rejected) }))
  if (revised) parts.push(translate('placement.review.summary.revised', lang, { count: String(revised) }))
  const separator = translate('ask.separator.list', lang)
  return parts.join(separator) || translate('placement.review.summary.empty', lang)
}

export function formatPlacementReviewAnswer(
  actions: PlacementReviewAction[],
  overallFeedback = '',
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): string {
  const lang = normalizeProductLanguage(language)
  const summary = summarizePlacementReviewActions(actions, language)
  const lines = [
    translate('placement.review.intro', lang, { summary }),
  ]
  const feedback = overallFeedback.trim()
  if (feedback) lines.push(translate('placement.review.feedbackPrefix', lang, { feedback }))
  for (const action of actions) {
    const details = [
      translate('placement.review.detailLabelPrefix', lang, {
        decision: decisionLabel(action.decision, language),
        name: action.eventName || action.contractId,
      }),
      `contractId=${action.contractId}`,
      action.targetMapId ? translate('placement.review.suggestedMapField', lang, { mapId: String(action.targetMapId).padStart(3, '0') }) : '',
      action.feedback ? translate('placement.review.feedbackField', lang, { feedback: action.feedback }) : '',
    ].filter(Boolean)
    const separator = translate('ui.separator.semicolon', lang)
    lines.push(`- ${details.join(separator)}`)
  }
  return lines.join('\n')
}

export function buildPlacementReviewAnswers(
  ask: Pick<Ask, 'questions'>,
  actions: PlacementReviewAction[],
  overallFeedback = '',
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): Record<string, { selected: string[]; other: string }> {
  const normalized = normalizeProductLanguage(language)
  const questions = ask.questions || []
  const targets = questions.filter(isPlacementReviewQuestion)
  const selectedQuestions = targets.length ? targets : questions.slice(0, 1)
  const answer = formatPlacementReviewAnswer(actions, overallFeedback, normalized)
  const result: Record<string, { selected: string[]; other: string }> = {}
  for (const question of selectedQuestions) {
    const value = { selected: ['__other__'], other: answer }
    if (question.id) result[question.id] = value
    if (question.question) result[question.question] = value
    if (question.header) result[question.header] = value
  }
  return result
}

export function formatPlacementReviewContinuationIntent(
  ask: Pick<Ask, 'askId'>,
  actions: PlacementReviewAction[],
  overallFeedback = '',
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): string {
  const lang = normalizeProductLanguage(language)
  const result = {
    type: 'event-placement-review-result',
    askId: ask.askId,
    decision: placementReviewDecision(actions),
    overallFeedback: overallFeedback.trim() || null,
    actions: actions.map((action) => ({
      contractId: action.contractId,
      eventName: action.eventName,
      decision: action.decision,
      feedback: action.feedback || null,
      targetMapId: action.targetMapId ?? null,
      summary: action.summary || null,
      decidedAt: action.decidedAt,
    })),
  }
  return [
    translate('placement.review.continuationIntro', lang),
    JSON.stringify(result, null, 2),
  ].join('\n\n')
}
