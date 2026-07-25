/**
 * Resolve previous/next index for asset preview navigation.
 *
 * Behaviour: **wrap** at both ends (circular). Empty list → `-1`.
 * Single-item list → always `0`. Out-of-range `currentIndex` is normalized
 * via modulo before applying `delta`.
 */
export function resolveAssetPreviewNavIndex(
  currentIndex: number,
  delta: -1 | 1,
  length: number,
): number {
  if (length <= 0) return -1;
  if (length === 1) return 0;
  const normalized = ((currentIndex % length) + length) % length;
  return (normalized + delta + length) % length;
}
