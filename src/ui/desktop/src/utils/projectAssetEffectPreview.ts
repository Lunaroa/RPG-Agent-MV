import type { InteractiveParticleAnimationPreview } from '@contract/types'

export function buildProjectAssetEffectPreview(
  effectName: string,
): InteractiveParticleAnimationPreview {
  const normalizedName = effectName.trim()
  if (!normalizedName) {
    throw new Error('Effect name is required.')
  }
  return {
    displayType: 2,
    effectName: normalizedName,
    scale: 100,
    speed: 100,
    offsetX: 0,
    offsetY: 0,
    rotation: { x: 0, y: 0, z: 0 },
    alignBottom: false,
    flashTimings: [],
    soundTimings: [],
  }
}
