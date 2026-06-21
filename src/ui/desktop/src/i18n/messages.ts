import type { ProductLanguage } from '@contract/types'
import {
  DEFAULT_PRODUCT_LANGUAGE,
  DIRTY_DATA_FALLBACK_LANGUAGE,
  PRODUCT_LOCALE_CODES,
  isProductLanguage,
  normalizeProductLanguage,
  pickByLocale,
} from '../../../../contract/i18n.ts'
export {
  DEFAULT_PRODUCT_LANGUAGE,
  DIRTY_DATA_FALLBACK_LANGUAGE,
  PRODUCT_LOCALE_CODES,
  isProductLanguage,
  normalizeProductLanguage,
  pickByLocale,
}


import zhCN from './locales/zh-CN.ts'
import enUS from './locales/en-US.ts'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const satisfies Record<ProductLanguage, Record<string, string>>


export type MessageKey = keyof typeof messages['zh-CN']

export function listMessageKeys(language: ProductLanguage): MessageKey[] {
  return Object.keys(messages[language]) as MessageKey[]
}

export function translate(
  key: MessageKey,
  language: ProductLanguage,
  params: Record<string, string | number> = {},
): string {
  const languageMessages = messages[language] as Record<MessageKey, string>
  const defaultMessages = messages[DEFAULT_PRODUCT_LANGUAGE] as Record<MessageKey, string>
  let text = languageMessages[key] || defaultMessages[key] || key
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{{${name}}}`, String(value))
  }
  return text
}

/**
 * Label key per locale. Typed as an exhaustive Record so adding a code to
 * PRODUCT_LOCALE_CODES forces a new label key here (compile error otherwise).
 */
const LANGUAGE_LABEL_KEYS: Record<ProductLanguage, MessageKey> = {
  'zh-CN': 'settings.ui.language.zhCn',
  'en-US': 'settings.ui.language.enUs',
}

export const PRODUCT_LANGUAGE_OPTIONS: Array<{ value: ProductLanguage; labelKey: MessageKey }> =
  PRODUCT_LOCALE_CODES.map((value) => ({ value, labelKey: LANGUAGE_LABEL_KEYS[value] }))
