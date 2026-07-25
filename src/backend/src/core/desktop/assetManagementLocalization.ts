import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function assetManagementAssetMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产不存在',
    'en-US': 'Asset does not exist',
  });
}

export function assetManagementMissingParams(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少参数',
    'en-US': 'Missing parameters',
  });
}

export function assetManagementReplacementSameAsMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标名称与缺失引用名称重复',
    'en-US': 'Replacement name matches the missing reference name',
  });
}

export function assetManagementReplacementAssetMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标资源不存在',
    'en-US': 'Replacement asset does not exist',
  });
}

export function assetManagementNotMissingReference(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '该引用不是缺失引用',
    'en-US': 'This reference is not a missing reference',
  });
}

export function assetManagementReplacementUnsupported(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '当前缺失引用位置暂不支持自动替换',
    'en-US': 'Automatic replacement is not supported for this missing reference location',
  });
}

export function assetManagementSourceNotFile(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '源文件不是普通文件',
    'en-US': 'Source file is not a regular file',
  });
}

export function assetManagementOverwriteRequired(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标素材已存在，需要明确选择覆盖后才能替换',
    'en-US': 'Target asset already exists; choose replace explicitly to overwrite it',
  });
}

export function assetManagementTargetNameExists(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标名称已存在',
    'en-US': 'Target name already exists',
  });
}

export function assetManagementPathOutOfBounds(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产路径越界',
    'en-US': 'Asset path is out of bounds',
  });
}

export function assetManagementInvalidName(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产名称无效',
    'en-US': 'Invalid asset name',
  });
}

export function assetManagementInvalidPath(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '资产路径无效',
    'en-US': 'Invalid asset path',
  });
}

export function assetManagementSourceRequired(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少源文件',
    'en-US': 'Source file is required',
  });
}

export function assetManagementSourceMustBeAbsolute(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '源文件必须是绝对路径',
    'en-US': 'Source file must be an absolute path',
  });
}

export function assetManagementSourceMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '源文件不存在',
    'en-US': 'Source file does not exist',
  });
}

export function assetManagementImportParamsMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少导入参数',
    'en-US': 'Missing import parameters',
  });
}

export function assetManagementCategoryMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少资产类型',
    'en-US': 'Missing asset category',
  });
}

export function assetManagementOverwriteMustBeBoolean(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': 'overwrite 必须是布尔值',
    'en-US': 'overwrite must be a boolean',
  });
}

export function unsupportedAssetCategory(category: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不支持的资产类型：${category}`,
    'en-US': `Unsupported asset category: ${category}`,
  });
}

export function unsupportedAssetExtension(
  categoryLabel: string,
  extension: string,
  allowedExtensions: readonly string[],
  language?: ProductLanguage | null,
): string {
  const extLabel = extension || pickByLocale(resolveLanguage(language), {
    'zh-CN': '无扩展名',
    'en-US': 'no extension',
  });
  const allowedLabel = allowedExtensions.join(', ');
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `「${categoryLabel}」不支持 ${extLabel} 文件（允许：${allowedLabel}）`,
    'en-US': `"${categoryLabel}" does not support ${extLabel} files (allowed: ${allowedLabel})`,
  });
}

export function assetManagementImportBatchEmpty(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '批量导入至少需要一个本地文件',
    'en-US': 'Batch import requires at least one local file',
  });
}

export function assetManagementImportDuplicateTarget(targetName: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `同一批导入中重复的目标名：${targetName}`,
    'en-US': `Duplicate target name in the same import batch: ${targetName}`,
  });
}

export function assetManagementTrashPortMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '未注入系统回收站端口，无法删除工程素材',
    'en-US': 'System trash port is not injected; cannot delete project assets',
  });
}

export function assetManagementTrashFailed(
  relativePath: string,
  reason: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `无法将 ${relativePath} 移入系统回收站：${reason}`,
    'en-US': `Could not move ${relativePath} to the system trash: ${reason}`,
  });
}

export function assetManagementDeletePartialFailure(
  deleted: readonly string[],
  failed: readonly string[],
  language?: ProductLanguage | null,
): string {
  const deletedLabel = deleted.length ? deleted.join(', ') : pickByLocale(resolveLanguage(language), {
    'zh-CN': '无',
    'en-US': 'none',
  });
  const failedLabel = failed.join('; ');
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `素材删除部分失败。已进入回收站：${deletedLabel}。未删除：${failedLabel}`,
    'en-US': `Asset delete partially failed. Moved to trash: ${deletedLabel}. Not deleted: ${failedLabel}`,
  });
}

export function assetManagementSubfolderUnsupported(nodeId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `仅支持重命名或删除 MZ 图片子文件夹；收到：${nodeId}`,
    'en-US': `Only MZ picture subfolders can be renamed or deleted; got: ${nodeId}`,
  });
}

export function assetManagementSubfolderMissing(directory: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `文件夹不存在：${directory}`,
    'en-US': `Folder does not exist: ${directory}`,
  });
}

export function assetManagementSubfolderNameOccupied(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `目标文件夹名称已存在：${name}`,
    'en-US': `Target folder name already exists: ${name}`,
  });
}
