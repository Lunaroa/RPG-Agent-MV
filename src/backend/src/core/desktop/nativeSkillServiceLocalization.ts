import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function nativeSkillUsagePrinciples(language?: ProductLanguage | null): readonly string[] {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': [
      '## 使用原则',
      '',
      '- 先读取当前项目事实，再给出判断。',
      '- 缺少关键约束时直接 ASK，不要自行假设。',
      '- 需要写入工程时遵守项目的受控写入、验证和回滚流程。',
    ],
    'en-US': [
      '## Usage principles',
      '',
      '- Read current project facts before making judgments.',
      '- ASK when key constraints are missing; do not assume them.',
      '- When writing to the project, follow its controlled write, validation, and rollback flow.',
    ],
  });
}
