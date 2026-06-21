import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function stagingSharedFilesRequireProjectAction(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '该暂存包含共享地图索引或资源文件，请使用项目级“应用”或“丢弃”。',
    'en-US': 'This staging batch includes shared map index or resource files. Use project-level Apply or Discard.',
  });
}
