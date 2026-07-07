import type { SlashCommandListItem } from "./types.ts";

export const SLASH_COMMANDS: SlashCommandListItem[] = [
  { name: "tokens", descriptionKey: "slash.tokens.description" },
  { name: "compact", descriptionKey: "slash.compact.description" },
  { name: "help", descriptionKey: "slash.help.description" },
];

export function listSlashCommands(): SlashCommandListItem[] {
  return SLASH_COMMANDS.slice();
}

export function getSlashCommand(name: string): SlashCommandListItem | null {
  const normalized = name.trim().toLowerCase();
  return SLASH_COMMANDS.find((command) => command.name === normalized) ?? null;
}
