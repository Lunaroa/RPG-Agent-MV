import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, pickByLocale } from '../../../../contract/i18n.ts';

export function workspaceNoProjectsAvailable(language?: ProductLanguage | null): string {
  return pickByLocale(language ?? DEFAULT_PRODUCT_LANGUAGE, {
    'zh-CN': '未发现可用项目，请检查项目配置',
    'en-US': 'No usable projects were found. Check the project configuration.',
  });
}
