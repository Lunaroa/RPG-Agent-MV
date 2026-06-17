/** 静态素材来源 slug / 包名 → 侧栏显示名（未命中则 humanize）。 */
const SOURCE_LABELS = new Map<string, string>([
  ['sample-main', '主工程示例'],
  ['dlc-amusement-park-tile-75aef5d5', '游乐园素材包'],
  ['pack', '示例素材包'],
]);

export function formatSourceLabel(sourceId: string): string {
  const id = String(sourceId || '').trim();
  if (!id || id === 'ungrouped') return '未分组';
  const mapped = SOURCE_LABELS.get(id);
  if (mapped) return mapped;
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
