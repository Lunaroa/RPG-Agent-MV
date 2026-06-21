import path from 'node:path';

import type { ProductLanguage } from './i18n.ts';

const USER_DOCS_ENTRY_SEGMENTS_BY_LANGUAGE: Record<ProductLanguage, string[]> = {
  'zh-CN': ['docs'],
  'en-US': ['docs', 'en'],
};

export function resolveUserDocsEntry(workflowRoot: string, language: ProductLanguage): string {
  return path.join(workflowRoot, ...USER_DOCS_ENTRY_SEGMENTS_BY_LANGUAGE[language]);
}
