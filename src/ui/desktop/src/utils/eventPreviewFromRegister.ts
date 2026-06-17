export interface EventPreviewItem {
  contractId: string
  eventName: string
  sceneId?: string
  targetMapId?: number | null
  trigger?: string
  summary?: string
  placementHint?: string
}

function parseContract(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

function normalizeRegisterAction(action: unknown): string {
  const raw = String(action || '').trim().toLowerCase()
  if (raw === 'register' || raw === 'registry.register') return 'register'
  const tail = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw
  if (tail === 'register') return 'register'
  return raw
}

/** Strip MCP / capability prefixes so opencode stream names match preview parsing. */
export function normalizeRmmvEventToolBaseName(tool: string): string {
  let base = tool.trim()
  base = base.replace(/^mcp__[^_]+__/, '')
  base = base.replace(/^rmmv_/i, '')
  return base
}

/** Tool name ends with RmmvEventRegistry, or is RmmvEvent with registry.register action. */
export function isEventRegistryRegisterTool(tool: string | undefined, input: unknown): boolean {
  if (!tool || input == null || typeof input !== 'object') return false
  const action = normalizeRegisterAction((input as Record<string, unknown>).action)
  if (action !== 'register') return false

  const base = normalizeRmmvEventToolBaseName(tool)
  if (/RmmvEventRegistry$/i.test(base)) return true
  if (/^RmmvEvent$/i.test(base)) return true
  return false
}

export function eventPreviewItemFromContract(contract: Record<string, unknown>): EventPreviewItem | null {
  const contractId = String(contract.id || '').trim()
  if (!contractId) return null
  const rmmvTarget = contract.rmmvTarget as Record<string, unknown> | undefined
  const eventName = String(
    rmmvTarget?.eventName || contract.eventName || contractId
  ).trim()
  const summaryRaw = contract.summary ?? contract.purpose
  const rawMapId = rmmvTarget?.mapId
  const targetMapId = Number.isInteger(rawMapId) ? Number(rawMapId) : null
  return {
    contractId,
    eventName: eventName || contractId,
    sceneId: contract.sceneId != null && String(contract.sceneId).trim()
      ? String(contract.sceneId).trim()
      : undefined,
    targetMapId,
    trigger: rmmvTarget?.trigger != null && String(rmmvTarget.trigger).trim()
      ? String(rmmvTarget.trigger).trim()
      : undefined,
    summary: summaryRaw != null && String(summaryRaw).trim()
      ? String(summaryRaw).trim()
      : undefined,
    placementHint: contract.placementHint != null && String(contract.placementHint).trim()
      ? String(contract.placementHint).trim()
      : undefined,
  }
}

/** Extract preview row from a RmmvEventRegistry / RmmvEvent register tool_call input. */
export function parseEventPreviewFromRegisterTool(
  tool: string | undefined,
  input: unknown
): EventPreviewItem | null {
  if (!isEventRegistryRegisterTool(tool, input)) return null
  const contract = parseContract((input as Record<string, unknown>).contract)
  if (!contract) return null
  return eventPreviewItemFromContract(contract)
}
