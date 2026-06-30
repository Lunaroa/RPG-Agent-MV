import { resolveAskContextMapId, resolveEventMapIdWithAsk } from './placementMapId.ts'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

/** Treat only real booleans / 0|1 / "true"|"false" as flags; avoid Boolean("false") === true. */
export function parseOptionalBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value == null) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === '') return false
  }
  return Boolean(value)
}

type AskOptionDraft = { id: string; label: string; description: string }

function uniqueOptionIds(options: AskOptionDraft[]): AskOptionDraft[] {
  const seen = new Set<string>()
  return options.map((option, index) => {
    let id = option.id
    if (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    return id === option.id ? option : { ...option, id }
  })
}

// Normalizes ASK card types from either an <agent-console-ask> JSON text block
// or an ask-mcp tool call.

export interface AskResult {
  submittedAt?: string
  failedAt?: string
  canceledAt?: string
  sessionEndedAt?: string
  cancellationStatus?: string
  decision?: string
  feedback?: string
  answer?: string
  selected?: string[]
  other?: string
  saving?: boolean
  error?: string
  answers?: Record<string, { selected: string[]; other: string }>
  [key: string]: unknown
}

export function isAskResultLocked(result: AskResult | null | undefined): boolean {
  if (!result) return false
  if (result.submittedAt || result.failedAt) return true
  if (result.canceledAt) {
    return result.cancellationStatus !== 'pass'
  }
  return false
}

/** ASK 所在回合已结束，但用户仍可续答（例如 pass 终态）。 */
export function isAskContinuationOpen(result: AskResult | null | undefined): boolean {
  if (!result || result.submittedAt || result.failedAt) return false
  if (result.sessionEndedAt) return true
  return Boolean(result.canceledAt && result.cancellationStatus === 'pass')
}

export interface AskOption {
  id: string
  title?: string
  summary?: string
  label?: string
  description?: string
  recommended?: boolean
}

export interface AskQuestion {
  id: string
  header?: string
  question?: string
  multiSelect?: boolean
  allowOther?: boolean
  options: AskOption[]
}

export interface Ask {
  type: string
  askId: string
  title: string
  prompt: string
  fromMcp?: boolean
  planMarkdown?: string
  risks?: string[]
  affectedFiles?: string[]
  fieldName?: string
  placeholder?: string
  multiSelect?: boolean
  allowOther?: boolean
  questions?: AskQuestion[]
  options?: AskOption[]
  summary?: string
  events?: Array<Record<string, unknown>>
  result?: AskResult | null
  createdAt?: string
  // event-placement-list
  modifications?: Array<Record<string, unknown>>
  returnAgentId?: string
  // production-board
  sceneSlots?: Array<Record<string, unknown>>
  eventPlacements?: Array<Record<string, unknown>>
  // map-selection
  min?: number
  max?: number
  targetParentId?: number | null
  candidates?: Array<{ mapId: number; mapName: string; reason: string }>
  [key: string]: unknown
}

interface ParseOptions {
  createAskId?: () => string
  getPrevious?: (askId: string) => Ask | null | undefined
  language?: ProductLanguage
}

export function filterPostAskFallbackText(text: string): string {
  return String(text || '').split(/\r?\n/)
    .filter((line) => {
      const value = line.trim()
      if (!value) return true
      return !/(选好了.*告诉我编号|告诉我编号|回复编号|告诉我.*编号|选定.*编号|选好.*编号)/.test(value)
    })
    .join('\n')
}

function stripJsonFence(text: string): string {
  const value = String(text || '').trim()
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : value
}

function addJsonCandidate(candidates: string[], value: string): void {
  const text = stripJsonFence(value)
  if (!text || candidates.includes(text)) return
  candidates.push(text)
}

function collectJsonCandidates(rawText: string): string[] {
  const candidates: string[] = []
  addJsonCandidate(candidates, rawText)

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (candidate.includes('\\"')) addJsonCandidate(candidates, candidate.replace(/\\"/g, '"'))

    const firstObject = candidate.indexOf('{')
    const lastObject = candidate.lastIndexOf('}')
    if (firstObject >= 0 && lastObject > firstObject) addJsonCandidate(candidates, candidate.slice(firstObject, lastObject + 1))

    const firstArray = candidate.indexOf('[')
    const lastArray = candidate.lastIndexOf(']')
    if (firstArray >= 0 && lastArray > firstArray) addJsonCandidate(candidates, candidate.slice(firstArray, lastArray + 1))
  }

  return candidates
}

function parseAgentAskJson(rawText: string): any {
  const candidates = collectJsonCandidates(rawText)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === 'string') {
        const nested = parseAgentAskJson(parsed)
        if (nested) return nested
        continue
      }
      return parsed
    } catch {
      // Try the next normalized form. LLMs often escape the whole JSON object.
    }
  }
  return null
}

