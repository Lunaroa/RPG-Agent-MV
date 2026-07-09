import type { SlashCommandListItem } from "./types.ts";

/** Visible in `/` autocomplete and `/help`. */
export const SLASH_COMMANDS: SlashCommandListItem[] = [
  { name: "compact", descriptionKey: "slash.compact.description" },
  { name: "help", descriptionKey: "slash.help.description" },
];

/** Still executable when typed manually; not listed in autocomplete. */
const HIDDEN_SLASH_COMMANDS: SlashCommandListItem[] = [
  { name: "tokens", descriptionKey: "slash.tokens.description" },
];

export function listSlashCommands(): SlashCommandListItem[] {
  return SLASH_COMMANDS.slice();
}

export function getSlashCommand(name: string): SlashCommandListItem | null {
  const normalized = name.trim().toLowerCase();
  return (
    SLASH_COMMANDS.find((command) => command.name === normalized)
    ?? HIDDEN_SLASH_COMMANDS.find((command) => command.name === normalized)
    ?? null
  );
}
