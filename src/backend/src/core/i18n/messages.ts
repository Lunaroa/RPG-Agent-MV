import type { ProductLanguage } from '../../../../contract/i18n.ts'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../../../../contract/i18n.ts'
import zhCN from './locales/zh-CN.ts'
import enUS from './locales/en-US.ts'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const satisfies Record<ProductLanguage, Record<string, string>>

export type BackendMessageKey = keyof typeof messages['zh-CN']

export function listBackendMessageKeys(language: ProductLanguage): BackendMessageKey[] {
  return Object.keys(messages[language]) as BackendMessageKey[]
}

export function backendText(
  key: BackendMessageKey,
  language: ProductLanguage | null | undefined,
  params: Record<string, string | number> = {},
): string {
  const normalized = normalizeProductLanguage(language)
  const languageMessages = messages[normalized] as Record<BackendMessageKey, string>
  const defaultMessages = messages[DEFAULT_PRODUCT_LANGUAGE] as Record<BackendMessageKey, string>
  let text = languageMessages[key] || defaultMessages[key] || key
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{{${name}}}`, String(value))
  }
  return text
}
