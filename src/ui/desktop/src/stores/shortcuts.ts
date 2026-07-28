import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_GROUP_ORDER,
  formatBinding,
  matchesBinding,
  normalizeBinding,
  type ShortcutCommand,
  type ShortcutGroup,
} from '../shortcuts/keymap'

export interface ShortcutRow {
  command: ShortcutCommand
  /** Effective (override ?? default), canonical binding. */
  binding: string
  /** True when the effective binding equals the catalog default. */
  isDefault: boolean
}

export interface ShortcutGroupView {
  group: ShortcutGroup
  rows: ShortcutRow[]
}

/**
 * Bridges the static shortcut catalog (keymap.ts) with per-user overrides persisted in
 * `UiSettings.shortcuts`. Handlers call `matches(event, id)`; the settings panel drives
 * `setBinding` / `resetBinding` / `resetAll`, each persisted immediately via the settings store.
 */
export const useShortcutsStore = defineStore('shortcuts', () => {
  const settings = useSettingsStore()

  /** Sanitized override map (command id -> combo), ignoring malformed persisted values. */
  const overrides = computed<Record<string, string>>(() => {
    const raw = settings.ui.shortcuts
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim()) out[id] = value
    }
    return out
  })

  /** Effective binding per command id (override falls back to the catalog default). */
  const bindings = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const command of SHORTCUT_COMMANDS) {
      const override = overrides.value[command.id]
      out[command.id] = normalizeBinding(override ?? command.defaultBinding)
    }
    return out
  })

  const hasOverrides = computed(() => Object.keys(overrides.value).length > 0)

  /** Display rows grouped and ordered for the settings panel. */
  const groups = computed<ShortcutGroupView[]>(() =>
    SHORTCUT_GROUP_ORDER.map((group) => ({
      group,
      rows: SHORTCUT_COMMANDS.filter((command) => command.group === group).map((command) => ({
        command,
        binding: bindings.value[command.id],
        isDefault: bindings.value[command.id] === normalizeBinding(command.defaultBinding),
      })),
    })).filter((view) => view.rows.length > 0),
  )

  /** Formatted binding label for a command id (empty string when unknown). */
  function bindingLabel(id: string): string {
    const binding = bindings.value[id]
    return binding ? formatBinding(binding) : ''
  }

  /** True when a live keyboard event matches the effective binding for `id`. */
  function matches(event: KeyboardEvent, id: string): boolean {
    const binding = bindings.value[id]
    return binding ? matchesBinding(event, binding) : false
  }

  /** The command already using `binding` (excluding `excludeId`), or `null` when free. */
  function findConflict(binding: string, excludeId?: string): ShortcutCommand | null {
    const target = normalizeBinding(binding)
    if (!target) return null
    for (const command of SHORTCUT_COMMANDS) {
      if (command.id === excludeId) continue
      if (bindings.value[command.id] === target) return command
    }
    return null
  }

  async function persist(nextShortcuts: Record<string, string>): Promise<void> {
    await settings.saveUi({ ...settings.ui, shortcuts: nextShortcuts })
  }

  /** Bind `id` to `combo`; storing the default clears the override to keep persistence minimal. */
  async function setBinding(id: string, combo: string): Promise<void> {
    const command = SHORTCUT_COMMANDS.find((entry) => entry.id === id)
    if (!command) return
    const normalized = normalizeBinding(combo)
    if (!normalized) return
    const next = { ...overrides.value }
    if (normalized === normalizeBinding(command.defaultBinding)) delete next[id]
    else next[id] = normalized
    await persist(next)
  }

  async function resetBinding(id: string): Promise<void> {
    if (!(id in overrides.value)) return
    const next = { ...overrides.value }
    delete next[id]
    await persist(next)
  }

  async function resetAll(): Promise<void> {
    if (!hasOverrides.value) return
    await persist({})
  }

  return {
    bindings,
    groups,
    hasOverrides,
    bindingLabel,
    matches,
    findConflict,
    setBinding,
    resetBinding,
    resetAll,
  }
})
