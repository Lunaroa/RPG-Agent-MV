import { isBigCharacterName } from '../composables/useMapRenderer';

function clampInt(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export interface CharacterSpriteInput {
  characterName?: string;
  characterIndex?: number;
  direction?: number;
  pattern?: number;
}

/** CSS background sprite for a single character frame — same math as database actor cards. */
export function characterSpriteStyle(
  url: string,
  image: CharacterSpriteInput,
  cell = 58,
): Record<string, string> {
  const escaped = url.replace(/"/g, '\\"');
  const backgroundImage = `url("${escaped}")`;
  const big = isBigCharacterName(image.characterName || '');
  const index = clampInt(image.characterIndex, 0, 7);
  const cols = big ? 3 : 12;
  const rows = big ? 4 : 8;
  const blockX = big ? 1 : (index % 4) * 3 + 1;
  const blockY = big ? 0 : Math.floor(index / 4) * 4;
  return {
    backgroundImage,
    backgroundSize: `${cols * cell}px ${rows * cell}px`,
    backgroundPosition: `-${blockX * cell}px -${blockY * cell}px`,
    width: `${cell}px`,
    height: `${cell}px`,
  };
}
