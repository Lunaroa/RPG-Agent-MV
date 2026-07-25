import type { InteractiveParticleAnimationPreview } from '@contract/types';

export type PluginAnimationPreviewKind = 'none' | 'particle' | 'classic';

export interface PluginAnimationClassicPreviewSource {
  frames: unknown;
  animation1Name: string;
  animation1Hue: number;
  animation2Name: string;
  animation2Hue: number;
}

export function resolvePluginAnimationPreviewKind(record: unknown): PluginAnimationPreviewKind {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'none';
  const effectName = String((record as { effectName?: unknown }).effectName || '').trim();
  if (effectName) return 'particle';
  return 'classic';
}

export function readPluginAnimationClassicPreview(
  record: unknown,
): PluginAnimationClassicPreviewSource | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const source = record as Record<string, unknown>;
  return {
    frames: source.frames,
    animation1Name: String(source.animation1Name || '').trim(),
    animation1Hue: Number(source.animation1Hue) || 0,
    animation2Name: String(source.animation2Name || '').trim(),
    animation2Hue: Number(source.animation2Hue) || 0,
  };
}

export function asParticleAnimationPreview(
  record: unknown,
): InteractiveParticleAnimationPreview | null {
  if (resolvePluginAnimationPreviewKind(record) !== 'particle') return null;
  return record as InteractiveParticleAnimationPreview;
}
