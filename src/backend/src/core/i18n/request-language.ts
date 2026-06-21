import { AsyncLocalStorage } from 'node:async_hooks';

import {
  normalizeProductLanguage,
  type ProductLanguage,
} from '../../../../contract/i18n.ts';

const storage = new AsyncLocalStorage<ProductLanguage>();

export function withProductLanguage<T>(language: ProductLanguage, fn: () => T): T {
  return storage.run(normalizeProductLanguage(language), fn);
}

export function getRequestProductLanguage(): ProductLanguage {
  const language = storage.getStore();
  if (!language) {
    throw new Error(
      'getRequestProductLanguage() called outside an IPC request scope; wrap the handler with withProductLanguage()',
    );
  }
  return language;
}

export function resolveLanguage(explicit?: ProductLanguage | null): ProductLanguage {
  if (explicit != null && explicit !== '') {
    return normalizeProductLanguage(explicit);
  }
  return getRequestProductLanguage();
}
