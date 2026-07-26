import { describe, expect, it } from 'vitest'

import { buildProjectAssetEffectPreview } from './projectAssetEffectPreview'

describe('project asset effect preview', () => {
  it('builds the isolated preview payload from an effect asset name', () => {
    expect(buildProjectAssetEffectPreview(' SampleEffect ')).toEqual({
      displayType: 2,
      effectName: 'SampleEffect',
      scale: 100,
      speed: 100,
      offsetX: 0,
      offsetY: 0,
      rotation: { x: 0, y: 0, z: 0 },
      alignBottom: false,
      flashTimings: [],
      soundTimings: [],
    })
  })

  it('rejects an empty effect name', () => {
    expect(() => buildProjectAssetEffectPreview('  ')).toThrow('Effect name is required.')
  })
})