export function parseAgentAsk(rawText: string, options: ParseOptions = {}): Ask | null {
  try {
    const language = normalizeProductLanguage(options.language ?? DEFAULT_PRODUCT_LANGUAGE)
    const raw = parseAgentAskJson(rawText)
    if (!raw || !raw.type) return null
    const askId = String(raw.askId || (options.createAskId && options.createAskId()) || `ask-${Date.now()}`)
    const previous = options.getPrevious ? options.getPrevious(askId) : null
    let ask: Ask | null = null
    if (raw.type === 'map-selection') {
      const min = Math.max(1, Number(raw.min || 1) || 1)
      const max = Math.max(min, Number(raw.max || min) || min)
      ask = {
        type: 'map-selection',
        askId,
        title: String(raw.title || translate('ask.parser.mapSelectionTitle', language)),
        prompt: String(raw.prompt || ''),
        min,
        max,
        targetParentId: raw.targetParentId == null ? null : Number(raw.targetParentId) || 0,
        candidates: Array.isArray(raw.candidates)
          ? raw.candidates
            .map((candidate: any) => ({
              mapId: Number(candidate?.mapId) || 0,
              mapName: String(candidate?.mapName || ''),
              reason: String(candidate?.reason || ''),
            }))
            .filter((candidate: { mapId: number; mapName: string; reason: string }) => candidate.mapId > 0 && candidate.mapName)
          : [],
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      }
    } else if (raw.type === 'event-placement-list') {
      const events = Array.isArray(raw.events) ? raw.events : []
      const previousEvents = new Map((((previous && previous.events) || []) as any[])
        .map((event: any) => [event.contractId || event.id, event]))
      const askContext = {
        title: String(raw.title || previous?.title || translate('ask.parser.placeEventTitle', language)),
        prompt: String(raw.prompt || previous?.prompt || translate('ask.parser.placeEventPrompt', language)),
      }
      const askLevelMapId = resolveAskContextMapId(askContext)
      ask = {
        type: 'event-placement-list',
        askId,
        title: askContext.title,
        prompt: askContext.prompt,
        events: events.map((event: any, index: number) => {
          const contractId = String(event.contractId || event.id || `event-${index + 1}`)
          const prior: any = previousEvents.get(contractId) || {}
          return {
            id: contractId,
            contractId,
            eventName: String(event.eventName || prior.eventName || ''),
            targetMapId: resolveEventMapIdWithAsk(event, askContext)
              ?? resolveEventMapIdWithAsk(prior, askContext)
              ?? askLevelMapId,
            mapId: event.mapId ?? prior.mapId ?? null,
            sceneId: String(event.sceneId || prior.sceneId || ''),
            questline: String(event.questline || prior.questline || ''),
            summary: String(event.summary || event.purpose || prior.summary || ''),
            placementHint: String(event.placementHint || event.hint || prior.placementHint || ''),
            trigger: String(event.trigger || prior.trigger || ''),
            status: String(prior.status || event.status || 'draft'),
            placedEventId: prior.placedEventId || event.eventId || null,
            x: Number.isInteger(prior.x) ? prior.x : event.x,
            y: Number.isInteger(prior.y) ? prior.y : event.y
          }
        }),
        modifications: (Array.isArray(raw.modifications) ? raw.modifications : []).map((item: any, index: number) => ({
          id: String(item.id || `mod-${index + 1}`),
          kind: String(item.kind || item.type || 'existing-event-edit'),
          mapId: item.mapId == null ? null : Number(item.mapId) || null,
          eventId: item.eventId == null ? null : Number(item.eventId) || null,
          pageIndex: item.pageIndex == null ? null : Number(item.pageIndex),
          summary: String(item.summary || item.description || ''),
          routeTo: String(item.routeTo || 'rmmv-editor')
        })),
        returnAgentId: String(raw.returnAgentId || 'rmmv-director'),
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      } as Ask
    } else if (raw.type === 'plan-approval') {
      const planMarkdown = String(raw.planMarkdown || raw.plan || raw.markdown || '').trim()
      ask = {
        type: 'plan-approval',
        askId,
        title: String(raw.title || translate('ask.parser.planApprovalTitle', language)),
        prompt: String(raw.prompt || translate('ask.parser.planApprovalPrompt', language)),
        planMarkdown,
        risks: Array.isArray(raw.risks) ? raw.risks.map((item: any) => String(item)).filter(Boolean) : [],
        affectedFiles: Array.isArray(raw.affectedFiles) ? raw.affectedFiles.map((item: any) => String(item)).filter(Boolean) : [],
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      }
    } else if (raw.type === 'clarify') {
      const rawOptions = Array.isArray(raw.options) ? raw.options : []
      const options = uniqueOptionIds(rawOptions.slice(0, 6).map((o: any, oi: number) => ({
        id: String(o.id || `o${oi + 1}`),
        label: String(o.label || o.title || translate('ask.parser.optionN', language, { n: oi + 1 })),
        description: String(o.description || o.summary || ''),
        recommended: parseOptionalBoolean(o.recommended) === true
      })).filter((o: any) => o.label))
      ask = {
        type: 'clarify',
        askId,
        title: String(raw.title || translate('ask.parser.clarifyTitle', language)),
        prompt: String(raw.prompt || raw.question || translate('ask.parser.clarifyPrompt', language)),
        fieldName: String(raw.fieldName || raw.field || ''),
        placeholder: String(raw.placeholder || ''),
        options: options.length >= 2 ? options : undefined,
        multiSelect: parseOptionalBoolean(raw.multiSelect),
        allowOther: raw.allowOther == null ? false : parseOptionalBoolean(raw.allowOther),
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      }
    } else if (raw.type === 'multi-choice-clarify') {
      const rawQuestions = Array.isArray(raw.questions) ? raw.questions : []
      const questions = rawQuestions.slice(0, 4).map((q: any, qi: number) => {
        const rawOptions = Array.isArray(q.options) ? q.options : []
        const opts = uniqueOptionIds(rawOptions.slice(0, 4).map((o: any, oi: number) => ({
          id: String(o.id || `o${oi + 1}`),
          label: String(o.label || o.title || translate('ask.parser.optionN', language, { n: oi + 1 })),
          description: String(o.description || o.summary || ''),
          recommended: parseOptionalBoolean(o.recommended) === true
        })).filter((o: any) => o.label))
        return {
          id: String(q.id || `q${qi + 1}`),
          header: String(q.header || q.title || translate('ask.parser.questionN', language, { n: qi + 1 })),
          question: String(q.question || q.prompt || ''),
          multiSelect: parseOptionalBoolean(q.multiSelect),
          allowOther: q.allowOther == null ? true : parseOptionalBoolean(q.allowOther),
          options: opts
        }
      }).filter((q: any) => q.options.length >= 2)
      if (!questions.length) return null
      ask = {
        type: 'multi-choice-clarify',
        askId,
        title: String(raw.title || translate('ask.parser.multiClarifyTitle', language)),
        prompt: String(raw.prompt || translate('ask.parser.multiClarifyPrompt', language)),
        questions,
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      }
    } else if (raw.type === 'production-board') {
      const previousScenes = new Map((((previous && (previous as any).sceneSlots) || []) as any[])
        .map((scene: any) => [scene.sceneId || scene.id, scene]))
      const previousEvents = new Map((((previous && (previous as any).eventPlacements) || []) as any[])
        .map((event: any) => [event.contractId || event.id, event]))
      ask = {
        type: 'production-board',
        askId,
        title: String(raw.title || translate('ask.parser.productionBoardTitle', language)),
        prompt: String(raw.prompt || translate('ask.parser.productionBoardPrompt', language)),
        sceneSlots: (Array.isArray(raw.sceneSlots) ? raw.sceneSlots : []).map((scene: any, index: number) => {
          const sceneId = String(scene.sceneId || scene.id || `scene-${index + 1}`)
          const prior: any = previousScenes.get(sceneId) || {}
          const boundMapId = scene.boundMapId == null && scene.mapId == null
            ? prior.boundMapId || null
            : Number(scene.boundMapId || scene.mapId) || null
          return {
            id: sceneId,
            sceneId,
            name: String(scene.name || scene.title || prior.name || translate('ask.parser.sceneN', language, { n: index + 1 })),
            summary: String(scene.summary || prior.summary || ''),
            mapRequirement: String(scene.mapRequirement || scene.requirement || prior.mapRequirement || ''),
            visualHint: String(scene.visualHint || scene.visual || prior.visualHint || ''),
            gameplayHint: String(scene.gameplayHint || scene.gameplay || prior.gameplayHint || ''),
            boundMapId,
            boundMapName: String(scene.boundMapName || scene.mapName || prior.boundMapName || ''),
            status: String(boundMapId ? 'bound' : prior.status || scene.status || 'unbound'),
            boundAt: prior.boundAt || scene.boundAt || null
          }
        }),
        eventPlacements: (Array.isArray(raw.eventPlacements) ? raw.eventPlacements : Array.isArray(raw.events) ? raw.events : []).map((event: any, index: number) => {
          const contractId = String(event.contractId || event.id || `event-${index + 1}`)
          const prior: any = previousEvents.get(contractId) || {}
          return {
            id: contractId,
            contractId,
            eventName: String(event.eventName || prior.eventName || ''),
            targetMapId: event.targetMapId == null && event.mapId == null
              ? prior.targetMapId || null
              : Number(event.targetMapId || event.mapId) || null,
            sceneId: String(event.sceneId || prior.sceneId || ''),
            questline: String(event.questline || prior.questline || ''),
            summary: String(event.summary || event.purpose || prior.summary || ''),
            placementHint: String(event.placementHint || event.hint || prior.placementHint || ''),
            trigger: String(event.trigger || prior.trigger || ''),
            status: String(prior.status || event.status || 'draft'),
            placedEventId: prior.placedEventId || event.eventId || null,
            x: Number.isInteger(prior.x) ? prior.x : event.x,
            y: Number.isInteger(prior.y) ? prior.y : event.y
          }
        }),
        modifications: (Array.isArray(raw.modifications) ? raw.modifications : []).map((item: any, index: number) => ({
          id: String(item.id || `mod-${index + 1}`),
          kind: String(item.kind || item.type || 'existing-event-edit'),
          mapId: item.mapId == null ? null : Number(item.mapId) || null,
          eventId: item.eventId == null ? null : Number(item.eventId) || null,
          pageIndex: item.pageIndex == null ? null : Number(item.pageIndex),
          summary: String(item.summary || item.description || ''),
          routeTo: String(item.routeTo || 'rmmv-editor')
        })),
        returnAgentId: String(raw.returnAgentId || 'rmmv-director'),
        createdAt: new Date().toISOString(),
        result: previous ? previous.result : null
      } as Ask
    }
    return ask
  } catch {
    return null
  }
}

