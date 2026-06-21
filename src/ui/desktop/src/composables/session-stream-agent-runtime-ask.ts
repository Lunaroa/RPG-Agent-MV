import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export type OpencodeAsk = {
  type: 'plan-approval' | 'multi-choice-clarify'
  askId: string
  title: string
  prompt: string
  planMarkdown?: string
  affectedFiles?: string[]
  questions?: Array<{
    id: string
    header: string
    question: string
    multiSelect: boolean
    allowOther: boolean
    options: Array<{ id: string; label: string; description: string }>
  }>
  fromMcp: boolean
  createdAt: string
  result: null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}


export function askFromOpencodeRequest(event: {
  request?: unknown
  request_id?: unknown
}, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): OpencodeAsk | null {
  language = normalizeProductLanguage(language)
  const request = asRecord(event.request)
  if (request.subtype !== 'can_use_tool') return null
  const toolName = asString(request.tool_name)
  const requestId = asString(event.request_id)
  const input = asRecord(request.input)
  if (!requestId) return null

  if (toolName === 'ExitPlanMode') {
    return {
      type: 'plan-approval',
      askId: `agent-runtime-plan:${requestId}`,
      title: translate('agent.ask.planPendingApproval', language),
      prompt: asString(request.description) || translate('agent.ask.reviewPlan', language),
      planMarkdown: asString(input.plan),
      affectedFiles: asString(input.planFilePath) ? [asString(input.planFilePath)] : [],
      fromMcp: true,
      createdAt: new Date().toISOString(),
      result: null,
    }
  }

  if (toolName === 'AskUserQuestion') {
    const rawQuestions = Array.isArray(input.questions) ? input.questions.map(asRecord) : []
    const questions = rawQuestions.map((question, index) => {
      const fallbackQuestion = translate('agent.ask.questionN', language, { index: index + 1 })
      const questionText = asString(question.question) || fallbackQuestion
      const options = (Array.isArray(question.options) ? question.options.map(asRecord) : [])
        .map((option) => {
          const label = asString(option.label)
          return {
            id: label,
            label,
            description: asString(option.description),
          }
        })
        .filter((option) => option.label)
      return {
        id: questionText,
        header: asString(question.header) || fallbackQuestion,
        question: questionText,
        multiSelect: question.multiSelect === true,
        allowOther: true,
        options,
      }
    }).filter((question) => question.options.length >= 2)
    if (!questions.length) return null
    return {
      type: 'multi-choice-clarify',
      askId: `agent-runtime-ask:${requestId}`,
      title: translate('agent.ask.waitingForInput', language),
      prompt: asString(request.description) || translate('agent.ask.answerClarification', language),
      questions,
      fromMcp: true,
      createdAt: new Date().toISOString(),
      result: null,
    }
  }

  return null
}

export function isAskUserQuestionBridgeFailure(
  event: { tool?: unknown; success?: unknown },
  existingToolName?: unknown
): boolean {
  const tool = String(existingToolName || event.tool || '')
  return tool === 'AskUserQuestion' && event.success === false
}
