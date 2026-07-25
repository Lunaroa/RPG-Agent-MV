import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function stagingSharedFilesRequireProjectAction(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '该暂存包含共享地图索引或资源文件，请使用项目级“应用”或“丢弃”。',
    'en-US': 'This staging batch includes shared map index or resource files. Use project-level Apply or Discard.',
  });
}

export function stagingUnappliedDraftBlocksAssetMutation(
  relativePath: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `文件 ${relativePath} 已有未应用的暂存草稿，请先应用或丢弃暂存后再操作素材`,
    'en-US': `File ${relativePath} already has an unapplied staging draft; apply or discard staging before mutating assets`,
  });
}

export function stagingOperationReservationBlocksAssetMutation(
  relativePath: string,
  operationId: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `文件 ${relativePath} 已被数据库暂存操作 ${operationId} 预约，请先应用或丢弃该操作后再操作素材`,
    'en-US': `File ${relativePath} is reserved by database staging operation ${operationId}; apply or discard that operation before mutating assets`,
  });
}

export function stagingChangedDuringAssetDelete(
  deletedRelativePaths: readonly string[],
  language?: ProductLanguage | null,
): string {
  const deletedLabel = deletedRelativePaths.length
    ? deletedRelativePaths.join(', ')
    : pickByLocale(resolveLanguage(language), { 'zh-CN': '无', 'en-US': 'none' });
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `删除过程中工程暂存状态发生变化。已进入回收站：${deletedLabel}。请先处理暂存后再重试。`,
    'en-US': `Project staging changed while deleting assets. Moved to trash: ${deletedLabel}. Resolve staging, then retry.`,
  });
}
