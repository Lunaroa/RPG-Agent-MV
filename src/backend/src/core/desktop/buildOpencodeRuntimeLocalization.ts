import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export function ripgrepDownloadFailed(url: string, status: number, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `下载 ripgrep 失败：${url} -> HTTP ${status}`,
    'en-US': `Failed to download ripgrep: ${url} -> HTTP ${status}`,
  });
}

export function ripgrepEmptyArchive(url: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `下载 ripgrep 得到空文件：${url}`,
    'en-US': `Downloaded ripgrep archive is empty: ${url}`,
  });
}

export function ripgrepExecutableMissing(extracted: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `ripgrep 压缩包未包含可执行文件：${extracted}`,
    'en-US': `Ripgrep archive did not contain an executable: ${extracted}`,
  });
}
