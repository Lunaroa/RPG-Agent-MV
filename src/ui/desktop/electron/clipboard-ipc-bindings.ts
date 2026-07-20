interface ClipboardIpcRegistrar {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

interface ClipboardAdapter {
  writeText(text: string): void;
  readImage(): {
    isEmpty(): boolean;
    toPNG(): Uint8Array;
  };
}

export const CLIPBOARD_IPC_CHANNELS = ['clipboard:writeText', 'clipboard:readImage'] as const;

export function registerClipboardIpcHandlers(ipc: ClipboardIpcRegistrar, clipboard: ClipboardAdapter): void {
  ipc.handle('clipboard:writeText', (_event, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Clipboard text must be a string.');
    if (text.length > 32_768) throw new Error('Clipboard text exceeded 32 KiB.');
    clipboard.writeText(text);
    return { ok: true as const };
  });
  ipc.handle('clipboard:readImage', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const bytes = Buffer.from(image.toPNG());
    return {
      filename: 'pasted-image.png',
      mime: 'image/png',
      sizeBytes: bytes.byteLength,
      dataBase64: bytes.toString('base64'),
    };
  });
}

export function cleanupClipboardIpcHandlers(ipc: ClipboardIpcRegistrar): void {
  for (const channel of CLIPBOARD_IPC_CHANNELS) ipc.removeHandler(channel);
}
