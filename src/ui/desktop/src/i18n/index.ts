import { computed } from 'vue'
import { useSettingsStore } from '../stores/settings'
import {
  normalizeProductLanguage,
  translate,
  type MessageKey,
} from './messages'

export {
  DEFAULT_PRODUCT_LANGUAGE,
  DIRTY_DATA_FALLBACK_LANGUAGE,
  PRODUCT_LANGUAGE_OPTIONS,
  PRODUCT_LOCALE_CODES,
  normalizeProductLanguage,
  isProductLanguage,
  pickByLocale,
  translate,
  type MessageKey,
} from './messages'

export function useI18n() {
  const settingsStore = useSettingsStore()
  const language = computed(() => normalizeProductLanguage(settingsStore.ui.language))
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(key, language.value, params)
  return { language, t }
}
