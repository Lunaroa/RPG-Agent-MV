import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function mapLibrarySelectionDownstreamNote(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN':
      '地图已由人在 agent console「地图制作」标签选定/导入。Agent 必须读取本文件的 source map、targetParent、importedMapId、role、humanGoal、candidates 和 requiredOutputs；不要重做视觉选图。',
    'en-US':
      'The map was selected or imported by a human on the Agent Console Maps tab. The agent must read this file\'s source map, targetParent, importedMapId, role, humanGoal, candidates, and requiredOutputs; do not redo visual map selection.',
  });
}

export function mapLibraryJsonMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '库内地图 JSON 文件缺失',
    'en-US': 'Map JSON file is missing from the library',
  });
}

export function mapLibrarySourceProjectMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '本地资产库中未找到该地图的源工程',
    'en-US': 'Source project for this map was not found in the local asset library',
  });
}

export function mapLibraryEntryUnreadable(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '无法读取库条目',
    'en-US': 'Unable to read library entry',
  });
}

export function mapVisualLibraryIndexNotFound(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '未找到地图视觉库 index.json',
    'en-US': 'Map visual library index.json not found',
  });
}

export function mapLibraryAssetNotFound(assetId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `未找到地图资产：${assetId}`,
    'en-US': `Map asset not found: ${assetId}`,
  });
}
