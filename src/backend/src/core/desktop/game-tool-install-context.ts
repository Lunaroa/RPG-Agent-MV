import type { GameToolInstallProgress } from '../../../../contract/game-release.ts';

export interface GameToolInstallContext {
  isCanceled?: () => boolean;
  reportProgress?: (event: Omit<GameToolInstallProgress, 'operationId' | 'kind'>) => void;
}

export function escapeJavaProperty(value: string): string {
  return value.replace(/[\\:=#! \t\r\n\f]|[^\x20-\x7e]/g, character => {
    const escapes: Record<string, string> = { '\t': '\\t', '\r': '\\r', '\n': '\\n', '\f': '\\f' };
    if (escapes[character]) return escapes[character]!;
    if (character.charCodeAt(0) < 128) return `\\${character}`;
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}
