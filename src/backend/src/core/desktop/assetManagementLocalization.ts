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
    'zh-CN': '目标资产已存在，覆盖导入需要显式开启 overwrite',
    'en-US': 'Target asset already exists; enable overwrite explicitly to replace it',
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

export function unsupportedAssetExtension(category: string, extension: string, language?: ProductLanguage | null): string {
  const extLabel = extension || pickByLocale(resolveLanguage(language), {
    'zh-CN': '无扩展名',
    'en-US': 'no extension',
  });
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `资产类型 ${category} 不支持 ${extLabel} 文件`,
    'en-US': `Asset category ${category} does not support ${extLabel} files`,
  });
}
