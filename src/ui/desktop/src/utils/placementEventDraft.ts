/** 判断契约 implementation.pages 是否为带 commands[] 的高级抽象页（需经 patcher 编译成真命令）。 */
export function hasAbstractContractPages(pages?: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(pages) || !pages.length) return false;
  const first = pages[0];
  return Boolean(first && typeof first === 'object' && Array.isArray((first as { commands?: unknown }).commands));
}

/** 从契约 implementation 取出可编译的抽象页（pages 或顶层 commands[]）。 */
export function normalizeContractPagesFromImpl(
  impl?: { pages?: Array<Record<string, unknown>>; commands?: unknown[] } | null,
  defaultTrigger?: string,
): Array<Record<string, unknown>> | undefined {
  if (!impl) return undefined;
  if (hasAbstractContractPages(impl.pages)) return impl.pages;
  if (Array.isArray(impl.commands) && impl.commands.length) {
    const page: Record<string, unknown> = { commands: impl.commands };
    if (defaultTrigger) page.trigger = defaultTrigger;
    return [page];
  }
  return undefined;
}

/** 放置/新建事件 note：只保留用户显式备注，不自动追加 AIWF 标记。 */
export function buildPlacementContractNote(_contractId: string, extraNote?: string): string {
  const lines: string[] = [];
  for (const line of String(extraNote || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('AIWF:')) continue;
    if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
  }
  return lines.join('\n');
}
