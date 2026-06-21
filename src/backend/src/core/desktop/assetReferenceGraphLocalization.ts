import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function assetGraphAssetMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产不存在',
    'en-US': 'Asset does not exist',
  });
}

export function assetGraphReferencedBlocker(count: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `资产仍被 ${count} 处引用，禁止删除`,
    'en-US': `Asset is still referenced in ${count} place(s); deletion is blocked`,
  });
}

export function assetGraphTargetNameOccupied(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标名称已存在',
    'en-US': 'Target name already exists',
  });
}

export function assetGraphIconsetRenameForbidden(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': 'IconSet 是 RMMV 图标索引的固定系统资源，不能安全重命名',
    'en-US': 'IconSet is a fixed RMMV system resource for icon indices and cannot be renamed safely',
  });
}

export function assetGraphUnsupportedCategory(category: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不支持的资产类型：${category}`,
    'en-US': `Unsupported asset category: ${category}`,
  });
}

export function assetGraphNameInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产名称无效',
    'en-US': 'Invalid asset name',
  });
}

export function assetGraphNameMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少资产名称',
    'en-US': 'Asset name is required',
  });
}
