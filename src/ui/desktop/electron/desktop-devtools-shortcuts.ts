export type DesktopDevToolsShortcut = 'editor' | 'map-preview';

export interface DesktopDevToolsInput {
  type: string;
  key: string;
  shift?: boolean;
  control?: boolean;
  alt?: boolean;
  meta?: boolean;
  isAutoRepeat?: boolean;
}

interface InputEventLike {
  preventDefault(): void;
}

interface WebContentsLike {
  on(
    event: 'before-input-event',
    listener: (event: InputEventLike, input: DesktopDevToolsInput) => void,
  ): void;
  isDevToolsOpened(): boolean;
  openDevTools(options: { mode: 'detach'; activate: true }): void;
  closeDevTools(): void;
}

export function desktopDevToolsShortcut(input: DesktopDevToolsInput): DesktopDevToolsShortcut | null {
  if (
    input.type !== 'keyDown'
    || input.key !== 'F12'
    || input.isAutoRepeat
    || input.control
    || input.alt
    || input.meta
  ) {
    return null;
  }
  return input.shift ? 'map-preview' : 'editor';
}

export function registerDesktopDevToolsShortcuts(
  webContents: WebContentsLike,
): void {
  webContents.on('before-input-event', (event, input) => {
    const shortcut = desktopDevToolsShortcut(input);
    if (!shortcut) return;
    if (shortcut === 'map-preview') return;
    event.preventDefault();
    if (shortcut === 'editor') {
      if (webContents.isDevToolsOpened()) webContents.closeDevTools();
      else webContents.openDevTools({ mode: 'detach', activate: true });
      return;
    }
  });
}
