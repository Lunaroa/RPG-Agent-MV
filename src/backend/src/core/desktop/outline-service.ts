import path from 'node:path';

import type { StoryOutline } from '../../../../contract/types.ts';
import { StoryOutlineDao } from '../db/dao/story-outline-dao.ts';
import { toolLogger } from '../file-log.ts';
import { outlineBodyAliasRead, outlineInputNotObject } from './outlineServiceLocalization.ts';

const log = toolLogger('outline-service');

/**
 * Creative outline service. The outline is editable Markdown that captures
 * intent for humans and agents; it does not drive production state.
 */

export function getStoryOutline(_workflowRoot: string, project: string): StoryOutline | null {
  const projectId = projectName(project);
  const row = StoryOutlineDao.get(projectId);
  if (!row) return null;
  return normalizeOutline(projectId, row.outline);
}

export function upsertStoryOutline(
  _workflowRoot: string,
  project: string,
  payload: Record<string, unknown>,
): StoryOutline {
  const projectId = projectName(project);
  const normalized = normalizeOutline(projectId, payload);
  const row = StoryOutlineDao.upsert(projectId, normalized as unknown as Record<string, unknown>);
  return normalizeOutline(projectId, row.outline);
}

export function formatStoryOutlineSummary(project: string, outline: StoryOutline | null): string {
  const projectLabel = path.basename(path.resolve(project));
  if (!outline) return `No creative story outline for ${projectLabel}.`;
  const body = outline.body.trim();
  const lines = [
    `Creative story outline: ${outline.projectId} (updated ${outline.updatedAt})`,
    outline.title ? `Title: ${outline.title}` : '',
    `Body: ${countLines(body)} line(s), ${body.length} character(s)`,
  ].filter(Boolean);

  if (body) {
    lines.push('Preview:');
    lines.push(previewMarkdown(body));
  }
  return lines.join('\n');
}

function normalizeOutline(projectId: string, input: Record<string, unknown>): StoryOutline {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!input || typeof input !== 'object') {
    log.warn(outlineInputNotObject(typeof input));
  }
  const bodySource = raw.body !== undefined ? 'body' : raw.markdown !== undefined ? 'markdown' : raw.content !== undefined ? 'content' : null;
  if (bodySource && bodySource !== 'body') {
    log.warn(outlineBodyAliasRead(bodySource));
  }
  const body = String(raw.body ?? raw.markdown ?? raw.content ?? '');
  const title = optionalString(raw.title) || extractMarkdownTitle(body) || undefined;
  return {
    projectId,
    title,
    body,
    updatedAt: optionalString(raw.updatedAt) || new Date().toISOString(),
    updatedBy: optionalString(raw.updatedBy) || undefined,
  };
}

function extractMarkdownTitle(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const matched = /^#\s+(.+?)\s*$/.exec(line);
    if (matched) return matched[1].trim();
  }
  return '';
}

function previewMarkdown(markdown: string): string {
  const maxChars = 1200;
  const text = markdown.length > maxChars ? `${markdown.slice(0, maxChars).trimEnd()}\n...` : markdown;
  return text;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function projectName(project: string): string {
  return path.basename(path.resolve(project));
}

function optionalString(value: unknown): string {
  return String(value ?? '').trim();
}
