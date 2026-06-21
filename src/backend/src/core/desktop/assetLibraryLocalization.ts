import type { AssetLibraryCategoryId } from '../../../../contract/types.ts';
import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function assetLibraryCategoryLabels(
  language?: ProductLanguage | null,
): Record<AssetLibraryCategoryId, string> {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': {
      maps: '地图',
      skills: '技能',
      tilesets: '图块',
      characters: '角色与脸图',
      images: '图片',
      audio: '音频',
      videos: '视频',
    },
    'en-US': {
      maps: 'Maps',
      skills: 'Skills',
      tilesets: 'Tilesets',
      characters: 'Characters & Faces',
      images: 'Images',
      audio: 'Audio',
      videos: 'Videos',
    },
  });
}

export function assetLibraryDependencyLabels(language?: ProductLanguage | null): {
  skillType: string;
  weaponType: string;
  animation: string;
  element: string;
  state: string;
  commonEvent: string;
} {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': {
      skillType: '技能类型',
      weaponType: '武器类型',
      animation: '动画',
      element: '元素',
      state: '状态',
      commonEvent: '公共事件',
    },
    'en-US': {
      skillType: 'Skill Type',
      weaponType: 'Weapon Type',
      animation: 'Animation',
      element: 'Element',
      state: 'State',
      commonEvent: 'Common Event',
    },
  });
}

export function assetLibraryEntryMissing(assetId: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `静态资产不存在：${assetId}`,
    'en-US': `Static asset does not exist: ${assetId}`,
  });
}

export function assetLibrarySourceFileMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态素材文件不存在',
    'en-US': 'Static asset file does not exist',
  });
}

export function assetLibraryImportValidationFailed(issues: string[], language?: ProductLanguage | null): string {
  const separator = pickByLocale(resolveLanguage(language), {
    'zh-CN': '；',
    'en-US': '; ',
  });
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `资产导入校验失败：${issues.join(separator)}`,
    'en-US': `Asset import validation failed: ${issues.join(separator)}`,
  });
}

export function assetLibraryTargetSkillsMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '目标项目缺少 Skills.json',
    'en-US': 'Target project is missing Skills.json',
  });
}

export function assetLibrarySkillIndexInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态技能库索引格式无效',
    'en-US': 'Static skill library index format is invalid',
  });
}

export function assetLibrarySkillEntryInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态技能库包含无效条目',
    'en-US': 'Static skill library contains invalid entries',
  });
}

export function assetLibraryIconSetDependencyMissing(name: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `静态技能「${name}」未声明图标集依赖`,
    'en-US': `Static skill "${name}" does not declare an icon set dependency`,
  });
}

export function assetLibraryDeclaredDependencyMissing(
  name: string,
  label: string,
  id: number,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `静态技能「${name}」未声明${label} #${id}`,
    'en-US': `Static skill "${name}" does not declare ${label} #${id}`,
  });
}

export function assetLibraryResourceMissing(resource: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少资源：${resource}`,
    'en-US': `Missing resource: ${resource}`,
  });
}

export function assetLibrarySkillsJsonMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少 Skills.json',
    'en-US': 'Missing Skills.json',
  });
}

export function assetLibraryDataUnreadable(label: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `无法读取${label}数据`,
    'en-US': `Unable to read ${label} data`,
  });
}

export function assetLibraryDependencyIncompatible(
  label: string,
  id: number,
  name: string,
  language?: ProductLanguage | null,
): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label}不兼容：需要 #${id}「${name}」`,
    'en-US': `${label} is incompatible: requires #${id} "${name}"`,
  });
}

export function assetLibraryPluginsJsMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少插件配置 plugins.js',
    'en-US': 'Missing plugin configuration plugins.js',
  });
}

export function assetLibraryPluginMissing(plugin: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少插件：${plugin}`,
    'en-US': `Missing plugin: ${plugin}`,
  });
}

export function assetLibraryFileMissing(fileName: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 ${fileName}`,
    'en-US': `Missing ${fileName}`,
  });
}

export function assetLibrarySourceInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态素材来源无效',
    'en-US': 'Invalid static asset source',
  });
}

export function assetLibraryPathOutOfBounds(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态素材路径越界',
    'en-US': 'Static asset path is out of bounds',
  });
}

export function assetLibraryPathInvalid(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '静态素材路径无效',
    'en-US': 'Invalid static asset path',
  });
}
