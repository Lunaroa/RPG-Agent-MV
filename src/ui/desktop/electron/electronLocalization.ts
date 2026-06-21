import type { ProductLanguage } from '../../../contract/i18n.ts';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../../../contract/i18n.ts';

const messages = {
  'zh-CN': {
    'staging.checkFailed': '检查暂存失败',
    'staging.savePrompt': '是否保存修改',
    'staging.save': '是',
    'staging.discard': '否',
    'staging.cancel': '取消',
    'staging.closeDetail': '当前项目存在暂存修改。选择“是”保存到工程；选择“否”放弃暂存；选择“取消”回到当前界面。',
    'staging.saveFailed': '保存修改失败',
    'staging.discardFailed': '放弃修改失败',
    'projects.selectDirectoryTitle': '选择 RPG Maker MV 项目目录',
    'projects.selectDirectoryUnsupported': '当前运行环境不支持选择项目目录',
    'settings.defaultVariant': '默认',
    'main.closeCheckFailed': '退出检查失败',
    'main.startupFailedTitle': '应用启动失败，即将退出',
    'main.startupFailedDetail': 'Agent Console 未能就绪：\n\n{{message}}\n\n常见原因：依赖加载失败或配置错误。',
  },
  'en-US': {
    'staging.checkFailed': 'Failed to Check Staging',
    'staging.savePrompt': 'Save Changes?',
    'staging.save': 'Save',
    'staging.discard': 'Discard',
    'staging.cancel': 'Cancel',
    'staging.closeDetail': 'The current project has staged changes. Save writes them to the project, Discard removes the staging draft, and Cancel returns to the current window.',
    'staging.saveFailed': 'Failed to Save Changes',
    'staging.discardFailed': 'Failed to Discard Changes',
    'projects.selectDirectoryTitle': 'Select RPG Maker MV Project Folder',
    'projects.selectDirectoryUnsupported': 'This runtime does not support selecting a project folder.',
    'settings.defaultVariant': 'Default',
    'main.closeCheckFailed': 'Failed to Check Before Exit',
    'main.startupFailedTitle': 'Startup Failed',
    'main.startupFailedDetail': 'Agent Console could not finish startup:\n\n{{message}}\n\nCommon causes: dependency loading failed or configuration is invalid.',
  },
} as const;

export type ElectronMessageKey = keyof typeof messages['zh-CN'];

export function electronText(
  language: ProductLanguage | null | undefined,
  key: ElectronMessageKey,
  params: Record<string, string | number> = {},
): string {
  const normalized = normalizeProductLanguage(language);
  let text = messages[normalized][key] || messages[DEFAULT_PRODUCT_LANGUAGE][key] || key;
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}

export function stagingCloseButtons(language: ProductLanguage | null | undefined): string[] {
  return [
    electronText(language, 'staging.save'),
    electronText(language, 'staging.discard'),
    electronText(language, 'staging.cancel'),
  ];
}
