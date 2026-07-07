export type SlashSubmit =
  | { kind: 'slash'; command: string; args: string }
  | { kind: 'message'; text: string }

export interface SlashCommandNameSource {
  name: string
}

export function parseSlashSubmit(text: string): SlashSubmit {
  const trimmed = text.trim()
  const match = /^\/([a-zA-Z][\w-]*)(?:\s+(.*))?$/.exec(trimmed)
  if (!match) return { kind: 'message', text: trimmed }
  return {
    kind: 'slash',
    command: match[1].toLowerCase(),
    args: match[2]?.trim() ?? '',
  }
}

export function isSlashInput(text: string): boolean {
  return text.trimStart().startsWith('/')
}

export function isCompleteSlashCommand(text: string, commands: SlashCommandNameSource[]): boolean {
  const parsed = parseSlashSubmit(text)
  if (parsed.kind !== 'slash') return false
  if (parsed.args) return false
  return commands.some((command) => command.name === parsed.command)
}

export function shouldOpenSlashPopover(text: string): boolean {
  return /^\/\S*$/.test(text)
}
