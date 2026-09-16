import { GAME_VERSION_PATTERN, type GameVersionParts } from '../../../../contract/game-release.ts';

export class GameVersionFormatError extends Error {
  constructor(value: unknown) {
    super(`Game version must use a.b.c with an optional -suffix made of ASCII letters, digits, and dots. Received: ${JSON.stringify(value)}.`);
    this.name = 'GameVersionFormatError';
  }
}

export function parseGameVersion(value: unknown): GameVersionParts & { normalized: string } {
  if (typeof value !== 'string' || !GAME_VERSION_PATTERN.test(value)) throw new GameVersionFormatError(value);
  const match = /^(\d+)\.(\d+)\.(\d+)(?: *-([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*))?$/.exec(value);
  if (!match) throw new GameVersionFormatError(value);
  const major = match[1]!;
  const minor = match[2]!;
  const patch = match[3]!;
  const suffix = match[4] || '';
  return {
    major,
    minor,
    patch,
    suffix,
    normalized: `${major}.${minor}.${patch}${suffix ? `-${suffix}` : ''}`,
  };
}

export function normalizeGameVersion(value: unknown): string {
  return parseGameVersion(value).normalized;
}

export function compareGameVersions(left: unknown, right: unknown): -1 | 0 | 1 {
  const leftParts = parseGameVersion(left);
  const rightParts = parseGameVersion(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    const compared = compareDecimalStrings(leftParts[key], rightParts[key]);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length < normalizedRight.length) return -1;
  if (normalizedLeft.length > normalizedRight.length) return 1;
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}
