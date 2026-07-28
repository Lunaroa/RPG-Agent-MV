import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function externalImportSourceInvalid(detail: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `外部工程无效：${detail}`,
    'en-US': `The external project is invalid: ${detail}`,
  });
}

export function externalImportSourceEncrypted(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `外部工程「${name}」的资源已加密，无法直接导入。请先解密该工程再导入。`,
    'en-US': `The external project "${name}" has encrypted resources and cannot be imported as-is. Decrypt the project first.`,
  });
}

export function externalImportNoMaps(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '请至少选择一张要导入的地图',
    'en-US': 'Select at least one map to import',
  });
}

export function externalImportSourceMapMissing(mapId: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `外部工程中找不到地图 ${mapId}`,
    'en-US': `Map ${mapId} was not found in the external project`,
  });
}

export function externalImportSourceTilesetMissing(tilesetId: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `外部工程缺少图块配置 ${tilesetId}，请为使用它的地图选择一个目标图块配置`,
    'en-US': `The external project is missing tileset ${tilesetId}; pick a target tileset for the maps that use it`,
  });
}

export function externalImportTilesetTargetRequired(sourceTilesetId: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `图块配置 ${sourceTilesetId} 选择了「忽略」或「覆盖」，必须指定一个目标图块配置`,
    'en-US': `Tileset ${sourceTilesetId} is set to ignore/overwrite and needs a target tileset id`,
  });
}

export function externalImportResourceSourceMissing(relativePath: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `源资源文件缺失，已跳过：${relativePath}`,
    'en-US': `Source asset file is missing and was skipped: ${relativePath}`,
  });
}

export function externalImportEventsNotValidated(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已按原样导入事件，未校验事件命令中引用的资源',
    'en-US': 'Events were imported as-is; asset references inside event commands were not validated',
  });
}

export function externalImportUnmappedReferences(count: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `检测到 ${count} 处跨工程 ID 引用（场所移动地图、公共事件等），未自动映射，请自行核对`,
    'en-US': `Detected ${count} cross-project ID reference(s) (transfers, common events, ...) that were not remapped; verify them manually`,
  });
}

export function externalImportCriticalTilesetImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `关键图块图片缺失：${name}`,
    'en-US': `A critical tileset image is missing: ${name}`,
  });
}

export function externalReplaceTargetMapMissing(mapId: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `找不到要替换的目标地图 ${mapId}`,
    'en-US': `The target map ${mapId} to replace was not found`,
  });
}

export function externalReplaceOutOfBoundsEvents(count: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `保留的目标事件中有 ${count} 个坐标超出新地图范围，替换后需自行调整（不会自动删除或移动）`,
    'en-US': `${count} kept target event(s) fall outside the new map bounds; adjust them after replacing (they are not auto-removed or moved)`,
  });
}
