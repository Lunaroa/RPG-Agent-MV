import { pickByLocale, type ProductLanguage } from '../../../../../contract/i18n.ts';
import { resolveLanguage } from '../../i18n/request-language.ts';

export function eventRegistryDefaultDialogue(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '（在此填写对话）',
    'en-US': '(enter dialogue here)',
  });
}

export function adoptedOrphanPurpose(
  mapId: number,
  eventId: number,
  eventName: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `收编自 Map${mapId} 既有事件 ${eventId}（${eventName}）的遗留事件，纳入注册表统一管理与对账。`,
    'en-US':
      `Adopted legacy event ${eventId} (${eventName}) from Map${mapId} into the registry for unified management and reconciliation.`,
  });
}
