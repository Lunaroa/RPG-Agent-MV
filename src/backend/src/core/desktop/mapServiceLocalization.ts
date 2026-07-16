import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function mapSystemJsonMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '项目缺少 System.json',
    'en-US': 'Project is missing System.json',
  });
}

export function mapLibraryEntryNotFound(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '未找到地图条目',
    'en-US': 'Map entry not found',
  });
}

export function mapTilesetPreimportFailed(tilesetId: unknown, detail: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `图块集预导入失败（tileset ${tilesetId}）：${detail}`,
    'en-US': `Tileset pre-import failed (tileset ${tilesetId}): ${detail}`,
  });
}

export function mapImportFailed(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '导入失败',
    'en-US': 'Import failed',
  });
}

export function mapPackageTransferIdsRemapped(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已重映射包内传送指令的目标地图 id',
    'en-US': 'Remapped transfer-command target map IDs inside the package',
  });
}

export function mapPositionTargetInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '位置目标无效',
    'en-US': 'Invalid position target',
  });
}

export function mapIdInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '地图 ID 无效',
    'en-US': 'Invalid map ID',
  });
}

export function mapStartCoordinateInvalid(label: 'x' | 'y', language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `初始位置 ${label} 坐标无效`,
    'en-US': `Invalid start position ${label} coordinate`,
  });
}

export function mapSizeInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '地图尺寸无效',
    'en-US': 'Invalid map size',
  });
}

export function mapStartCoordinateOutOfBounds(label: 'x' | 'y', value: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `初始位置 (${label}=${value}) 超出地图边界`,
    'en-US': `Start position (${label}=${value}) is outside map bounds`,
  });
}

export function mapProjectTilesetImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 tileset 图片: ${name}.png（当前地图图块集引用了该文件，请检查项目 img/tilesets 目录）`,
    'en-US': `Missing tileset image: ${name}.png (the current map tileset references this file; check the project img/tilesets directory)`,
  });
}

export function mapProjectParallaxImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少远景图片：${name}.png（当前地图已启用“在编辑器中显示”，请检查项目 img/parallaxes 目录）`,
    'en-US': `Missing parallax image: ${name}.png (this map has "Show in editor" enabled; check the project img/parallaxes directory)`,
  });
}

export function mapInvalidSourceTilesetId(assetId: unknown, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `无效的源图块集 id（${assetId}）`,
    'en-US': `Invalid source tileset id (${assetId})`,
  });
}

export function mapSourceTilesetMissing(
  assetId: unknown,
  sourceTilesetId: number,
  sourceProject: string,
  language?: ProductLanguage | null,
): string {
  const missingSource = sourceProject || pickByLocale(resolveLanguage(language), {
    'zh-CN': '未记录 sourceProject',
    'en-US': 'sourceProject not recorded',
  });
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `找不到来源图块集（${assetId}，源 tilesetId=${sourceTilesetId}）。请确认样例工程可访问：${missingSource}`,
    'en-US': `Source tileset not found (${assetId}, source tilesetId=${sourceTilesetId}). Confirm the sample project is accessible: ${missingSource}`,
  });
}

export function mapCriticalTilesetImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 tileset 图片: ${name}.png（A1-A4 槽位必需，请检查 RPG-Agent-MV/data/assets 本地资产库）`,
    'en-US': `Missing tileset image: ${name}.png (required for A1-A4 slots; check the RPG-Agent-MV/data/assets local asset library)`,
  });
}

export function mapOptionalTilesetImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 tileset 图片: ${name}.png（请检查 RPG-Agent-MV/data/assets 本地资产库）`,
    'en-US': `Missing tileset image: ${name}.png (check the RPG-Agent-MV/data/assets local asset library)`,
  });
}

export function mapParallaxImageMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少远景图片: ${name}.png（请检查 RPG-Agent-MV/data/assets 本地资产库）`,
    'en-US': `Missing parallax image: ${name}.png (check the RPG-Agent-MV/data/assets local asset library)`,
  });
}

export function mapNotFound(mapId: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `未找到地图：${mapId}`,
    'en-US': `Map not found: ${mapId}`,
  });
}

export function mapInfoNotFound(mapId: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `未找到 MapInfo：${mapId}`,
    'en-US': `MapInfo not found: ${mapId}`,
  });
}

export function mapHasChildMaps(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '无法删除仍包含子地图的地图。',
    'en-US': 'Cannot delete a map that still has child maps.',
  });
}

export function mapNoAvailableId(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '没有可用的地图 ID。',
    'en-US': 'No available Map ID.',
  });
}

export function mapUnsafeProjectPath(filePath: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不安全的项目路径：${filePath}`,
    'en-US': `Unsafe project path: ${filePath}`,
  });
}

export function mapLibraryFileNotFound(assetId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `未找到库内地图文件：${assetId}`,
    'en-US': `Library map file not found for ${assetId}`,
  });
}
