import fs from 'node:fs';
import path from 'node:path';

import type { GameBuildUploadConfig, GameReleasePublishRequest } from '../../../../contract/game-release.ts';

export async function uploadStaticRelease(
  publishRoot: string,
  relativeFiles: string[],
  indexRelativePath: string,
  config: GameBuildUploadConfig,
  credential: GameReleasePublishRequest['uploadCredential'],
): Promise<string[]> {
  if (!config.enabled) return [];
  const root = fs.realpathSync.native(path.resolve(publishRoot));
  const files = [...new Set(relativeFiles.map(normalizeRelative))].filter((file) => file !== indexRelativePath);
  files.push(normalizeRelative(indexRelativePath));
  const headers = authorizationHeaders(config, credential);
  const uploaded: string[] = [];
  const createdCollections = new Set<string>();
  for (const relativePath of files) {
    const source = resolveInside(root, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Publish file is missing: ${relativePath}.`);
    if (config.adapter === 'webdav') {
      await ensureWebDavCollections(config.baseUrl, path.posix.dirname(relativePath), headers, createdCollections);
    }
    const url = new URL(relativePath.split('/').map(encodeURIComponent).join('/'), ensureTrailingSlash(config.baseUrl));
    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': contentType(relativePath), 'Content-Length': String(fs.statSync(source).size) },
      body: fs.readFileSync(source),
    });
    if (!response.ok) throw new Error(`Upload failed for ${relativePath}: HTTP ${response.status}.`);
    uploaded.push(relativePath);
  }
  return uploaded;
}

function authorizationHeaders(
  config: GameBuildUploadConfig,
  credential: GameReleasePublishRequest['uploadCredential'],
): Record<string, string> {
  if (config.authorization === 'none') return {};
  if (config.authorization === 'basic') {
    if (!credential?.username || credential.password === undefined) {
      throw new Error('WebDAV/HTTP Basic upload requires a username and password for this run.');
    }
    return { Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}` };
  }
  if (!credential?.token) throw new Error('Bearer upload requires a token for this run.');
  return { Authorization: `Bearer ${credential.token}` };
}

async function ensureWebDavCollections(
  baseUrl: string,
  directory: string,
  headers: Record<string, string>,
  created: Set<string>,
): Promise<void> {
  if (!directory || directory === '.') return;
  let current = '';
  for (const segment of directory.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    if (created.has(current)) continue;
    const url = new URL(`${current.split('/').map(encodeURIComponent).join('/')}/`, ensureTrailingSlash(baseUrl));
    const response = await fetch(url, { method: 'MKCOL', headers });
    if (![201, 204, 301, 302, 405].includes(response.status)) {
      throw new Error(`WebDAV could not create ${current}: HTTP ${response.status}.`);
    }
    created.add(current);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeRelative(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe publish path: ${value}.`);
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const target = path.resolve(root, ...normalizeRelative(relativePath).split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe publish path: ${relativePath}.`);
  return target;
}

function contentType(relativePath: string): string {
  if (relativePath.endsWith('.json')) return 'application/json';
  if (relativePath.endsWith('.zip')) return 'application/zip';
  if (relativePath.endsWith('.apk')) return 'application/vnd.android.package-archive';
  return 'application/octet-stream';
}
