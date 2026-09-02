const FALLBACK_TITLEBAR_HEIGHT = 38;

export function appTitlebarHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-titlebar-height');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_TITLEBAR_HEIGHT;
}
