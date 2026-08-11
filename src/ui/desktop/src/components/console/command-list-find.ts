export interface CommandFindView {
  head: string;
  lines: readonly string[];
}

/** Return the display-span indices whose complete rendered text contains query. */
export function findCommandSpanIndices(views: readonly CommandFindView[], query: string): number[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return views.reduce<number[]>((matches, view, index) => {
    const text = [view.head, ...view.lines].join('\n').toLocaleLowerCase();
    if (text.includes(needle)) matches.push(index);
    return matches;
  }, []);
}

/** Move through a match list with the same wrapping behavior as VS Code find. */
export function nextCommandFindCursor(matchCount: number, cursor: number, direction: -1 | 1): number {
  if (matchCount <= 0) return -1;
  if (cursor < 0 || cursor >= matchCount) return direction > 0 ? 0 : matchCount - 1;
  return (cursor + direction + matchCount) % matchCount;
}
