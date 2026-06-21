import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

/** Chinese aliases accepted when normalizing amount operations from agent-authored commands. */
export const AMOUNT_OPERATION_INCREASE_LOCAL_ALIASES = ['增加', '加'] as const;
export const AMOUNT_OPERATION_DECREASE_LOCAL_ALIASES = ['减少', '减'] as const;

export function rmmvInternalEncodingNote(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': 'RMMV内部编码',
    'en-US': 'RMMV internal encoding',
  });
}

export function commandNormalizationSummary(
  count: number,
  details: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `命令归一化修正了 ${count} 处：${details}`,
    'en-US': `Command normalization fixed ${count} issue(s): ${details}`,
  });
}

export function silentCorrection(note: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `静默修正: ${note}`,
    'en-US': `Silent correction: ${note}`,
  });
}

export function compileNormalizationSummary(count: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `[compile] 编译前归一化修正了 ${count} 处命令`,
    'en-US': `[compile] Pre-compile normalization fixed ${count} command(s)`,
  });
}
