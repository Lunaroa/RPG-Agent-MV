import { afterEach, describe, expect, it } from 'vitest'

import {
  clearProductPluginLifecycleGuards,
  registerProductPluginLifecycleGuard,
  requestProductPluginDisable,
} from './productPluginLifecycle'

describe('product plugin lifecycle guards', () => {
  afterEach(() => clearProductPluginLifecycleGuards())

  it('allows disabling a plugin with no registered surface guard', async () => {
    await expect(
      requestProductPluginDisable('ui-designer', async () => 'cancel'),
    ).resolves.toEqual({ allowed: true })
  })

  it('saves or discards dirty state before allowing disable', async () => {
    const calls: string[] = []
    let dirty = true
    registerProductPluginLifecycleGuard('ui-designer', {
      isDirty: () => dirty,
      save: () => { calls.push('save'); dirty = false; return true },
      discard: () => { calls.push('discard'); dirty = false; return true },
    })

    await expect(
      requestProductPluginDisable('ui-designer', () => 'save'),
    ).resolves.toEqual({ allowed: true })
    dirty = true
    await expect(
      requestProductPluginDisable('ui-designer', () => 'discard'),
    ).resolves.toEqual({ allowed: true })
    expect(calls).toEqual(['save', 'discard'])
  })

  it('keeps the plugin enabled when the user cancels or save fails', async () => {
    registerProductPluginLifecycleGuard('ui-designer', {
      isDirty: () => true,
      save: async () => { throw new Error('save failed') },
      discard: () => true,
    })

    await expect(
      requestProductPluginDisable('ui-designer', () => 'cancel'),
    ).resolves.toMatchObject({ allowed: false, reason: 'cancelled' })
    await expect(
      requestProductPluginDisable('ui-designer', () => 'save'),
    ).resolves.toMatchObject({ allowed: false, reason: 'save-failed' })
  })

  it('does not disable when save or discard reports false', async () => {
    registerProductPluginLifecycleGuard('ui-designer', {
      isDirty: () => true,
      save: () => false,
      discard: () => false,
    })

    await expect(
      requestProductPluginDisable('ui-designer', () => 'save'),
    ).resolves.toMatchObject({ allowed: false, reason: 'save-failed' })
    await expect(
      requestProductPluginDisable('ui-designer', () => 'discard'),
    ).resolves.toMatchObject({ allowed: false, reason: 'discard-failed' })
  })

  it('does not disable when a successful save leaves the surface dirty', async () => {
    let dirty = true
    registerProductPluginLifecycleGuard('ui-designer', {
      isDirty: () => dirty,
      save: () => {
        // The callback claims success but leaves the editor dirty.
        return true
      },
      discard: () => {
        dirty = false
        return true
      },
    })

    await expect(
      requestProductPluginDisable('ui-designer', () => 'save'),
    ).resolves.toMatchObject({ allowed: false, reason: 'save-failed' })
    dirty = false
    await expect(
      requestProductPluginDisable('ui-designer', () => 'save'),
    ).resolves.toEqual({ allowed: true })
  })
})
