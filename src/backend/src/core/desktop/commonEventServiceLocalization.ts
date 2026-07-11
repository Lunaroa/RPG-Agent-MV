import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function commonEventMissing(id: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `公共事件不存在：${id}`,
    'en-US': `Common event does not exist: ${id}`,
  });
}

export function commonEventAlreadyExists(id: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `公共事件 ${id} 已存在`,
    'en-US': `Common event ${id} already exists`,
  });
}

export function commonEventInvalidData(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '公共事件数据无效',
    'en-US': 'Invalid common event data',
  });
}

export function commonEventReferenced(id: number, detail: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `公共事件 ${id} 仍被引用，拒绝删除：${detail}`,
    'en-US': `Common event ${id} is still referenced; delete refused: ${detail}`,
  });
}

export function commonEventInvalidTrigger(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '公共事件触发类型必须是 0/1/2',
    'en-US': 'Common event trigger must be 0, 1, or 2',
  });
}

export function commonEventNoTriggerSwitchMustBeZero(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '公共事件触发为无时 switchId 必须为 0',
    'en-US': 'When common event trigger is None, switchId must be 0',
  });
}

export function commonEventSwitchRequired(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '自动/并行公共事件必须设置有效开关',
    'en-US': 'Autorun/parallel common events must set a valid switch',
  });
}

export function commonEventSwitchOutOfRange(switchId: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `公共事件条件开关 ${switchId} 超出 System.switches 范围`,
    'en-US': `Common event condition switch ${switchId} is outside System.switches range`,
  });
}

export function commandListMustBeArray(label: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label} 必须是事件指令数组`,
    'en-US': `${label} must be an event command array`,
  });
}

export function commandIndentJump(label: string, index: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label}[${index}] 缩进跳级`,
    'en-US': `${label}[${index}] has an indent jump`,
  });
}

export function commandContinuationWithoutHead(
  label: string,
  index: number,
  code: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label}[${index}] 结构续行 ${code} 没有对应块头`,
    'en-US': `${label}[${index}] continuation line ${code} has no matching block head`,
  });
}

export function commandListMustTerminate(label: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label} 必须以 indent 0 的 code 0 结束`,
    'en-US': `${label} must end with code 0 at indent 0`,
  });
}

export function commonEventsJsonMustBeArray(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': 'CommonEvents.json 必须是数组',
    'en-US': 'CommonEvents.json must be an array',
  });
}

export function commonEventInvalidId(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '公共事件 ID 无效',
    'en-US': 'Invalid common event ID',
  });
}

export function commonEventLimitReached(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '公共事件已达到 RPG Maker MV 的 ID 上限 1000',
    'en-US': 'Common events have reached the RPG Maker MV id limit of 1000',
  });
}
