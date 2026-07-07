import type { SlashCommandListItem } from '../api/client'

export function filterSlashCommands(query: string, commands: SlashCommandListItem[]): SlashCommandListItem[] {
  const trimmed = query.trim()
  if (!trimmed.startsWith('/')) return commands
  const needle = trimmed.slice(1).toLowerCase()
  if (!needle) return commands
  return commands.filter((command) => command.name.startsWith(needle))
}
