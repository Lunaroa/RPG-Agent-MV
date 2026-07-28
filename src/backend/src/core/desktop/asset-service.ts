import fs from 'node:fs';
import path from 'node:path';

import { chatImageExtension, isChatImageMime } from '../../../../contract/chat-image-attachments.ts';
import { assertProjectAssetThumbnailSizeBucket } from '../../../../contract/project-asset-thumbnails.ts';
import { findMapLibraryScreenshot } from './library-service.ts';
import { getProjectFileForRead, isInside } from './staging-service.ts';

export function projectAssetUrl(project: string, relativePath: string): string {
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  const relative = normalizeRelativePath(relativePath);
  return `rmmv-asset://project/${token}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function projectAssetThumbnailUrl(
  project: string,
  relativePath: string,
  sizeBucket: number,
): string {
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  const relative = normalizeRelativePath(relativePath);
  return `rmmv-asset://project-thumbnail/${token}/${sizeBucket}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Effect (.efkefc) representative-frame thumbnail URL. The effect name carries no
 * extension; the `.efkefc` file is implied and resolved on the main process.
 */
export function projectEffectThumbnailUrl(
  project: string,
  effectName: string,
  sizeBucket: number,
): string {
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  const relative = normalizeEffectName(effectName);
  return `rmmv-asset://project-effect-thumbnail/${token}/${sizeBucket}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function librarySourceAssetUrl(sourceSlug: string, relativePath: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sourceSlug)) throw new Error('Invalid library asset source.');
  const relative = normalizeRelativePath(relativePath);
  return `rmmv-asset://library/source/${encodeURIComponent(sourceSlug)}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export interface ResolvedProjectThumbnailRequest {
  project: string;
  relativePath: string;
  sizeBucket: number;
  sourceFilePath: string;
}

export function resolveProjectThumbnailRequest(
  workflowRoot: string,
  requestUrl: string,
): ResolvedProjectThumbnailRequest {
  const url = new URL(requestUrl);
  if (url.protocol !== 'rmmv-asset:') throw new Error('Unsupported asset protocol.');
  if (url.hostname !== 'project-thumbnail') throw new Error('Invalid project thumbnail asset URL.');
  const [token, sizeBucketRaw, ...parts] = url.pathname.replace(/^\/+/, '').split('/');
  if (!token || !sizeBucketRaw || !parts.length) throw new Error('Invalid project thumbnail asset URL.');
  const sizeBucket = Number(sizeBucketRaw);
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  const project = path.resolve(Buffer.from(token, 'base64url').toString('utf8'));
  const relative = normalizeRelativePath(parts.map(decodeURIComponent).join('/'));
  const sourceFilePath = assertReadableProjectAsset(workflowRoot, project, relative);
  return { project, relativePath: relative, sizeBucket, sourceFilePath };
}

export interface ResolvedProjectEffectThumbnailRequest {
  project: string;
  effectName: string;
  relativePath: string;
  sizeBucket: number;
  sourceFilePath: string;
}

export function resolveProjectEffectThumbnailRequest(
  workflowRoot: string,
  requestUrl: string,
): ResolvedProjectEffectThumbnailRequest {
  const url = new URL(requestUrl);
  if (url.protocol !== 'rmmv-asset:') throw new Error('Unsupported asset protocol.');
  if (url.hostname !== 'project-effect-thumbnail') throw new Error('Invalid project effect thumbnail asset URL.');
  const [token, sizeBucketRaw, ...parts] = url.pathname.replace(/^\/+/, '').split('/');
  if (!token || !sizeBucketRaw || !parts.length) throw new Error('Invalid project effect thumbnail asset URL.');
  const sizeBucket = Number(sizeBucketRaw);
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  const project = path.resolve(Buffer.from(token, 'base64url').toString('utf8'));
  const effectName = normalizeEffectName(parts.map(decodeURIComponent).join('/'));
  const { relativePath, sourceFilePath } = resolveProjectEffectThumbnailSource(workflowRoot, project, effectName);
  return { project, effectName, relativePath, sizeBucket, sourceFilePath };
}

/**
 * Resolve the effective `.efkefc` for an effect name (staged drafts win) so the
 * generator and the protocol handler compute the same content-addressed cache path.
 */
export function resolveProjectEffectThumbnailSource(
  workflowRoot: string,
  project: string,
  effectName: string,
): { relativePath: string; sourceFilePath: string } {
  const normalized = normalizeEffectName(effectName);
  const relativePath = `effects/${normalized}.efkefc`;
  const sourceFilePath = assertReadableProjectAsset(workflowRoot, project, relativePath);
  return { relativePath, sourceFilePath };
}

export function resolveAssetRequest(workflowRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== 'rmmv-asset:') throw new Error('Unsupported asset protocol.');
  if (url.hostname === 'library') {
    const [kind, encodedIdentifier, ...parts] = url.pathname.replace(/^\/+/, '').split('/');
    if (kind === 'screenshot' && encodedIdentifier) {
      const filePath = findMapLibraryScreenshot(workflowRoot, decodeURIComponent(encodedIdentifier));
      if (!filePath) throw new Error('Library screenshot not found.');
      return filePath;
    }
    if (kind === 'source' && encodedIdentifier && parts.length) {
      const slug = decodeURIComponent(encodedIdentifier);
      if (!/^[A-Za-z0-9._-]+$/.test(slug)) throw new Error('Invalid library asset source.');
      const root = path.join(path.resolve(workflowRoot), 'data', 'assets', 'sources', slug);
      const relative = normalizeRelativePath(parts.map(decodeURIComponent).join('/'));
      const filePath = path.resolve(root, ...relative.split('/'));
      if (!isInside(root, filePath)) throw new Error('Library asset path is outside allowed root.');
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) throw new Error('Library asset not found.');
      return filePath;
    }
    throw new Error('Invalid library asset URL.');
  }
  if (url.hostname === 'project') {
    const [token, ...parts] = url.pathname.replace(/^\/+/, '').split('/');
    if (!token || !parts.length) throw new Error('Invalid project asset URL.');
    const project = path.resolve(Buffer.from(token, 'base64url').toString('utf8'));
    const relative = normalizeRelativePath(parts.map(decodeURIComponent).join('/'));
    return assertReadableProjectAsset(workflowRoot, project, relative);
  }
  if (url.hostname === 'session') {
    const [sessionId, attachmentId, ...extra] = url.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent);
    if (!sessionId || !attachmentId || extra.length || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Za-z0-9_-]+$/.test(attachmentId)) {
      throw new Error('Invalid session asset URL.');
    }
    const sessionRoot = path.join(path.resolve(workflowRoot), 'runtime', 'sessions', sessionId);
    const outDir = path.join(sessionRoot, 'agent-console');
    const metaPath = path.join(outDir, 'session-meta.json');
    if (!isInside(path.join(path.resolve(workflowRoot), 'runtime', 'sessions'), sessionRoot) || !fs.existsSync(metaPath)) {
      throw new Error('Session asset not found.');
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    if (String(meta.id || '') !== sessionId || !Array.isArray(meta.imageAttachments)) {
      throw new Error('Session asset is not registered.');
    }
    const attachment = meta.imageAttachments.find((item: unknown) => (
      item && typeof item === 'object' && String((item as Record<string, unknown>).id || '') === attachmentId
    )) as Record<string, unknown> | undefined;
    if (!attachment || !isChatImageMime(attachment.mime)) throw new Error('Session asset is not registered.');
    const attachmentsRoot = path.join(outDir, 'attachments');
    const filePath = path.join(attachmentsRoot, `${attachmentId}.${chatImageExtension(attachment.mime)}`);
    if (!isInside(attachmentsRoot, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('Session asset not found.');
    }
    return filePath;
  }
  throw new Error('Unknown asset namespace.');
}

