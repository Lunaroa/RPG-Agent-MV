import { describe, expect, it } from 'vitest'

import { mergeWorkspacePendingPatch } from './workspace'

describe('workspace pending patches', () => {
  it('does not invent an empty product plugin map for consecutive non-plugin patches', () => {
    const first = mergeWorkspacePendingPatch(
      null,
      { layout: { agentPanelOpen: false } },
    )
    const second = mergeWorkspacePendingPatch(
      first,
      { layout: { bottomPanelOpen: true } },
    )

    expect(Object.prototype.hasOwnProperty.call(second, 'productPlugins')).toBe(false)
  })

  it('keeps product plugin state across consecutive non-plugin layout patches', () => {
    const pending = mergeWorkspacePendingPatch(
      null,
      { layout: { agentPanelOpen: false } },
    )
    const pendingAfterSecondLayout = mergeWorkspacePendingPatch(
      pending,
      { layout: { bottomPanelOpen: true } },
    )
    const mergedWithExisting = mergeWorkspacePendingPatch(
      { productPlugins: { 'ui-designer': true } },
      pendingAfterSecondLayout,
    )

    expect(mergedWithExisting.productPlugins).toEqual({ 'ui-designer': true })
    expect(mergedWithExisting.layout).toMatchObject({
      agentPanelOpen: false,
      bottomPanelOpen: true,
    })
  })
})
