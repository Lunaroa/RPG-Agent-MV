import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function outlineInputNotObject(type: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `大纲输入不是对象(${type})，静默降级为空对象`,
    'en-US': `Outline input is not an object (${type}); falling back to an empty object`,
  });
}

export function outlineBodyAliasRead(source: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `大纲 body 字段通过别名 "${source}" 读取，Agent 应使用 "body" 字段`,
    'en-US': `Outline body was read via alias "${source}"; agents should use the "body" field`,
  });
}
