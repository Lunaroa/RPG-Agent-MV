import type { ProductLanguage, UiSettings } from '@contract/types'
import { isProductLanguage } from '../../../../contract/i18n.ts'

export function needsLanguageSelection(ui: UiSettings | null | undefined): boolean {
  return ui?.language == null
}

export function guessSystemLanguage(): ProductLanguage {
  const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
  if (/^zh/i.test(nav)) return 'zh-CN'
  return 'en-US'
}

export function readSavedProductLanguage(ui: UiSettings | null | undefined): ProductLanguage | null {
  const language = ui?.language
  return isProductLanguage(language) ? language : null
}
