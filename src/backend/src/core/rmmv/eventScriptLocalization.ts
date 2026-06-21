import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

type Cmd = Record<string, unknown>;

export function eventScriptTriggerLabels(language?: ProductLanguage | null): Record<string, string> {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': {
      'action-button': '调查触发',
      'player-touch': '碰触触发',
      'event-touch': '事件碰触',
      autorun: '自动执行',
      parallel: '并行执行',
    },
    'en-US': {
      'action-button': 'Action Button',
      'player-touch': 'Player Touch',
      'event-touch': 'Event Touch',
      autorun: 'Autorun',
      parallel: 'Parallel',
    },
  });
}

function eventScriptBalloonLabels(language?: ProductLanguage | null): Record<number, string> {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': {
      1: '!',
      2: '?',
      3: '♪',
      4: '❤',
      5: '怒',
      6: '汗',
      7: '烦躁',
      8: '…',
      9: '灵感',
      10: 'Zzz',
    },
    'en-US': {
      1: '!',
      2: '?',
      3: '♪',
      4: '❤',
      5: 'Angry',
      6: 'Sweat',
      7: 'Irritated',
      8: '…',
      9: 'Idea',
      10: 'Zzz',
    },
  });
}

export function eventScriptText(language?: ProductLanguage | null) {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': {
      emptyChoice: '（空选项）',
      choicePrompt: '玩家选择',
      elseBranch: '否则',
      loop: '循环',
      breakLoop: '跳出循环',
      screenTint: '画面色调变化',
      screenFlash: '闪屏',
      screenShake: '震屏',
      fadeout: '画面渐黑',
      fadein: '画面渐亮',
      emptyPage: '（本页无可见演出，仅条件或标记）',
    },
    'en-US': {
      emptyChoice: '(empty choice)',
      choicePrompt: 'Player choice',
      elseBranch: 'Else',
      loop: 'Loop',
      breakLoop: 'Break loop',
      screenTint: 'Screen tint',
      screenFlash: 'Screen flash',
      screenShake: 'Screen shake',
      fadeout: 'Fade out',
      fadein: 'Fade in',
      emptyPage: '(No visible staging on this page; conditions or markers only)',
    },
  });
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function eventScriptOnOff(value: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': value === false ? '关' : '开',
    'en-US': value === false ? 'OFF' : 'ON',
  });
}

export function eventScriptBranchConditionLabel(
  condition: Cmd | undefined,
  language?: ProductLanguage | null,
): string {
  const lang = resolveLanguage(language);
  if (!condition || typeof condition !== 'object') {
    return pickByLocale(lang, { 'zh-CN': '条件成立', 'en-US': 'Condition met' });
  }
  const kind = str(condition.kind);
  if (kind === 'switch') {
    return pickByLocale(lang, {
      'zh-CN': `开关 #${num(condition.id) ?? '?'} ${eventScriptOnOff(condition.value, lang)}`,
      'en-US': `Switch #${num(condition.id) ?? '?'} ${eventScriptOnOff(condition.value, lang)}`,
    });
  }
  if (kind === 'variable') {
    return pickByLocale(lang, {
      'zh-CN': `变量 #${num(condition.id) ?? '?'} ${str(condition.operator) || '>='} ${num(condition.value) ?? 0}`,
      'en-US': `Variable #${num(condition.id) ?? '?'} ${str(condition.operator) || '>='} ${num(condition.value) ?? 0}`,
    });
  }
  if (kind === 'self-switch') {
    return pickByLocale(lang, {
      'zh-CN': `自开关 ${str(condition.name) || '?'} ${eventScriptOnOff(condition.value, lang)}`,
      'en-US': `Self switch ${str(condition.name) || '?'} ${eventScriptOnOff(condition.value, lang)}`,
    });
  }
  return pickByLocale(lang, { 'zh-CN': '条件成立', 'en-US': 'Condition met' });
}

export function eventScriptIfLabel(conditionLabel: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `如果 ${conditionLabel}`,
    'en-US': `If ${conditionLabel}`,
  });
}

export function eventScriptPageConditionLabel(
  conditions: unknown,
  language?: ProductLanguage | null,
): string | undefined {
  const lang = resolveLanguage(language);
  if (!conditions || typeof conditions !== 'object') return undefined;
  const cond = conditions as Cmd;
  const parts: string[] = [];
  if (typeof cond.selfSwitch === 'string') {
    parts.push(pickByLocale(lang, {
      'zh-CN': `自开关 ${cond.selfSwitch}=开`,
      'en-US': `Self switch ${cond.selfSwitch}=ON`,
    }));
  }
  if (Array.isArray(cond.switchIds) && cond.switchIds.length) {
    parts.push(pickByLocale(lang, {
      'zh-CN': `开关 ${(cond.switchIds as number[]).map((id) => `#${id}`).join('、')}=开`,
      'en-US': `Switch ${(cond.switchIds as number[]).map((id) => `#${id}`).join(', ')}=ON`,
    }));
  }
  const variable = cond.variable as Cmd | undefined;
  if (variable && typeof variable === 'object') {
    parts.push(pickByLocale(lang, {
      'zh-CN': `变量 #${num(variable.id) ?? '?'} ≥ ${num(variable.min) ?? 0}`,
      'en-US': `Variable #${num(variable.id) ?? '?'} ≥ ${num(variable.min) ?? 0}`,
    }));
  }
  if (!parts.length) return undefined;
  return pickByLocale(lang, {
    'zh-CN': `需 ${parts.join('，')}`,
    'en-US': `Requires ${parts.join(', ')}`,
  });
}

