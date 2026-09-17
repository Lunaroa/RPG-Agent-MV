import type {
  GameBuildContentChanges,
  GameBuildFileManifestEntry,
  GameBuildTarget,
} from '../../../../contract/game-release.ts';
import { isWindowsPlatformRuntimePath } from './game-windows-runtime-contract.ts';

export function compareGameBuildContent(
  baseReleaseId: string,
  target: readonly GameBuildFileManifestEntry[],
  baseline: ReadonlyMap<string, GameBuildFileManifestEntry>,
  platform: GameBuildTarget,
): GameBuildContentChanges {
  const included = (relativePath: string) => (
    platform !== 'windows' || !isWindowsPlatformRuntimePath(relativePath)
  );
  const targetByPath = new Map(target
    .filter((entry) => included(entry.path))
    .map((entry) => [entry.path, entry]));
  const baselineEntries = [...baseline.entries()].filter(([relativePath]) => included(relativePath));

  const added: string[] = [];
  const modified: string[] = [];
  for (const [relativePath, entry] of targetByPath) {
    const previous = baseline.get(relativePath);
    if (!previous) added.push(relativePath);
    else if (previous.sha256 !== entry.sha256) modified.push(relativePath);
  }
  const deleted = baselineEntries
    .filter(([relativePath]) => !targetByPath.has(relativePath))
    .map(([relativePath]) => relativePath);

  return {
    baseReleaseId,
    added: added.sort(comparePaths),
    modified: modified.sort(comparePaths),
    deleted: deleted.sort(comparePaths),
  };
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}
