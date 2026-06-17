export const CHAT_HISTORY_DEFAULT_WIDTH = 280
export const CHAT_HISTORY_MIN_WIDTH = 240
export const CHAT_HISTORY_MAX_WIDTH = 420
export const CHAT_HISTORY_WIDTH_STORAGE_KEY = 'rmmv.chat.history-width'

export function clampChatHistoryWidth(width: number): number {
  return Math.min(
    CHAT_HISTORY_MAX_WIDTH,
    Math.max(CHAT_HISTORY_MIN_WIDTH, Math.round(width)),
  )
}

export function parseChatHistoryWidth(saved: string | null): number {
  const width = Number(saved)
  return Number.isFinite(width) && width > 0
    ? clampChatHistoryWidth(width)
    : CHAT_HISTORY_DEFAULT_WIDTH
}
