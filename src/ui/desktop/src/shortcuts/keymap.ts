import type { MessageKey } from '../i18n'

/**
 * Central catalog of user-rebindable, current-window shortcuts (v1).
 *
 * Only a curated set of window-level, single-shot, low-risk commands is exposed here.
 * Context-sensitive editor keys (undo/redo, delete, copy/paste, ...) are intentionally
 * left out of rebinding for now; new commands only need one entry below plus a handler
 * that calls `useShortcutsStore().matches(event, id)`.
 */
export type ShortcutGroup = 'app' | 'editor'

export interface ShortcutCommand {
  /** Stable command id used as the persistence key and handler selector. */
  id: string
  /** Display grouping in the settings panel. */
  group: ShortcutGroup
  /** i18n key for the human-readable command label. */
  labelKey: MessageKey
  /** Default binding in canonical form (e.g. "Ctrl+S"). */
  defaultBinding: string
}

/** Ordered so groups render deterministically in the settings panel. */
export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ['app', 'editor']

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  { id: 'app.save', group: 'app', labelKey: 'settings.shortcuts.cmd.save', defaultBinding: 'Ctrl+S' },
  { id: 'app.toggleAgentPanel', group: 'app', labelKey: 'settings.shortcuts.cmd.toggleAgentPanel', defaultBinding: 'Ctrl+L' },
  { id: 'app.globalSearch', group: 'app', labelKey: 'settings.shortcuts.cmd.globalSearch', defaultBinding: 'Ctrl+P' },
  { id: 'editor.togglePreviewConsole', group: 'editor', labelKey: 'settings.shortcuts.cmd.togglePreviewConsole', defaultBinding: 'Shift+F12' },
]

/** Pure modifier keys never form a standalone binding while recording. */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'CapsLock'])

/** Canonical modifier order; Ctrl absorbs Meta so Windows/macOS bindings stay interchangeable. */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const

const CTRL_ALIASES = new Set(['ctrl', 'control', 'meta', 'cmd', 'command', 'win', 'super'])
const ALT_ALIASES = new Set(['alt', 'option'])

/** Normalize a single (non-modifier) key token to its canonical display form. */
function normalizeKeyName(key: string): string {
  if (key === ' ' || key === 'Spacebar' || key === 'Space') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * Build a canonical binding string from a live keyboard event, or `null` when the
 * event carries only modifier keys (recording should keep waiting for a real key).
 * Ctrl and Meta both map to `Ctrl` so the same combo matches on Windows and macOS.
 */
export function eventToBinding(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(normalizeKeyName(event.key))
  return parts.join('+')
}

/**
 * Normalize an arbitrary binding string (default catalog value or persisted override)
 * into the canonical `Ctrl+Alt+Shift+KEY` form with deduplicated, ordered modifiers.
 */
export function normalizeBinding(binding: string): string {
  const mods = new Set<string>()
  let mainKey = ''
  for (const raw of binding.split('+')) {
    const token = raw.trim()
    if (!token) continue
    const lower = token.toLowerCase()
    if (CTRL_ALIASES.has(lower)) mods.add('Ctrl')
    else if (ALT_ALIASES.has(lower)) mods.add('Alt')
    else if (lower === 'shift') mods.add('Shift')
    else mainKey = normalizeKeyName(token)
  }
  const parts: string[] = MODIFIER_ORDER.filter((mod) => mods.has(mod))
  if (mainKey) parts.push(mainKey)
  return parts.join('+')
}

/** Human-facing rendering of a binding (canonical form is already display-friendly). */
export function formatBinding(binding: string): string {
  return normalizeBinding(binding)
}

/** True when a live keyboard event matches the given binding (Ctrl/Meta interchangeable). */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const actual = eventToBinding(event)
  return actual !== null && actual === normalizeBinding(binding)
}
