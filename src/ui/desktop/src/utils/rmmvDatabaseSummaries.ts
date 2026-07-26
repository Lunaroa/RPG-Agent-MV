import type { ProductLanguage } from '@contract/types';
import { pickByLocale } from '../i18n/messages.ts';
import {
  mvEffectEditorValue,
  mvTraitEditorValue,
  normalizeMvEffect,
  normalizeMvTrait,
} from './rmmvDatabaseSemantics';

// Stock RM "content" column texts for trait/effect tables, e.g. 「命中率 + 95%」
// 「攻击力 * 100%」「战斗不能 100%」. The caller resolves the target label from
// catalog/options; this module only owns the numeric formatting rules.

const TRAIT_MULTIPLY_CODES = new Set([11, 12, 13, 21, 23]);

export function mvTraitContentSummary(traitValue: unknown, targetLabel: string): string {
  const trait = normalizeMvTrait(traitValue);
  const amount = mvTraitEditorValue(traitValue);
  if (TRAIT_MULTIPLY_CODES.has(trait.code)) return `${targetLabel} * ${amount}%`;
  if (trait.code === 22) return `${targetLabel} ${signedText(amount)}%`;
  if (trait.code === 32) return `${targetLabel} + ${amount}%`;
  if (trait.code === 33) return signedText(amount);
  if (trait.code === 34) return `+ ${amount}`;
  if (trait.code === 61) return `${amount}%`;
  return targetLabel;
}

export function mvEffectContentSummary(
  effectValue: unknown,
  targetLabel: string,
  language: ProductLanguage,
): string {
  const effect = normalizeMvEffect(effectValue);
  const value1 = mvEffectEditorValue(effectValue, 'value1');
  const value2 = mvEffectEditorValue(effectValue, 'value2');
  switch (effect.code) {
    case 11:
    case 12:
      return recoverText(value1, value2);
    case 13:
      return signedText(value1);
    case 21:
    case 22:
      return `${targetLabel} ${value1}%`;
    case 31:
    case 32:
      return pickByLocale(language, {
        'zh-CN': `${targetLabel} ${value1} 回合`,
        'en-US': `${targetLabel} ${value1} turns`,
      });
    case 41:
      return pickByLocale(language, {
        'zh-CN': '逃跑',
        'en-US': 'Escape',
      });
    case 42:
      return `${targetLabel} + ${value1}`;
    default:
      return targetLabel;
  }
}

/** Plugin (non-standard code) rows stay readable but read-only. */
export function mvSemanticRawSummary(code: number, dataId: number, values: number[]): string {
  return `code ${code} · dataId ${dataId} · ${values.join(' / ')}`;
}

function recoverText(rate: number, flat: number): string {
  const parts: string[] = [];
  if (rate !== 0) parts.push(`${signedText(rate)}%`);
  if (flat !== 0) parts.push(signedText(flat));
  return parts.length ? parts.join(' ') : '+ 0';
}

function signedText(value: number): string {
  return value < 0 ? `- ${Math.abs(value)}` : `+ ${value}`;
}