function assertReadableProjectAsset(
  workflowRoot: string,
  project: string,
  relative: string,
): string {
  const projectsRoot = path.join(path.resolve(workflowRoot), 'projects');
  if (!isInside(projectsRoot, project) && !isRegisteredProject(workflowRoot, project)) {
    throw new Error('Project asset is outside the workspace projects directory and not in the project registry.');
  }
  const filePath = getProjectFileForRead(workflowRoot, project, relative);
  const stagingRoot = path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging');
  if (!filePath || (!isInside(project, filePath) && !isInside(stagingRoot, filePath))) {
    throw new Error('Project asset path is outside allowed roots.');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) throw new Error('Project asset not found.');
  return filePath;
}

function isRegisteredProject(workflowRoot: string, projectPath: string): boolean {
  const registryPath = path.join(path.resolve(workflowRoot), 'runtime', 'project-registry.json');
  if (!fs.existsSync(registryPath)) return false;
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) return false;
    const resolved = path.resolve(projectPath).toLowerCase();
    return data.projects.some((item: unknown) => {
      if (!item || typeof (item as Record<string, unknown>).path !== 'string') return false;
      return path.resolve((item as Record<string, unknown>).path as string).toLowerCase() === resolved;
    });
  } catch {
    return false;
  }
}

function normalizeRelativePath(value: string): string {
  const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error(`Unsafe asset path: ${value}`);
  return relative;
}

function normalizeEffectName(effectName: string): string {
  const withoutExtension = String(effectName || '').replace(/\.efkefc$/i, '');
  return normalizeRelativePath(withoutExtension);
}
