import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function projectManagedListInvalid(key: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${key} 数据无效`,
    'en-US': `${key} data is invalid`,
  });
}

export function projectManagedFixedDocumentIdRequired(group: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${group} 是固定文档条目，ID 必须为 0`,
    'en-US': `${group} is a fixed document entry; ID must be 0`,
  });
}

export function projectManagedEntryMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '项目条目不存在',
    'en-US': 'Project entry does not exist',
  });
}

export function projectManagedEntryInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '条目数据无效',
    'en-US': 'Entry data is invalid',
  });
}

export function projectManagedEntryIdImmutable(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '条目 ID 不允许修改',
    'en-US': 'Entry ID cannot be changed',
  });
}

export function projectManagedEntryInvalidWithIssues(issues: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `条目数据无效：${issues}`,
    'en-US': `Entry data is invalid: ${issues}`,
  });
}

export function projectManagedCreateDatabaseOnly(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '只能新增数据库条目',
    'en-US': 'Only database entries can be created',
  });
}

export function projectManagedFixedDocumentCannotCreate(group: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${group} 是固定文档条目，不能新增`,
    'en-US': `${group} is a fixed document entry and cannot be created`,
  });
}

export function projectManagedGroupMustBeArray(group: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${group} 数据不是数组表`,
    'en-US': `${group} data is not an array table`,
  });
}

export function projectManagedDatabaseKindInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '数据库类型无效',
    'en-US': 'Invalid database kind',
  });
}

export function projectManagedFileMissing(fileName: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `项目文件不存在：${fileName}`,
    'en-US': `Project file does not exist: ${fileName}`,
  });
}

export function projectManagedEntryIdInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '条目 ID 无效',
    'en-US': 'Invalid entry ID',
  });
}

export function projectManagedGroupInvalid(group: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${group} 数据无效`,
    'en-US': `${group} data is invalid`,
  });
}

export function projectManagedEntryLimitReached(
  group: string,
  maxEntries: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${group} 已达到 RPG Maker MV 的 ID 上限 ${maxEntries}`,
    'en-US': `${group} has reached the RPG Maker MV id limit of ${maxEntries}`,
  });
}

export function projectManagedOperationOwnedCannotRevert(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '这条修改属于 Agent 数据库操作，不能单独撤销；请放弃对应的完整操作',
    'en-US': 'This change belongs to an Agent database operation and cannot be reverted separately; discard the complete operation instead',
  });
}

export function projectManagedSystemSharedGroupImmutable(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': 'System 编辑不能改动类型或术语字段；请分别在 Types 或 Terms 中编辑，以保持固定 ID',
    'en-US': 'System editing cannot change type or term fields; edit them through Types or Terms to preserve stable ids',
  });
}

export function projectManagedTypeListInvalid(field: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `类型列表 ${field} 无效；ID 0 必须保留为空`,
    'en-US': `Type list ${field} is invalid; id 0 must remain empty`,
  });
}
