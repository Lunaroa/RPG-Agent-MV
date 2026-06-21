import type { ProductLanguage } from '@contract/types';
import { pickByLocale } from '../i18n/messages.ts';

interface ConsoleAssetsLocaleText {
  svActorPreviewLabels: readonly string[];
  characterDirectionLabels: readonly string[];
  importedMapIdSuffix: (id: unknown) => string;
}

export const CONSOLE_ASSETS_TEXT_BY_LOCALE = {
  'zh-CN': {
    svActorPreviewLabels: ['待机', '咏唱', '防御', '受击', '突进', '胜利'],
    characterDirectionLabels: ['下', '左', '右', '上'],
    importedMapIdSuffix: (id: unknown) => `，新 ID：${id}`,
  },
  'en-US': {
    svActorPreviewLabels: ['Idle', 'Chant', 'Guard', 'Damage', 'Thrust', 'Victory'],
    characterDirectionLabels: ['Down', 'Left', 'Right', 'Up'],
    importedMapIdSuffix: (id: unknown) => `. New ID: ${id}`,
  },
} as const satisfies Record<ProductLanguage, ConsoleAssetsLocaleText>;

export function consoleAssetsText(language: ProductLanguage): ConsoleAssetsLocaleText {
  return pickByLocale<ConsoleAssetsLocaleText>(language, CONSOLE_ASSETS_TEXT_BY_LOCALE);
}

type AssetImportIssueMatch = RegExpMatchArray;

interface AssetImportIssuePattern {
  id: string;
  match: (issue: string) => AssetImportIssueMatch | null;
  render: Record<ProductLanguage, (match: AssetImportIssueMatch, source: string) => string>;
}

const sourceIssue = {
  'zh-CN': (_match: AssetImportIssueMatch, source: string) => source,
  'en-US': (_match: AssetImportIssueMatch, source: string) => source,
} satisfies Record<ProductLanguage, (match: AssetImportIssueMatch, source: string) => string>;

const ASSET_DEPENDENCY_LABELS_BY_LOCALE = {
  'zh-CN': {
    技能类型: '技能类型',
    武器类型: '武器类型',
    元素: '元素',
    动画: '动画',
    状态: '状态',
    公共事件: '公共事件',
  },
  'en-US': {
    技能类型: 'skill type',
    武器类型: 'weapon type',
    元素: 'element',
    动画: 'animation',
    状态: 'state',
    公共事件: 'common event',
  },
} as const satisfies Record<ProductLanguage, Record<string, string>>;

const literalRegex = (pattern: RegExp): ((issue: string) => AssetImportIssueMatch | null) => (
  (issue) => pattern.test(issue) ? [issue] as unknown as RegExpMatchArray : null
);

const ASSET_IMPORT_ISSUE_RULES: readonly AssetImportIssuePattern[] = [
  {
    id: 'missing-resource',
    match: (issue) => issue.match(/^缺少资源[:：](.+)$/),
    render: {
      ...sourceIssue,
      'en-US': (match) => `Missing resource: ${match[1].trim()}`,
    },
  },
  {
    id: 'missing-skills-json',
    match: literalRegex(/缺少 Skills\.json/i),
    render: {
      ...sourceIssue,
      'en-US': () => 'Project is missing Skills.json',
    },
  },
  {
    id: 'missing-plugins-js',
    match: literalRegex(/缺少插件配置 plugins\.js/i),
    render: {
      ...sourceIssue,
      'en-US': () => 'Project is missing plugin configuration plugins.js',
    },
  },
  {
    id: 'missing-plugin',
    match: (issue) => issue.match(/^缺少插件[:：](.+)$/),
    render: {
      ...sourceIssue,
      'en-US': (match) => `Required plugin is missing: ${match[1].trim()}`,
    },
  },
  {
    id: 'unreadable-data',
    match: (issue) => issue.match(/^无法读取(.+)数据$/),
    render: {
      ...sourceIssue,
      'en-US': (match) => `Could not read ${assetDependencyLabel(match[1], 'en-US')} data`,
    },
  },
  {
    id: 'incompatible-dependency',
    match: (issue) => issue.match(/^(.+)不兼容[:：]需要 #(\d+)「(.+)」$/),
    render: {
      ...sourceIssue,
      'en-US': (match) => `Incompatible ${assetDependencyLabel(match[1], 'en-US')}: requires #${match[2]} "${match[3]}"`,
    },
  },
  {
    id: 'missing-file',
    match: (issue) => issue.match(/^缺少 (.+)$/),
    render: {
      ...sourceIssue,
      'en-US': (match) => `Missing ${match[1].trim()}`,
    },
  },
];

export function importedMapIdSuffix(id: unknown, language: ProductLanguage): string {
  return consoleAssetsText(language).importedMapIdSuffix(id);
}

export function translateAssetImportIssue(issue: string, language: ProductLanguage): string {
  for (const pattern of ASSET_IMPORT_ISSUE_RULES) {
    const match = pattern.match(issue);
    if (match) return pickByLocale(language, pattern.render)(match, issue);
  }
  return issue;
}

function assetDependencyLabel(label: string, language: ProductLanguage): string {
  return pickByLocale<Record<string, string>>(language, ASSET_DEPENDENCY_LABELS_BY_LOCALE)[label.trim()] || label.trim();
}