// MCP tool name → ASK type (mirror of legacy chat-log.js TOOL_TO_ASK_TYPE).
const TOOL_TO_ASK_TYPE: Record<string, string> = {
  askuser_ask_clarify: 'clarify',
  askuser_ask_multi_choice_clarify: 'multi-choice-clarify',
  askuser_ask_plan_approval: 'plan-approval',
  askuser_ask_map_selection: 'map-selection',
  askuser_ask_event_placement_list: 'event-placement-list',
  askuser_ask_production_board: 'production-board'
}

export function normalizeAskToolName(toolName: string): string {
  if (/^mcp__askuser__/.test(toolName || '')) {
    return toolName.replace(/^mcp__askuser__/, 'askuser_')
  }
  return toolName || ''
}

export function isAskTool(toolName: string): boolean {
  return /^askuser_/.test(toolName || '') || /^mcp__askuser__/.test(toolName || '')
}

/** Legacy ASK MCP ids persisted in older transcripts. */
export function isLegacyMcpAskId(askId: string): boolean {
  return /^mcp-/.test(String(askId || ''))
}

/** Claude-compatible streams may echo mcp__askuser__ tool_use; keep one ASK card. */
export function shouldSkipStreamAskToolCall(toolName: string): boolean {
  return /^mcp__askuser__/.test(toolName || '')
}

// Legacy MCP askuser_* tool → build an Ask from its input.
export function parseAskFromToolCall(
  toolName: string,
  callId: string | undefined,
  input: any,
  options: ParseOptions = {}
): Ask | null {
  const normalizedTool = normalizeAskToolName(toolName)
  const askType = (input && input.askType) || TOOL_TO_ASK_TYPE[normalizedTool]
    || normalizedTool.replace(/^askuser_/, '').replace(/_/g, '-')
  const rawInput: Record<string, unknown> = { ...(input || {}), type: askType }
  if (callId && !rawInput.askId) rawInput.askId = callId
  const ask = parseAgentAsk(JSON.stringify(rawInput), options)
  if (ask) ask.fromMcp = isLegacyMcpAskId(ask.askId)
  return ask
}
