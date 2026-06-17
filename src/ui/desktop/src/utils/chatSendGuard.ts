/** 是否允许从输入框提交一条新消息（非空且当前无进行中的发送/会话）。 */
export function canSubmitChatMessage(text: string, busy: boolean): boolean {
  return text.trim().length > 0 && !busy
}

const DEFAULT_SEND_DEBOUNCE_MS = 300

/** 距上次提交不足间隔时返回 true，用于抑制连按。 */
export function isSendDebounced(lastSendAtMs: number, nowMs: number, debounceMs = DEFAULT_SEND_DEBOUNCE_MS): boolean {
  return lastSendAtMs > 0 && nowMs - lastSendAtMs < debounceMs
}
