/**
 * Run: node --experimental-strip-types --test src/utils/eventPreviewFromRegister.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  isEventRegistryRegisterTool,
  parseEventPreviewFromRegisterTool,
} from './eventPreviewFromRegister.ts'

const sampleContract = {
  id: 'tavern.bartender.intro',
  purpose: 'Sample NPC intro',
  rmmvTarget: { eventName: 'EV_BartenderIntro' },
  implementation: { pages: [{ commands: [{ kind: 'dialogue', text: '欢迎' }] }] },
}

describe('parseEventPreviewFromRegisterTool', () => {
  test('RmmvEventRegistry register with object contract', () => {
    const item = parseEventPreviewFromRegisterTool('mcp__rmmv__RmmvEventRegistry', {
      action: 'register',
      contract: sampleContract,
    })
    assert.deepEqual(item, {
      contractId: 'tavern.bartender.intro',
      eventName: 'EV_BartenderIntro',
      sceneId: undefined,
      targetMapId: null,
      trigger: undefined,
      summary: 'Sample NPC intro',
      placementHint: undefined,
    })
  })

  test('RmmvEvent registry.register with JSON string contract', () => {
    const item = parseEventPreviewFromRegisterTool('RmmvEvent', {
      action: 'registry.register',
      contract: JSON.stringify(sampleContract),
    })
    assert.equal(item?.contractId, 'tavern.bartender.intro')
    assert.equal(item?.eventName, 'EV_BartenderIntro')
  })

  test('ignores non-register actions', () => {
    assert.equal(
      parseEventPreviewFromRegisterTool('RmmvEventRegistry', {
        action: 'list',
        contract: sampleContract,
      }),
      null
    )
  })

  test('ignores register without contract id', () => {
    assert.equal(
      parseEventPreviewFromRegisterTool('RmmvEventRegistry', {
        action: 'register',
        contract: { purpose: 'no id' },
      }),
      null
    )
  })

  test('isEventRegistryRegisterTool matches both tool shapes', () => {
    assert.equal(
      isEventRegistryRegisterTool('mcp__rmmv__RmmvEvent', { action: 'registry.register', contract: {} }),
      true
    )
    assert.equal(
      isEventRegistryRegisterTool('rmmv_RmmvEvent', { action: 'registry.register', contract: sampleContract }),
      true
    )
    assert.equal(
      parseEventPreviewFromRegisterTool('rmmv_RmmvEvent', {
        action: 'registry.register',
        contract: sampleContract,
      })?.contractId,
      'tavern.bartender.intro',
    )
    assert.equal(
      isEventRegistryRegisterTool('RmmvEventRegistry', { action: 'register', contract: {} }),
      true
    )
    assert.equal(
      isEventRegistryRegisterTool('Glob', { action: 'register', contract: {} }),
      false
    )
  })
})
