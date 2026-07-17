import path from 'node:path';

export const UI_CONTROL_WINDOW_MODE = 'background' as const;

export interface DesktopWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StoredWindowOptions {
  width: number;
  height: number;
  x?: number;
  y?: number;
  shouldMaximize: boolean;
}

export interface DesktopWindowPolicy {
  backgroundUiControl: boolean;
  width: number;
  height: number;
  x?: number;
  y?: number;
  show: boolean;
  skipTaskbar: boolean;
  focusable: boolean;
  paintWhenInitiallyHidden: boolean;
  backgroundThrottling: boolean;
  useContentSize: boolean;
  shouldMaximize: boolean;
  persistWindowState: boolean;
}

export function isBackgroundUiControlMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.AGENT_RPG_UI_CONTROL === '1';
}

export function buildDesktopWindowPolicy(
  stored: StoredWindowOptions,
  backgroundUiControl: boolean,
  backgroundWorkArea?: DesktopWorkArea,
): DesktopWindowPolicy {
  if (backgroundUiControl) {
    if (!isValidWorkArea(backgroundWorkArea)) {
      throw new Error('Electron background validation requires a valid primary display work area.');
    }
    return {
      backgroundUiControl: true,
      width: Math.floor(backgroundWorkArea.width),
      height: Math.floor(backgroundWorkArea.height),
      x: Math.floor(backgroundWorkArea.x),
      y: Math.floor(backgroundWorkArea.y),
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
      useContentSize: true,
      shouldMaximize: false,
      persistWindowState: false,
    };
  }
  return {
    backgroundUiControl: false,
    width: stored.width,
    height: stored.height,
    x: stored.x,
    y: stored.y,
    show: true,
    skipTaskbar: false,
    focusable: true,
    paintWhenInitiallyHidden: true,
    backgroundThrottling: true,
    useContentSize: false,
    shouldMaximize: stored.shouldMaximize,
    persistWindowState: true,
  };
}

function isValidWorkArea(value: DesktopWorkArea | undefined): value is DesktopWorkArea {
  return Boolean(
    value
      && Number.isFinite(value.x)
      && Number.isFinite(value.y)
      && Number.isFinite(value.width)
      && Number.isFinite(value.height)
      && value.width >= 1
      && value.height >= 1,
  );
}

export function uiControlProfilePath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), 'runtime', 'out', 'ui-control', 'electron-profile');
}
