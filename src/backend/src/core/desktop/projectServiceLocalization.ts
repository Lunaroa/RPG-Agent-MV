import { pickByLocale, type ProductLanguage } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function projectRemoveTargetRequired(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '请选择要清除的项目',
    'en-US': 'Select a project to remove',
  });
}

export function projectWorkspaceRemoveForbidden(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '这个项目来自 projects/ 目录，不能从项目列表清除。请移出 projects/ 目录后刷新。',
    'en-US':
      'This project comes from the projects/ directory and cannot be removed from the project list. Move it out of projects/ and refresh.',
  });
}

export function projectDefaultVersionCommitMessage(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '保存当前版本',
    'en-US': 'Save current version',
  });
}

export function projectVersionReadyNoChanges(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已准备好版本管理，当前没有新的改动需要保存',
    'en-US': 'Version control is ready; there are no new changes to save',
  });
}

export function projectVersionNoChanges(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '当前没有新的改动需要保存',
    'en-US': 'There are no new changes to save',
  });
}

export function projectVersionSavedCurrent(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已保存当前版本',
    'en-US': 'Current version saved',
  });
}

export function projectVersionSaved(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '已保存',
    'en-US': 'Saved',
  });
}

export function projectVersionNotInitialized(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '版本管理尚未初始化，请先启用版本管理',
    'en-US': 'Version control is not initialized. Enable version control first.',
  });
}

export function projectVersionInvalidChars(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '版本说明包含无效字符',
    'en-US': 'Version message contains invalid characters',
  });
}

export function projectVersionEmpty(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '版本说明不能为空',
    'en-US': 'Version message cannot be empty',
  });
}

export function projectGitMissing(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '缺少 Git 依赖：未找到 git 命令。请先安装 Git 后重试。',
    'en-US': 'Git is required but the git command was not found. Install Git and try again.',
  });
}

export function projectCheckGitDependency(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': '检测 Git 依赖',
    'en-US': 'Checking Git dependency',
  });
}

export function projectNotRegistered(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `项目不在注册列表中，无法清除：${path}`,
    'en-US': `Project is not in the registered list and cannot be removed: ${path}`,
  });
}

export function projectNotRunnable(path: string, detail: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不是可用的 RPG Maker MV/MZ 项目：${path}。${detail}`,
    'en-US': `Not a usable RPG Maker MV/MZ project: ${path}. ${detail}`,
  });
}

export function projectNotEditable(path: string, missing: string[], language?: ProductLanguage | null): string {
  const joined = pickByLocale(resolveLanguage(language), {
    'zh-CN': missing.join('，'),
    'en-US': missing.join(', '),
  });
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `不是可编辑的 RPG Maker MV/MZ 项目：${path}。缺少：${joined}`,
    'en-US': `Not an editable RPG Maker MV/MZ project: ${path}. Missing: ${joined}`,
  });
}

export function projectDataDirMissing(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少数据目录：${path}`,
    'en-US': `Missing data directory: ${path}`,
  });
}

export function projectSystemJsonMissing(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 System.json：${path}`,
    'en-US': `Missing System.json: ${path}`,
  });
}

export function projectMapInfosMissing(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `缺少 MapInfos.json：${path}`,
    'en-US': `Missing MapInfos.json: ${path}`,
  });
}

export function projectSystemNotObject(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `System.json 不是对象：${path}`,
    'en-US': `System.json is not an object: ${path}`,
  });
}

export function projectSystemMissingArrays(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `System.json 缺少 switches / variables 数组：${path}`,
    'en-US': `System.json is missing switches / variables arrays: ${path}`,
  });
}

export function projectMapInfosNotArray(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `MapInfos.json 不是数组：${path}`,
    'en-US': `MapInfos.json is not an array: ${path}`,
  });
}

export function projectMapInfosEmpty(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `MapInfos.json 没有任何地图条目：${path}`,
    'en-US': `MapInfos.json has no map entries: ${path}`,
  });
}

export function projectInvalidMapId(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `MapInfos.json 包含无效地图 ID：${path}`,
    'en-US': `MapInfos.json contains an invalid map ID: ${path}`,
  });
}

export function projectMissingMapFile(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `MapInfos.json 引用了不存在的地图文件：${path}`,
    'en-US': `MapInfos.json references a map file that does not exist: ${path}`,
  });
}

export function projectJsonParseFailed(path: string, detail: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `JSON 解析失败：${path}：${detail}`,
    'en-US': `JSON parse failed: ${path}: ${detail}`,
  });
}

export function projectGitRootMismatch(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `Git 仓库根目录不是当前项目：${path}`,
    'en-US': `Git repository root does not match the current project: ${path}`,
  });
}

export function projectVersionMessageTooLong(max: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `版本说明不能超过 ${max} 字`,
    'en-US': `Version message cannot exceed ${max} characters`,
  });
}

export function projectDirectoryMissing(path: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `项目目录不存在：${path}`,
    'en-US': `Project directory does not exist: ${path}`,
  });
}

export function projectGitTimeout(label: string, seconds: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `${label} 超时：Git 在 ${seconds} 秒内没有响应，版本管理未启用。`,
    'en-US': `${label} timed out: Git did not respond within ${seconds} seconds; version control was not enabled.`,
  });
}

export function projectGitFailed(output: string, fallback: string, language?: ProductLanguage | null): string {
  const detail = output || fallback;
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': output ? `Git 执行失败：${output}` : `Git 执行失败：${fallback}`,
    'en-US': `Git command failed: ${detail}`,
  });
}
