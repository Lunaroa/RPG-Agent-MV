import type { UiSettings } from '@contract/types'

const THEME_CLASSES = ['theme-dark', 'theme-rpgmv', 'theme-saas'] as const

function resolveThemeClass(theme: string): string | null {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'theme-dark' : null
  }
  if (theme === 'rpgmv') return 'theme-rpgmv'
  if (theme === 'saas') return 'theme-saas'
  return null
}

export function applyUiTheme(ui: UiSettings): void {
  const root = document.documentElement
  for (const className of THEME_CLASSES) root.classList.remove(className)
  const themeClass = resolveThemeClass(String(ui.theme || 'auto'))
  if (themeClass) root.classList.add(themeClass)
  const fontSize = Number(ui.fontSize)
  if (Number.isFinite(fontSize) && fontSize > 0) {
    root.style.setProperty('--chat-font-size', `${fontSize}px`)
  } else {
    root.style.removeProperty('--chat-font-size')
  }
}
