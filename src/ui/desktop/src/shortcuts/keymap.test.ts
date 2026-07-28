/**
 * Run: node --experimental-strip-types --test src/shortcuts/keymap.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHORTCUT_COMMANDS,
  eventToBinding,
  formatBinding,
  matchesBinding,
  normalizeBinding,
} from './keymap.ts';

function keyEvent(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

describe('eventToBinding', () => {
  it('builds canonical combos with ordered modifiers', () => {
    assert.equal(eventToBinding(keyEvent({ key: 's', ctrlKey: true })), 'Ctrl+S');
    assert.equal(eventToBinding(keyEvent({ key: 'F12', shiftKey: true })), 'Shift+F12');
    assert.equal(
      eventToBinding(keyEvent({ key: 'Delete', ctrlKey: true, altKey: true, shiftKey: true })),
      'Ctrl+Alt+Shift+Delete',
    );
  });

  it('treats Meta as Ctrl so Windows/macOS combos match', () => {
    assert.equal(eventToBinding(keyEvent({ key: 's', metaKey: true })), 'Ctrl+S');
  });

  it('uppercases single characters and names the space key', () => {
    assert.equal(eventToBinding(keyEvent({ key: 'a' })), 'A');
    assert.equal(eventToBinding(keyEvent({ key: ' ', ctrlKey: true })), 'Ctrl+Space');
  });

  it('returns null while only modifier keys are held', () => {
    assert.equal(eventToBinding(keyEvent({ key: 'Control', ctrlKey: true })), null);
    assert.equal(eventToBinding(keyEvent({ key: 'Shift', shiftKey: true })), null);
    assert.equal(eventToBinding(keyEvent({ key: 'Meta', metaKey: true })), null);
  });
});

describe('normalizeBinding', () => {
  it('canonicalizes case, aliases and modifier order', () => {
    assert.equal(normalizeBinding('ctrl+s'), 'Ctrl+S');
    assert.equal(normalizeBinding('meta+s'), 'Ctrl+S');
    assert.equal(normalizeBinding('Cmd+S'), 'Ctrl+S');
    assert.equal(normalizeBinding('shift+ctrl+z'), 'Ctrl+Shift+Z');
    assert.equal(normalizeBinding('Control + Alt + Delete'), 'Ctrl+Alt+Delete');
  });

  it('deduplicates repeated modifiers', () => {
    assert.equal(normalizeBinding('ctrl+ctrl+s'), 'Ctrl+S');
  });

  it('is idempotent on already-canonical combos', () => {
    for (const command of SHORTCUT_COMMANDS) {
      const once = normalizeBinding(command.defaultBinding);
      assert.equal(normalizeBinding(once), once);
    }
  });
});

describe('formatBinding', () => {
  it('renders the canonical form', () => {
    assert.equal(formatBinding('meta+shift+p'), 'Ctrl+Shift+P');
  });
});

describe('matchesBinding', () => {
  it('matches when modifiers and key line up (Ctrl/Meta interchangeable)', () => {
    assert.equal(matchesBinding(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+S'), true);
    assert.equal(matchesBinding(keyEvent({ key: 's', metaKey: true }), 'Ctrl+S'), true);
    assert.equal(matchesBinding(keyEvent({ key: 'F12', shiftKey: true }), 'Shift+F12'), true);
  });

  it('rejects mismatched keys or extra modifiers', () => {
    assert.equal(matchesBinding(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+P'), false);
    assert.equal(matchesBinding(keyEvent({ key: 'p', ctrlKey: true, shiftKey: true }), 'Ctrl+P'), false);
    assert.equal(matchesBinding(keyEvent({ key: 'Control', ctrlKey: true }), 'Ctrl+S'), false);
  });
});

describe('SHORTCUT_COMMANDS conflict dedup', () => {
  it('ships without any duplicate default bindings', () => {
    const seen = new Map<string, string>();
    for (const command of SHORTCUT_COMMANDS) {
      const canonical = normalizeBinding(command.defaultBinding);
      assert.equal(seen.has(canonical), false, `duplicate default binding ${canonical}`);
      seen.set(canonical, command.id);
    }
  });

  it('detects conflicts across differently formatted combos (findConflict basis)', () => {
    assert.equal(normalizeBinding('Ctrl+S') === normalizeBinding('meta+s'), true);
    assert.equal(normalizeBinding('Ctrl+S') === normalizeBinding('Ctrl+P'), false);
  });
});
