import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function storyVersionManagementEnabled(message: string, language?: ProductLanguage | null): string {
  const suffix = pickByLocale(resolveLanguage(language), {
    'zh-CN': '，版本管理已启用',
    'en-US': '; version management is enabled',
  });
  return `${message}${suffix}`;
}

function storyEventRef(mapId: number, eventId: number | undefined, language: ProductLanguage): string {
  return pickByLocale(language, {
    'zh-CN': Number.isInteger(eventId) ? `MAP ${mapId} 事件 ${eventId}` : `MAP ${mapId} 事件（未知 ID）`,
    'en-US': Number.isInteger(eventId) ? `MAP ${mapId} event ${eventId}` : `MAP ${mapId} event (unknown ID)`,
  });
}

export function storyBaselineEventDeleted(
  mapId: number,
  eventId: number | undefined,
  language?: ProductLanguage | null,
): string {
  const lang = resolveLanguage(language);
  return pickByLocale(lang, {
    'zh-CN': `历史受保护事件已被删除：${storyEventRef(mapId, eventId, lang)}`,
    'en-US': `Historically protected event was deleted: ${storyEventRef(mapId, eventId, lang)}`,
  });
}

export function storyRegisteredEventMissing(
  mapId: number,
  eventId: number | undefined,
  language?: ProductLanguage | null,
): string {
  const lang = resolveLanguage(language);
  return pickByLocale(lang, {
    'zh-CN': `已登记事件在 JSON 中不存在：${storyEventRef(mapId, eventId, lang)}`,
    'en-US': `Registered event is missing from JSON: ${storyEventRef(mapId, eventId, lang)}`,
  });
}

export function storyBaselinePageDeleted(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '历史受保护页面已被删除。',
    'en-US': 'A historically protected page was deleted.',
  });
}

export function storyRegisteredPageMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已登记页面在 JSON 中不存在。',
    'en-US': 'Registered page is missing from JSON.',
  });
}

export function storyPageMissing(pageNodeId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `页面不存在：${pageNodeId}`,
    'en-US': `Page not found: ${pageNodeId}`,
  });
}

export function storyPageAnchorMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '页面缺少事件锚点',
    'en-US': 'Page is missing an event anchor',
  });
}

export function storyPageJsonLocationMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '无法在 JSON 中定位该页面',
    'en-US': 'Cannot locate this page in JSON',
  });
}

export function storyPageNodeLocationMissing(pageNodeId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `无法通过稳定页面 ID 定位页面：${pageNodeId}`,
    'en-US': `Cannot locate page by stable page ID: ${pageNodeId}`,
  });
}

export function storyPageIdentityUnrecognized(
  mapId: number,
  eventId: number,
  pageNumber: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `无法识别 MAP ${mapId} 事件 ${eventId} 第 ${pageNumber} 页的身份`,
    'en-US': `Cannot recognize page identity for MAP ${mapId} event ${eventId} page ${pageNumber}`,
  });
}

export function storyBaselineEventShellModified(
  mapId: number,
  eventId: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `历史受保护事件公共部分被修改：MAP ${mapId} 事件 ${eventId}`,
    'en-US': `Historically protected event shell was modified: MAP ${mapId} event ${eventId}`,
  });
}

export function storyBaselinePageModified(
  mapId: number,
  eventId: number,
  pageNumber: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `历史受保护页面被修改：MAP ${mapId} 事件 ${eventId} 第 ${pageNumber} 页`,
    'en-US': `Historically protected page was modified: MAP ${mapId} event ${eventId} page ${pageNumber}`,
  });
}

export function storyInvalidRmmvProject(project: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不是有效的 RPG Maker MV/MZ 工程：${project}`,
    'en-US': `Not a valid RPG Maker MV/MZ project: ${project}`,
  });
}

export function storyMapEventMissing(mapId: number, eventId: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `MAP ${mapId} 中不存在事件 ${eventId}`,
    'en-US': `Event ${eventId} does not exist on MAP ${mapId}`,
  });
}
