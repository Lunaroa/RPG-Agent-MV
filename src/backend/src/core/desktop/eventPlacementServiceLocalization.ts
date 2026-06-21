import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function eventPlacementRegistryMissing(contractId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN':
      `契约「${contractId}」未在 event-registry 中找到，无法回写放置状态。`
      + '请确认 contractId 与 mcp__rmmv__RmmvEvent action=registry.register 登记的一致。',
    'en-US':
      `Contract "${contractId}" was not found in event-registry; placement status cannot be written back. `
      + 'Confirm contractId matches the entry registered via mcp__rmmv__RmmvEvent action=registry.register.',
  });
}
