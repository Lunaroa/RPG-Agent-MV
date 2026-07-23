import type {
  PluginHeaderMetadata,
  PluginHelpSection,
} from '../../../../contract/types.ts';

const EMPTY_METADATA = {
  target: [],
  plugindesc: '',
  help: '',
  helpSections: [],
  author: '',
  url: '',
  base: [],
  orderAfter: [],
} satisfies Omit<PluginHeaderMetadata, 'displayPath' | 'urlHref'>;

export interface DefaultPluginHeaderBlock {
  body: string;
  bodyOffset: number;
}

interface PluginHeaderBlock extends DefaultPluginHeaderBlock {
  language: string;
}

export function pluginDisplayPath(relativePath: string, pluginName = ''): string {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^www\//i, '');
  if (normalized) return normalized;
  const name = String(pluginName || '').replace(/\\/g, '/').replace(/\.js$/i, '');
  return name ? `js/plugins/${name}.js` : 'js/plugins';
}

export function parseDefaultPluginHeaderMetadata(
  raw: string,
  relativePath = '',
  pluginName = '',
): PluginHeaderMetadata {
  const displayPath = pluginDisplayPath(relativePath, pluginName);
  const helpSections = parsePluginHelpSections(raw);
  const block = extractDefaultHeader(raw);
  if (!block) return { ...EMPTY_METADATA, helpSections, displayPath };

  const lines = headerLines(block.body);
  const values = new Map<string, string[]>();

  for (const line of lines) {
    const match = line.trim().match(/^@([A-Za-z][A-Za-z0-9_-]*)\b\s*(.*)$/);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const value = match[2].trim();
    const current = values.get(tag) || [];
    current.push(value);
    values.set(tag, current);
  }

  const url = first(values, 'url');
  const urlHref = safeHttpUrl(url);
  const metadata: PluginHeaderMetadata = {
    target: splitValues(values.get('target')).map((value) => value.toUpperCase()),
    plugindesc: first(values, 'plugindesc'),
    help: parseHeaderHelp(block.body),
    helpSections,
    author: first(values, 'author'),
    url,
    base: splitValues(values.get('base')),
    orderAfter: splitValues(values.get('orderafter')),
    displayPath,
  };
  if (urlHref) metadata.urlHref = urlHref;
  return metadata;
}

function extractDefaultHeader(raw: string): DefaultPluginHeaderBlock | null {
  const block = extractPluginHeaderBlocks(raw).find((entry) => !entry.language);
  return block ? { body: block.body, bodyOffset: block.bodyOffset } : null;
}

export function extractDefaultPluginHeaderBlock(raw: string): DefaultPluginHeaderBlock | null {
  return extractDefaultHeader(raw);
}

export function extractDefaultPluginHeaderBody(raw: string): string | null {
  return extractDefaultHeader(raw)?.body ?? null;
}

export function parsePluginHelpSections(raw: string): PluginHelpSection[] {
  const sections: PluginHelpSection[] = [];
  const seen = new Set<string>();
  for (const block of extractPluginHeaderBlocks(raw)) {
    const key = block.language.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({
      language: block.language,
      content: parseHeaderHelp(block.body),
    });
  }
  const defaultIndex = sections.findIndex((section) => !section.language);
  if (defaultIndex > 0) {
    sections.unshift(...sections.splice(defaultIndex, 1));
  }
  return sections;
}

function extractPluginHeaderBlocks(raw: string): PluginHeaderBlock[] {
  const blocks: PluginHeaderBlock[] = [];
  for (const match of String(raw || '').matchAll(/\/\*:([^\r\n]*)\r?\n([\s\S]*?)\*\//g)) {
    const language = match[1].trim();
    if (language && !/^[A-Za-z0-9_-]+$/.test(language)) continue;
    const body = match[2] || '';
    blocks.push({
      language,
      body,
      bodyOffset: (match.index || 0) + match[0].length - body.length - 2,
    });
  }
  return blocks;
}

function parseHeaderHelp(body: string): string {
  const lines = headerLines(body);
  const helpIndex = lines.findIndex((line) => /^@help\b/i.test(line.trim()));
  if (helpIndex < 0) return '';
  const nextTagOffset = lines
    .slice(helpIndex + 1)
    .findIndex((line) => /^@[A-Za-z][A-Za-z0-9_-]*\b/.test(line.trim()));
  const end = nextTagOffset < 0 ? lines.length : helpIndex + 1 + nextTagOffset;
  return trimBlankLines(lines.slice(helpIndex + 1, end)).join('\n');
}

function headerLines(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, '').replace(/\s+$/, ''));
}

function first(values: Map<string, string[]>, tag: string): string {
  return values.get(tag)?.find((value) => value.length > 0) || '';
}

function splitValues(entries: string[] | undefined): string[] {
  if (!entries) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const value of entry.split(/[\s,]+/).map((item) => stripQuotes(item.trim())).filter(Boolean)) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function safeHttpUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
