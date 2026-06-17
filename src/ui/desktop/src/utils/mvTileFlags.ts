export type MvTilePassage = 'passable' | 'blocked' | 'directional' | 'unknown';

export interface MvTileFlagStackSummary {
  passage: MvTilePassage;
  ladder: boolean;
  bush: boolean;
  counter: boolean;
  damage: boolean;
  star: boolean;
  terrainTag: number;
  flagsMissing: boolean;
  hasOverlay: boolean;
}

const PASSAGE_MASK = 0x0f;
const STAR = 0x10;
const LADDER = 0x20;
const BUSH = 0x40;
const COUNTER = 0x80;
const DAMAGE = 0x100;

export function summarizeTileStackFlags(tileIds: number[], flags: number[]): MvTileFlagStackSummary {
  let ladder = false;
  let bush = false;
  let counter = false;
  let damage = false;
  let star = false;
  let terrainTag = 0;
  let flagsMissing = false;
  let passage: MvTilePassage = 'passable';
  let passageResolved = false;

  for (const tileId of tileIds) {
    if (!tileId) continue;
    const flag = flags[tileId];
    if (!Number.isInteger(flag)) {
      flagsMissing = true;
      continue;
    }
    ladder ||= Boolean(flag & LADDER);
    bush ||= Boolean(flag & BUSH);
    counter ||= Boolean(flag & COUNTER);
    damage ||= Boolean(flag & DAMAGE);
    star ||= Boolean(flag & STAR);
    terrainTag ||= (flag >> 12) & 0x0f;
  }

  for (let index = tileIds.length - 1; index >= 0; index -= 1) {
    const tileId = tileIds[index];
    if (!tileId) continue;
    const flag = flags[tileId];
    if (!Number.isInteger(flag)) continue;
    if (flag & STAR) continue;
    const passageBits = flag & PASSAGE_MASK;
    passage = passageBits === 0
      ? 'passable'
      : passageBits === PASSAGE_MASK
        ? 'blocked'
        : 'directional';
    passageResolved = true;
    break;
  }

  if (!passageResolved && flagsMissing) passage = 'unknown';

  return {
    passage,
    ladder,
    bush,
    counter,
    damage,
    star,
    terrainTag,
    flagsMissing,
    hasOverlay: flagsMissing || passage !== 'passable' || ladder || bush || counter || damage || terrainTag > 0,
  };
}

export function flagSummaryTokens(summary: MvTileFlagStackSummary): string[] {
  const tokens: string[] = [];
  if (summary.flagsMissing) tokens.push('?');
  if (summary.passage === 'blocked') tokens.push('X');
  else if (summary.passage === 'directional') tokens.push('DIR');
  if (summary.ladder) tokens.push('L');
  if (summary.bush) tokens.push('B');
  if (summary.counter) tokens.push('C');
  if (summary.damage) tokens.push('D');
  if (summary.terrainTag > 0) tokens.push(`T${summary.terrainTag}`);
  return tokens;
}
