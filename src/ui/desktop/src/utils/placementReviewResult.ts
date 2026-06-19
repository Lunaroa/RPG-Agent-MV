import type { Ask, AskQuestion } from './askParser.ts'

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

const PLACEMENT_REVIEW_TEXT = /应用到待放置队列|待放置队列|待放置事件/

function placementQuestionText(question: AskQuestion): string {
  return `${question.header || ''} ${question.question || ''} ${question.id || ''}`.trim()
}

function isPlacementReviewQuestion(question: AskQuestion): boolean {
  return PLACEMENT_REVIEW_TEXT.test(placementQuestionText(question))
}

function decisionLabel(decision: PlacementReviewDecision): string {
  if (decision === 'approve') return '确认'
  if (decision === 'reject') return '拒绝'
  return '调整'
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

export function summarizePlacementReviewActions(actions: PlacementReviewAction[]): string {
  const approved = actions.filter((action) => action.decision === 'approve').length
  const rejected = actions.filter((action) => action.decision === 'reject').length
  const revised = actions.filter((action) => action.decision === 'revise').length
  return [
    approved ? `确认 ${approved}` : '',
    rejected ? `拒绝 ${rejected}` : '',
    revised ? `调整 ${revised}` : '',
  ].filter(Boolean).join('，') || '没有事件变更'
}

export function formatPlacementReviewAnswer(
  actions: PlacementReviewAction[],
  overallFeedback = '',
): string {
  const lines = [
    `本轮待放置事件已逐条处理：${summarizePlacementReviewActions(actions)}。`,
  ]
  const feedback = overallFeedback.trim()
  if (feedback) lines.push(`总体调整意见：${feedback}`)
  for (const action of actions) {
    const details = [
      `${decisionLabel(action.decision)}：${action.eventName || action.contractId}`,
      `contractId=${action.contractId}`,
      action.targetMapId ? `建议地图=Map${String(action.targetMapId).padStart(3, '0')}` : '',
      action.feedback ? `意见=${action.feedback}` : '',
    ].filter(Boolean)
    lines.push(`- ${details.join('；')}`)
  }
  return lines.join('\n')
}

export function buildPlacementReviewAnswers(
  ask: Pick<Ask, 'questions'>,
  actions: PlacementReviewAction[],
  overallFeedback = '',
): Record<string, { selected: string[]; other: string }> {
  const questions = ask.questions || []
  const targets = questions.filter(isPlacementReviewQuestion)
  const selectedQuestions = targets.length ? targets : questions.slice(0, 1)
  const answer = formatPlacementReviewAnswer(actions, overallFeedback)
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
): string {
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
    '这是 agent-console 的人工待放置事件审阅结果。请只基于用户已确认、已拒绝、要求调整的事件继续；已确认事件已经进入待放置队列，要求调整的事件需要重新生成或修改。',
    JSON.stringify(result, null, 2),
  ].join('\n\n')
}
