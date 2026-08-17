import type { UiRect } from '@contract/ui-designer'
import { rectCenter } from './geometry'

export type UiNavigationDirection = 'up' | 'down' | 'left' | 'right'

export interface UiNavigationEntry {
  id: string
  rect: UiRect
}

const DIRECTION_BY_KEY: Record<string, UiNavigationDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/** Arrow keys are matched on `key` so both real keyboards and bridge-synthesized events apply. */
export function navigationDirectionFromKey(key: string): UiNavigationDirection | undefined {
  return DIRECTION_BY_KEY[key]
}

/**
 * Spatial selection navigation over scene rects. A candidate qualifies when its
 * leading edge is past the current rect in the travel direction; the winner
 * minimizes `primary + 3 x secondary` measured between rect centers, which
 * keeps same-row/same-column neighbors ahead of diagonal ones.
 */
export function nextNodeIdInDirection(
  entries: readonly UiNavigationEntry[],
  currentId: string | null,
  direction: UiNavigationDirection,
): string | null {
  if (!entries.length) return null
  const current = currentId ? entries.find((entry) => entry.id === currentId) : undefined
  if (!current) return entries[0].id
  const center = rectCenter(current.rect)
  let best: UiNavigationEntry | undefined
  let minScore = Infinity
  for (const candidate of entries) {
    if (candidate.id === current.id) continue
    if (direction === 'right' && !(candidate.rect.x > current.rect.x)) continue
    if (direction === 'left' && !(candidate.rect.x < current.rect.x)) continue
    if (direction === 'down' && !(candidate.rect.y > current.rect.y)) continue
    if (direction === 'up' && !(candidate.rect.y < current.rect.y)) continue
    const candidateCenter = rectCenter(candidate.rect)
    const dx = Math.abs(candidateCenter.x - center.x)
    const dy = Math.abs(candidateCenter.y - center.y)
    const score = direction === 'left' || direction === 'right' ? dx + dy * 3 : dy + dx * 3
    if (score < minScore) {
      minScore = score
      best = candidate
    }
  }
  return best?.id ?? null
}
