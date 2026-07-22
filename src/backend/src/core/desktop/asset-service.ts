import fs from 'node:fs';
import path from 'node:path';

import { findMapLibraryScreenshot } from './library-service.ts';
import { isMapOverviewChunkLevel, resolveMapOverviewChunkFile } from './map-overview-service.ts';
import { getProjectFileForRead, isInside } from './staging-service.ts';
import { chatImageExtension, isChatImageMime } from '../../../../contract/chat-image-attachments.ts';

export function projectAssetUrl(project: string, relativePath: string): string {
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  const relative = normalizeRelativePath(relativePath);
  return `rmmv-asset://project/${token}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function librarySourceAssetUrl(sourceSlug: string, relativePath: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sourceSlug)) throw new Error('Invalid library asset source.');
  const relative = normalizeRelativePath(relativePath);
  return `rmmv-asset://library/source/${encodeURIComponent(sourceSlug)}/${relative.split('/').map(encodeURIComponent).join('/')}`;
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
    const projectsRoot = path.join(path.resolve(workflowRoot), 'projects');
    if (!isInside(projectsRoot, project) && !isRegisteredProject(workflowRoot, project)) {
      throw new Error('Project asset is outside the workspace projects directory and not in the project registry.');
    }
    const relative = normalizeRelativePath(parts.map(decodeURIComponent).join('/'));
    const filePath = getProjectFileForRead(workflowRoot, project, relative);
    const stagingRoot = path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging');
    if (!filePath || (!isInside(project, filePath) && !isInside(stagingRoot, filePath))) throw new Error('Project asset path is outside allowed roots.');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) throw new Error('Project asset not found.');
    return filePath;
  }
  if (url.hostname === 'overview') {
    const parts = url.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent);
    if (parts.length !== 6) throw new Error('Invalid map overview chunk URL.');
    const [token, rawMapId, version, rawChunkX, rawChunkY, levelFile] = parts;
    const levelRaw = Number(levelFile.replace(/\.png$/i, ''));
    if (
      !token
      || !/^\d+$/.test(rawMapId)
      || !/^[a-f0-9]{20}$/.test(version)
      || !/^\d+$/.test(rawChunkX)
      || !/^\d+$/.test(rawChunkY)
      || !isMapOverviewChunkLevel(levelRaw)
      || `${levelRaw}.png` !== levelFile
      || parts.some((part) => part.includes('..'))
    ) {
      throw new Error('Invalid map overview chunk URL.');
    }
    const project = path.resolve(Buffer.from(token, 'base64url').toString('utf8'));
    const projectsRoot = path.join(path.resolve(workflowRoot), 'projects');
    if (!isInside(projectsRoot, project) && !isRegisteredProject(workflowRoot, project)) {
      throw new Error('Map overview project is outside the workspace and not registered.');
    }
    return resolveMapOverviewChunkFile(
      workflowRoot,
      project,
      Number(rawMapId),
      version,
      Number(rawChunkX),
      Number(rawChunkY),
      levelRaw,
    );
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
