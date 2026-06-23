import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, isProductLanguage } from '../i18n/messages.ts';

const messages = {
  'zh-CN': {
    plan: '计划',
    planning: '计划模式',
    approvalRequested: '计划待批准',
    approvalResponseFailed: '计划审批响应失败',
    enterFailed: '进入计划模式失败',
    exitFailed: '退出计划模式失败',
    loadFailed: '加载计划失败',
  },
  'en-US': {
    plan: 'Plan',
    planning: 'Plan Mode',
    approvalRequested: 'Plan Awaiting Approval',
    approvalResponseFailed: 'Plan approval response failed',
    enterFailed: 'Failed to enter plan mode',
    exitFailed: 'Failed to exit plan mode',
    loadFailed: 'Failed to load plan',
  },
} as const satisfies Record<ProductLanguage, Record<string, string>>;

type SessionPlanMessages = (typeof messages)['en-US'];
export type SessionPlanMessageKey = keyof SessionPlanMessages;

export function sessionPlanText(language: ProductLanguage | null | undefined, key: SessionPlanMessageKey): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  const lookup = messages[normalized] as SessionPlanMessages;
  return lookup[key] || (messages['en-US'] as SessionPlanMessages)[key] || key;
}