import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createUiDesignerShortcutRegistry } from './shortcutRegistry'

const keyEvent = (overrides: Partial<KeyboardEvent> = {}) => {
  let prevented = false
  const event = {
    key: 'z',
    defaultPrevented: false,
    target: null,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => { prevented = true },
    ...overrides,
  } as KeyboardEvent
  return { event, wasPrevented: () => prevented }
}

test('matches Ctrl/Cmd and Shift modifiers exactly', () => {
  const registry = createUiDesignerShortcutRegistry()
  let calls = 0
  registry.register({ key: 'z', ctrlOrMeta: true, handler: () => { calls += 1 } })

  assert.equal(registry.handle(keyEvent().event), false)
  assert.equal(registry.handle(keyEvent({ ctrlKey: true }).event), true)
  assert.equal(registry.handle(keyEvent({ ctrlKey: true, shiftKey: true }).event), false)
  assert.equal(calls, 1)
})

test('does not hijack input or CodeMirror targets unless explicitly allowed', () => {
  class FakeElement {
    constructor(private readonly kind: 'input' | 'CodeMirror' | 'canvas') {}
    readonly isContentEditable = this.kind === 'input'
    closest(selector: string) { return this.kind === 'CodeMirror' && selector.includes('.CodeMirror') ? this : this.kind === 'input' && selector.includes('input') ? this : null }
  }
  const previous = (globalThis as { HTMLElement?: unknown }).HTMLElement
  Object.defineProperty(globalThis, 'HTMLElement', { value: FakeElement, configurable: true })
  try {
    const registry = createUiDesignerShortcutRegistry()
    let calls = 0
    registry.register({ key: 'x', ctrlOrMeta: true, handler: () => { calls += 1 } })
    const input = keyEvent({ key: 'x', ctrlKey: true, target: new FakeElement('input') as unknown as EventTarget })
    const code = keyEvent({ key: 'x', ctrlKey: true, target: new FakeElement('CodeMirror') as unknown as EventTarget })
    const canvas = keyEvent({ key: 'x', ctrlKey: true, target: new FakeElement('canvas') as unknown as EventTarget })
    assert.equal(registry.handle(input.event), false)
    assert.equal(registry.handle(code.event), false)
    assert.equal(registry.handle(canvas.event), true)
    assert.equal(input.wasPrevented(), false)
    assert.equal(calls, 1)
  } finally {
    if (previous === undefined) delete (globalThis as { HTMLElement?: unknown }).HTMLElement
    else Object.defineProperty(globalThis, 'HTMLElement', { value: previous, configurable: true })
  }
})

test('exposes the same registered bindings for the help surface', () => {
  const registry = createUiDesignerShortcutRegistry()
  registry.register({ key: 's', ctrlOrMeta: true, description: 'shortcutSave', handler: () => undefined })
  registry.register({ key: 'Tab', shift: true, description: 'shortcutPreviousNode', handler: () => undefined })
  const bindings = registry.list()
  assert.deepEqual(bindings.map((binding) => binding.description), ['shortcutSave', 'shortcutPreviousNode'])
  assert.equal('handler' in bindings[0], false)
})
