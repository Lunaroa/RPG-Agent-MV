/** 距底部多少像素内视为「跟随新消息」 */
export const CHAT_SCROLL_FOLLOW_THRESHOLD = 80

export function isNearScrollBottom(
  element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  threshold = CHAT_SCROLL_FOLLOW_THRESHOLD,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}
