import type { MapPreviewDevToolsResult } from '../../../contract/types.ts';

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

export interface DesktopDevToolsShortcutDependencies {
  toggleMapPreview(): Promise<MapPreviewDevToolsResult>;
  onMapPreviewResult(result: MapPreviewDevToolsResult): void;
  onMapPreviewError(error: unknown): void;
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
  dependencies: DesktopDevToolsShortcutDependencies,
): void {
  webContents.on('before-input-event', (event, input) => {
    const shortcut = desktopDevToolsShortcut(input);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === 'editor') {
      if (webContents.isDevToolsOpened()) webContents.closeDevTools();
      else webContents.openDevTools({ mode: 'detach', activate: true });
      return;
    }
    void dependencies.toggleMapPreview()
      .then((result) => dependencies.onMapPreviewResult(result))
      .catch((error) => dependencies.onMapPreviewError(error));
  });
}
