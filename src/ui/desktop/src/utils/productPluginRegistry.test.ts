import { describe, expect, it } from 'vitest'

import {
  getProductPluginDefinition,
  isRegisteredProductPlugin,
  PRODUCT_PLUGIN_REGISTRY,
} from './productPluginRegistry'

describe('product plugin registry', () => {
  it('ships a disabled-by-default ui designer entry with a lazy route target', () => {
    expect(PRODUCT_PLUGIN_REGISTRY).toHaveLength(1)
    expect(getProductPluginDefinition('ui-designer')).toMatchObject({
      id: 'ui-designer',
      route: '/ui-designer',
    })
    expect(isRegisteredProductPlugin('ui-designer')).toBe(true)
    expect(isRegisteredProductPlugin('missing')).toBe(false)
  })
})
