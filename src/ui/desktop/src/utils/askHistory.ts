import type { Ask, AskOption, AskResult } from './askParser.ts'
import { isPlacementEventDone } from './placementStatus.ts'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export interface AskHistoryPair {
  question: string
  answer: string
}

export function buildAskHistoryPairs(ask: Ask, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): AskHistoryPair[] {
  const normalizedLanguage = normalizeProductLanguage(language)
  if (!ask.result?.submittedAt) return []
  if (ask.type === 'multi-choice-clarify' && ask.questions?.length) {
    return ask.questions.map((question) => ({
      question: question.question?.trim() || question.header?.trim() || question.id,
      answer: formatChoiceAnswer(
        ask.result?.answers?.[question.id],
        question.options,
        normalizedLanguage,
      ),
    }))
  }

  return [{
    question: askQuestion(ask, normalizedLanguage),
    answer: askAnswer(ask, normalizedLanguage),
  }]
}

function askQuestion(ask: Ask, language: ProductLanguage): string {
  if (ask.type === 'clarify') return ask.prompt?.trim() || ask.title || translate('ask.history.waitingInput', language)
  const title = String(ask.title || '').trim()
  const prompt = String(ask.prompt || '').trim()
  if (title && prompt && title !== prompt) return `${title}\n${prompt}`
  return title || prompt || translate('ask.history.waitingDecision', language)
}

function askAnswer(ask: Ask, language: ProductLanguage): string {
  const result = ask.result || {}
  if (ask.type === 'clarify') {
    return String(result.answer || '').trim()
      || formatChoiceAnswer({ selected: result.selected || [], other: String(result.other || '') }, ask.options, language)
  }
  if (ask.type === 'plan-approval') return formatPlanResult(result, language)
  if (ask.type === 'map-selection') return formatMapSelectionResult(result, language)
  if (ask.type === 'event-placement-list') return formatPlacementResult(ask, result, language)
  if (ask.type === 'production-board') {
    return result.confirmed || result.decision === 'confirmed'
      ? translate('ask.history.productionConfirmed', language)
      : translate('ask.history.productionHandled', language)
  }
  return formatFallbackResult(result, language)
}

function formatChoiceAnswer(
  answer: { selected?: string[]; other?: string } | null | undefined,
  options: AskOption[] | undefined,
  language: ProductLanguage,
): string {
  const selected = answer?.selected || []
  const labels = selected.map((id) => {
    if (id === '__other__') return answer?.other ? String(answer.other) : translate('ask.history.other', language)
    const option = options?.find((item) => item.id === id)
    return String(option?.label || option?.title || id)
  })
  if (answer?.other && !selected.includes('__other__')) labels.push(String(answer.other))
  return labels.filter(Boolean).join(translate('ask.separator.list', language)) || translate('ask.history.submitted', language)
}

function formatPlanResult(result: AskResult, language: ProductLanguage): string {
  if (result.decision === 'approve') return translate('ask.history.planApproved', language)
  if (result.decision === 'revise') return result.feedback
    ? translate('ask.history.planReviseWithFeedback', language, { feedback: result.feedback })
    : translate('ask.history.planRevise', language)
  if (result.decision === 'reject') return result.feedback
    ? translate('ask.history.planRejectWithFeedback', language, { feedback: result.feedback })
    : translate('ask.history.planReject', language)
  return formatFallbackResult(result, language)
}

function formatMapSelectionResult(result: AskResult, language: ProductLanguage): string {
  if (result.decision === 'added') return translate('ask.history.useNewMap', language, { id: String(result.selectedMapId || result.importedMapId || '') }).trim()
  if (result.decision === 'use-existing') return translate('ask.history.useExistingMap', language, { id: String(result.selectedMapId || '') }).trim()
  if (result.decision === 'adjust-story' || result.decision === 'reject') return translate('ask.history.adjustStory', language)
  if (result.decision === 'jump') return translate('ask.history.goToMapProduction', language)
  return formatFallbackResult(result, language)
}

function formatPlacementResult(ask: Ask, result: AskResult, language: ProductLanguage): string {
  const events = (Array.isArray(result.events) ? result.events : ask.events || []) as Array<Record<string, unknown>>
  const lines = events.map((event) => {
    const name = String(event.eventName || event.contractId || event.id || translate('ask.history.event', language))
    if (!isPlacementEventDone({
      status: String(event.status || ''),
      placedEventId: event.placedEventId as number | null | undefined,
      x: event.x as number | null | undefined,
      y: event.y as number | null | undefined,
    })) return translate('ask.history.eventNotPlaced', language, { name })
    const mapId = Number(event.targetMapId || event.mapId || 0)
    const coords = Number.isInteger(event.x) && Number.isInteger(event.y) ? ` (${event.x}, ${event.y})` : ''
    const mapPart = mapId ? translate('ask.history.onMap', language, { mapId }) : ''
    return translate('ask.history.eventPlaced', language, { name, mapPart, coords })
  })
  const summary = result.placed
    ? translate('ask.history.allPlaced', language)
    : result.partial
      ? translate('ask.history.partialPlaced', language)
      : translate('ask.history.placementHandled', language)
  return lines.length ? `${summary}\n${lines.join('\n')}` : summary
}

function formatFallbackResult(result: AskResult, language: ProductLanguage): string {
  if (result.answer) return String(result.answer)
  if (result.feedback) return String(result.feedback)
  if (result.decision) return String(result.decision)
  return translate('ask.history.submitted', language)
}
