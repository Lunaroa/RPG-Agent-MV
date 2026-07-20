import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupClipboardIpcHandlers,
  CLIPBOARD_IPC_CHANNELS,
  registerClipboardIpcHandlers,
} from './clipboard-ipc-bindings.ts';

test('writes bounded diagnostic text through the native clipboard bridge', () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const removed: string[] = [];
  const written: string[] = [];
  const ipc = {
    handle(channel: string, listener: (...args: any[]) => unknown) { handlers.set(channel, listener); },
    removeHandler(channel: string) { removed.push(channel); },
  };
  registerClipboardIpcHandlers(ipc, {
    writeText(text) { written.push(text); },
    readImage() { return { isEmpty: () => true, toPNG: () => new Uint8Array() }; },
  });

  assert.deepEqual(handlers.get('clipboard:writeText')?.({}, '{"stage":"renderer-resources"}'), { ok: true });
  assert.deepEqual(written, ['{"stage":"renderer-resources"}']);
  assert.throws(() => handlers.get('clipboard:writeText')?.({}, 42), /must be a string/);
  assert.throws(() => handlers.get('clipboard:writeText')?.({}, 'x'.repeat(32_769)), /32 KiB/);

  cleanupClipboardIpcHandlers(ipc);
  assert.deepEqual(removed, [...CLIPBOARD_IPC_CHANNELS]);
});
