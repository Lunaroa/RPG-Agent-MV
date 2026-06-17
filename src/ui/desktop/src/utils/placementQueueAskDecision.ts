import type { Ask, AskQuestion } from './askParser.ts'

export type PlacementQueueDecision = 'apply' | 'revise' | 'cancel'

const PLACEMENT_QUEUE_PROMPT = /应用到待放置队列|待放置队列/

function optionLabel(question: AskQuestion, selectedId: string): string {
  if (selectedId === '__other__') return ''
  const option = (question.options || []).find((entry) => entry.id === selectedId)
  return String(option?.label || option?.title || selectedId).trim()
}

function classifyPlacementLabel(label: string): PlacementQueueDecision | null {
  const normalized = label.trim()
  if (!normalized) return null
  if (normalized === '应用' || /^apply$/i.test(normalized)) return 'apply'
  if (normalized === '调整' || normalized === '要改' || /^revise$/i.test(normalized)) return 'revise'
  if (normalized === '取消' || /^cancel/i.test(normalized)) return 'cancel'
  return null
}

export function isPlacementQueueReviewAsk(ask: Pick<Ask, 'questions'>): boolean {
  return (ask.questions || []).some((question) => {
    const text = `${question.header || ''} ${question.question || question.id || ''}`
    return PLACEMENT_QUEUE_PROMPT.test(text)
  })
}

export function resolvePlacementQueueDecision(
  ask: Pick<Ask, 'questions'>,
  answers: Record<string, { selected: string[]; other: string }>,
): PlacementQueueDecision | null {
  for (const question of ask.questions || []) {
    const text = `${question.header || ''} ${question.question || question.id || ''}`
    if (!PLACEMENT_QUEUE_PROMPT.test(text)) continue
    const answer = answers[question.id] || { selected: [], other: '' }
    for (const selectedId of answer.selected || []) {
      const decision = classifyPlacementLabel(optionLabel(question, selectedId))
      if (decision) return decision
    }
    const otherDecision = classifyPlacementLabel(String(answer.other || '').trim())
    if (otherDecision) return otherDecision
  }
  return null
}
