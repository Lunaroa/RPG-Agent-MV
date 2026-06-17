import type { Ask, AskOption, AskResult } from './askParser.ts'
import { isPlacementEventDone } from './placementStatus.ts'

export interface AskHistoryPair {
  question: string
  answer: string
}

export function buildAskHistoryPairs(ask: Ask): AskHistoryPair[] {
  if (!ask.result?.submittedAt) return []
  if (ask.type === 'multi-choice-clarify' && ask.questions?.length) {
    return ask.questions.map((question) => ({
      question: question.question?.trim() || question.header?.trim() || question.id,
      answer: formatChoiceAnswer(
        ask.result?.answers?.[question.id],
        question.options,
      ),
    }))
  }

  return [{
    question: askQuestion(ask),
    answer: askAnswer(ask),
  }]
}

function askQuestion(ask: Ask): string {
  if (ask.type === 'clarify') return ask.prompt?.trim() || ask.title || '等待输入'
  const title = String(ask.title || '').trim()
  const prompt = String(ask.prompt || '').trim()
  if (title && prompt && title !== prompt) return `${title}\n${prompt}`
  return title || prompt || '等待决策'
}

function askAnswer(ask: Ask): string {
  const result = ask.result || {}
  if (ask.type === 'clarify') {
    return String(result.answer || '').trim()
      || formatChoiceAnswer({ selected: result.selected || [], other: String(result.other || '') }, ask.options)
  }
  if (ask.type === 'plan-approval') return formatPlanResult(result)
  if (ask.type === 'map-selection') return formatMapSelectionResult(result)
  if (ask.type === 'event-placement-list') return formatPlacementResult(ask, result)
  if (ask.type === 'production-board') {
    return result.confirmed || result.decision === 'confirmed' ? '确认制作清单' : '已处理制作清单'
  }
  return formatFallbackResult(result)
}

function formatChoiceAnswer(
  answer: { selected?: string[]; other?: string } | null | undefined,
  options: AskOption[] | undefined,
): string {
  const selected = answer?.selected || []
  const labels = selected.map((id) => {
    if (id === '__other__') return answer?.other ? String(answer.other) : '其他'
    const option = options?.find((item) => item.id === id)
    return String(option?.label || option?.title || id)
  })
  if (answer?.other && !selected.includes('__other__')) labels.push(String(answer.other))
  return labels.filter(Boolean).join('、') || '已提交'
}

function formatPlanResult(result: AskResult): string {
  if (result.decision === 'approve') return '批准并执行'
  if (result.decision === 'revise') return result.feedback ? `要求修改计划：${result.feedback}` : '要求修改计划'
  if (result.decision === 'reject') return result.feedback ? `拒绝计划：${result.feedback}` : '拒绝计划'
  return formatFallbackResult(result)
}

function formatMapSelectionResult(result: AskResult): string {
  if (result.decision === 'added') return `使用新增地图 #${result.selectedMapId || result.importedMapId || ''}`.trim()
  if (result.decision === 'use-existing') return `使用现有地图 #${result.selectedMapId || ''}`.trim()
  if (result.decision === 'adjust-story' || result.decision === 'reject') return '调整剧情以适配现有地图'
  if (result.decision === 'jump') return '前往地图制作'
  return formatFallbackResult(result)
}

function formatPlacementResult(ask: Ask, result: AskResult): string {
  const events = (Array.isArray(result.events) ? result.events : ask.events || []) as Array<Record<string, unknown>>
  const lines = events.map((event) => {
    const name = String(event.eventName || event.contractId || event.id || '事件')
    if (!isPlacementEventDone({
      status: String(event.status || ''),
      placedEventId: event.placedEventId as number | null | undefined,
      x: event.x as number | null | undefined,
      y: event.y as number | null | undefined,
    })) return `${name}：未放置`
    const mapId = Number(event.targetMapId || event.mapId || 0)
    const coords = Number.isInteger(event.x) && Number.isInteger(event.y) ? ` (${event.x}, ${event.y})` : ''
    return `${name}：已放置${mapId ? `到 Map${mapId}` : ''}${coords}`
  })
  const summary = result.placed ? '事件已全部放置' : result.partial ? '已报告部分放置结果' : '事件放置已处理'
  return lines.length ? `${summary}\n${lines.join('\n')}` : summary
}

function formatFallbackResult(result: AskResult): string {
  if (result.answer) return String(result.answer)
  if (result.feedback) return String(result.feedback)
  if (result.decision) return String(result.decision)
  return '已提交'
}
