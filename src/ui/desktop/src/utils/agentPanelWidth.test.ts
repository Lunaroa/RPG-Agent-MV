/**
 * Run: node --experimental-strip-types --test src/utils/agentPanelWidth.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  LEFT_DOCK_RESERVE,
  clampAgentPanelWidth,
  maxAgentPanelWidth,
  overlayMaxAgentPanelWidth,
  parseAgentPanelWidth,
} from './agentPanelWidth.ts'

describe('agent panel width', () => {
  test('uses the default width when no valid width was saved', () => {
    assert.equal(parseAgentPanelWidth(null, 1200), AGENT_PANEL_DEFAULT_WIDTH)
    assert.equal(parseAgentPanelWidth('invalid', 1200), AGENT_PANEL_DEFAULT_WIDTH)
    assert.equal(parseAgentPanelWidth('0', 1200), AGENT_PANEL_DEFAULT_WIDTH)
  })

  test('the overlay ceiling stops at the LeftDock so the tile/map-tree column stays visible', () => {
    assert.equal(overlayMaxAgentPanelWidth(1400), 1400 - LEFT_DOCK_RESERVE)
    assert.equal(maxAgentPanelWidth(1400), 1400 - LEFT_DOCK_RESERVE)
    // 可用宽很窄时收敛到面板最小宽。
    assert.equal(overlayMaxAgentPanelWidth(500), AGENT_PANEL_MIN_WIDTH)
  })

  test('clamps to the overlay ceiling and never below the minimum', () => {
    assert.equal(clampAgentPanelWidth(99999, 1400), 1400 - LEFT_DOCK_RESERVE)
    assert.equal(clampAgentPanelWidth(100, 700), AGENT_PANEL_MIN_WIDTH)
  })
})
