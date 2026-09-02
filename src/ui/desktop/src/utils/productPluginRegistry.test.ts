import { describe, expect, it } from 'vitest'

import {
  getProductPluginDefinition,
  isRegisteredProductPlugin,
  PRODUCT_PLUGIN_REGISTRY,
} from './productPluginRegistry'

describe('product plugin registry', () => {
  it('ships disabled-by-default designer and unlimited-layer entries', () => {
    expect(PRODUCT_PLUGIN_REGISTRY).toHaveLength(4)
    expect(getProductPluginDefinition('ui-designer')).toMatchObject({
      id: 'ui-designer',
      route: '/ui-designer',
    })
    expect(isRegisteredProductPlugin('ui-designer')).toBe(true)
    expect(getProductPluginDefinition('unlimited-map-layers')).toMatchObject({
      id: 'unlimited-map-layers',
      route: '/workbench',
      defaultEnabled: false,
    })
    expect(isRegisteredProductPlugin('unlimited-map-layers')).toBe(true)
    expect(getProductPluginDefinition('unlimited-tile-layers')).toMatchObject({
      id: 'unlimited-tile-layers',
      route: '/workbench/tile-layers',
      defaultEnabled: false,
    })
    expect(isRegisteredProductPlugin('unlimited-tile-layers')).toBe(true)
    expect(getProductPluginDefinition('map-overview')).toMatchObject({
      id: 'map-overview',
      route: '/map-overview',
      defaultEnabled: false,
    })
    expect(isRegisteredProductPlugin('map-overview')).toBe(true)
    expect(isRegisteredProductPlugin('missing')).toBe(false)
  })
})
