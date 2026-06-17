/**
 * 将 ASK / registry 中的地图引用规范为 RPG Maker 数字 map id（1 = Map001）。
 * targetMapId 在放置流程中仅为 Agent 建议；实际落点以编辑器当前地图为准。
 * 支持：数字、纯数字字符串、#1、Map016 / map_16 / Map001.json、地图#1 等。
 */
export function resolveTargetMapId(
  raw: unknown,
  fallback?: unknown,
): number | null {
  const candidates = [raw, fallback]
  for (const value of candidates) {
    const id = parseOneMapId(value)
    if (id != null) return id
  }
  return null
}

/** 从 event-registry 契约行解析目标地图 id */
export function resolveRegistryContractMapId(
  reg: Record<string, unknown> | null | undefined,
): number | null {
  if (!reg) return null
  const rmmvTarget = reg.rmmvTarget as Record<string, unknown> | undefined
  return resolveTargetMapId(reg.targetMapId, reg.mapId ?? rmmvTarget?.mapId)
}

/** 从 event-placement ASK 单条 event 或 registry 行解析目标地图 id */
export function resolveEventMapId(event: Record<string, unknown> | null | undefined): number | null {
  if (!event) return null
  const rmmvTarget = event.rmmvTarget as Record<string, unknown> | undefined
  return resolveTargetMapId(
    event.targetMapId,
    event.mapId ?? rmmvTarget?.mapId,
  )
}

/** 从 ASK title / prompt 等自由文本中提取所有可识别的地图 id（按文本出现顺序去重） */
export function extractMapIdsFromText(text: string): number[] {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []

  const hits: { index: number; id: number }[] = []
  const patterns: Array<{ re: RegExp; group: number }> = [
    { re: /\bmap[_\s-]*0*(\d+)(?:\.json)?\b/gi, group: 1 },
    { re: /地图\s*#?\s*(\d+)/g, group: 1 },
    { re: /\bMAP\s*#?\s*(\d+)\b/g, group: 1 },
    { re: /#\s*(\d+)/g, group: 1 },
  ]
  for (const { re, group } of patterns) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(trimmed)) !== null) {
      const id = parseOneMapId(match[group])
      if (id != null) hits.push({ index: match.index, id })
    }
  }
  hits.sort((a, b) => a.index - b.index)

  const found: number[] = []
  const seen = new Set<number>()
  for (const { id } of hits) {
    if (seen.has(id)) continue
    seen.add(id)
    found.push(id)
  }
  if (!found.length) {
    const solo = parseOneMapId(trimmed)
    if (solo != null) found.push(solo)
  }
  return found
}

/** 从 ASK 卡片 title / prompt 解析默认目标地图 */
export function resolveAskContextMapId(ask: {
  title?: string
  prompt?: string
} | null | undefined): number | null {
  if (!ask) return null
  for (const text of [ask.prompt, ask.title]) {
    const ids = extractMapIdsFromText(String(text || ''))
    if (ids.length) return ids[0]
  }
  return null
}

/** 单条 event：自身字段 → ASK 上下文文本 */
export function resolveEventMapIdWithAsk(
  event: Record<string, unknown> | null | undefined,
  ask?: { title?: string; prompt?: string } | null,
): number | null {
  return resolveEventMapId(event) ?? resolveAskContextMapId(ask)
}

export function firstNonEmptyMapId(mapIds: Iterable<number | null | undefined>): number | null {
  for (const id of mapIds) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id
  }
  return null
}

function parseOneMapId(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  const text = String(value).trim()
  if (!text) return null
  const asNum = Number(text)
  if (Number.isInteger(asNum) && asNum > 0) return asNum
  const hashNum = text.match(/^#\s*(\d+)$/)
  if (hashNum) {
    const id = Number(hashNum[1])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const mapFile = text.match(/^map[_\s-]*0*(\d+)(?:\.json)?$/i)
  if (mapFile) {
    const id = Number(mapFile[1])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const cnMap = text.match(/^地图\s*#?\s*(\d+)$/i)
  if (cnMap) {
    const id = Number(cnMap[1])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  return null
}
