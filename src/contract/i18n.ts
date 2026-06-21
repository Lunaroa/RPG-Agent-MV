/**
 * Single source of truth for the set of supported product languages.
 * Adding a language is one row here: the ProductLanguage union widens, and every
 * `pickByLocale` call site / locale-keyed dictionary that lacks the new code becomes
 * a compile error until the translation is supplied.
 */
export const PRODUCT_LOCALE_CODES = ['zh-CN', 'en-US'] as const

export type ProductLanguage = typeof PRODUCT_LOCALE_CODES[number]

/**
 * Boxed default for a brand-new / unset preference.
 */
export const DEFAULT_PRODUCT_LANGUAGE: ProductLanguage = 'en-US'

/**
 * Fallback for a present-but-unrecognized locale code (stale / corrupt stored value).
 * This handles dirty input only — missing translations are blocked at compile time, so
 * this never doubles as a translation fallback.
 */
export const DIRTY_DATA_FALLBACK_LANGUAGE: ProductLanguage = 'en-US'

export function isProductLanguage(value: unknown): value is ProductLanguage {
  return typeof value === 'string' && (PRODUCT_LOCALE_CODES as readonly string[]).includes(value)
}

export function normalizeProductLanguage(value: unknown): ProductLanguage {
  if (value == null || value === '') return DEFAULT_PRODUCT_LANGUAGE
  return isProductLanguage(value) ? value : DIRTY_DATA_FALLBACK_LANGUAGE
}

/**
 * Select a value for the current product language from a record the type system
 * requires to cover EVERY registered locale. The moment a code is added to
 * PRODUCT_LOCALE_CODES, every call site missing that key fails `tsc` — this is the
 * exhaustiveness gate. Generic over T, so strings, label tables, builder functions,
 * and separators all route through the same primitive.
 *
 * Shared between frontend and backend — this is the ONLY runtime export from the
 * contract layer, since the full messages dictionary lives in the frontend i18n module
 * (Node.js cannot resolve @contract aliases at runtime).
 */
export function pickByLocale<T>(
  language: ProductLanguage | null | undefined,
  byLocale: Record<ProductLanguage, T>,
): T {
  return byLocale[normalizeProductLanguage(language)]
}
