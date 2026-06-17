export function formatPlacementError(
  error: unknown,
  context?: { contractId?: string; eventName?: string },
): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const label = context?.eventName || context?.contractId || '事件';
  if (/完整实现|无法放置|contractId=/.test(message)) {
    return `无法放置「${label}」（${context?.contractId || ''}）：缺少可放置实现。`
      + '请让 agent 用 mcp__rmmv__RmmvEvent action=registry.register 登记带 implementation.commands[]/pages[] 的 EventContract，'
      + '再回到地图编辑页选择位置放置。';
  }
  if (message.startsWith('放置失败') || message.startsWith('无法放置')) {
    return message;
  }
  return message.startsWith('放置失败') ? message : `放置失败：${message}`;
}

export function toPlacementError(
  error: unknown,
  context?: { contractId?: string; eventName?: string },
): Error {
  return new Error(formatPlacementError(error, context));
}