export function eventScriptMoveTargetLabel(target: unknown, language?: ProductLanguage | null): string {
  const lang = resolveLanguage(language);
  if (target === undefined || target === 'this-event') {
    return pickByLocale(lang, { 'zh-CN': '本事件', 'en-US': 'This event' });
  }
  if (target === 'player') {
    return pickByLocale(lang, { 'zh-CN': '玩家', 'en-US': 'Player' });
  }
  const id = num(target);
  if (id) {
    return pickByLocale(lang, { 'zh-CN': `事件 #${id}`, 'en-US': `Event #${id}` });
  }
  const eventId = target && typeof target === 'object' ? num((target as Cmd).eventId) : undefined;
  if (eventId) {
    return pickByLocale(lang, { 'zh-CN': `事件 #${eventId}`, 'en-US': `Event #${eventId}` });
  }
  return pickByLocale(lang, { 'zh-CN': '本事件', 'en-US': 'This event' });
}

export function eventScriptWaitLabel(frames: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `停顿 ${frames} 帧`,
    'en-US': `Wait ${frames} frames`,
  });
}

export function eventScriptBalloonLabel(balloonId: number | undefined, language?: ProductLanguage | null): string {
  const lang = resolveLanguage(language);
  const labels = eventScriptBalloonLabels(lang);
  const label = labels[balloonId ?? -1] || `#${balloonId ?? '?'}`;
  return pickByLocale(lang, {
    'zh-CN': `头顶气泡 ${label}`,
    'en-US': `Balloon icon ${label}`,
  });
}

export function eventScriptSoundEffectLabel(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `音效 ${name || '?'}`,
    'en-US': `SE ${name || '?'}`,
  });
}

export function eventScriptMoveLabel(target: unknown, language?: ProductLanguage | null): string {
  const lang = resolveLanguage(language);
  return pickByLocale(lang, {
    'zh-CN': `${eventScriptMoveTargetLabel(target, lang)} 移动`,
    'en-US': `Move ${eventScriptMoveTargetLabel(target, lang)}`,
  });
}

export function eventScriptAnimationLabel(animationId: number | undefined, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `播放动画 #${animationId ?? '?'}`,
    'en-US': `Play animation #${animationId ?? '?'}`,
  });
}

export function eventScriptTransferLabel(
  mapId: number | undefined,
  x: number | undefined,
  y: number | undefined,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `传送 → 地图 #${mapId ?? '?'} (${x ?? '?'}, ${y ?? '?'})`,
    'en-US': `Transfer → Map #${mapId ?? '?'} (${x ?? '?'}, ${y ?? '?'})`,
  });
}

export function eventScriptCommonEventLabel(id: number | undefined, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `调用公共事件 #${id ?? '?'}`,
    'en-US': `Call common event #${id ?? '?'}`,
  });
}

export function eventScriptPluginCommandLabel(command: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `插件指令 ${command}`,
    'en-US': `Plugin command ${command}`,
  });
}

export function eventScriptSelfSwitchLabel(
  name: string,
  value: unknown,
  language?: ProductLanguage | null,
): string {
  const lang = resolveLanguage(language);
  return pickByLocale(lang, {
    'zh-CN': `自开关 ${name || '?'} = ${eventScriptOnOff(value, lang)}`,
    'en-US': `Self switch ${name || '?'} = ${eventScriptOnOff(value, lang)}`,
  });
}

export function eventScriptSwitchLabel(
  id: number | undefined,
  value: unknown,
  language?: ProductLanguage | null,
): string {
  const lang = resolveLanguage(language);
  return pickByLocale(lang, {
    'zh-CN': `开关 #${id ?? '?'} = ${eventScriptOnOff(value, lang)}`,
    'en-US': `Switch #${id ?? '?'} = ${eventScriptOnOff(value, lang)}`,
  });
}

export function eventScriptVariableLabel(
  id: number | undefined,
  value: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `变量 #${id ?? '?'} = ${value}`,
    'en-US': `Variable #${id ?? '?'} = ${value}`,
  });
}

export function eventScriptGoldLabel(sign: string, value: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `金钱 ${sign}${Math.abs(value)}`,
    'en-US': `Gold ${sign}${Math.abs(value)}`,
  });
}

export function eventScriptItemLabel(
  itemId: number | undefined,
  sign: string,
  value: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `道具 #${itemId ?? '?'} ${sign}${Math.abs(value)}`,
    'en-US': `Item #${itemId ?? '?'} ${sign}${Math.abs(value)}`,
  });
}

export function eventScriptUnknownCommandLabel(kind: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `未知命令 ${kind || '(空)'}`,
    'en-US': `Unknown command ${kind || '(empty)'}`,
  });
}
