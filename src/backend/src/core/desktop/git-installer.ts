import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

const GIT_RELEASE_API = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
const INSTALLER_ASSET_PATTERN = /Git-[\d.]+-64-bit\.exe$/;
const DOWNLOAD_TIMEOUT_MS = 120_000;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'luna-rpg-agent', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Git release lookup failed: HTTP ${response.status}`);
  return response.json();
}

export async function resolveGitInstallerAsset(): Promise<{ name: string; url: string }> {
  const release = await fetchJson(GIT_RELEASE_API) as { assets?: Array<{ name?: unknown; browser_download_url?: unknown }> };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((entry) =>
    typeof entry.name === 'string' && INSTALLER_ASSET_PATTERN.test(entry.name)
    && typeof entry.browser_download_url === 'string'
    && entry.browser_download_url.startsWith('https://'));
  if (!asset) throw new Error('The latest Git for Windows installer was not found.');
  return { name: asset.name as string, url: asset.browser_download_url as string };
}

export async function downloadGitInstaller(): Promise<{ path: string; name: string }> {
  const asset = await resolveGitInstallerAsset();
  const response = await fetch(asset.url, {
    headers: { 'User-Agent': 'luna-rpg-agent' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok || !response.body) throw new Error(`Git installer download failed: HTTP ${response.status}`);
  const target = path.join(os.tmpdir(), asset.name);
  const partial = `${target}.partial`;
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream),
    fs.createWriteStream(partial),
  );
  await fs.promises.rename(partial, target).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.promises.copyFile(partial, target);
    await fs.promises.rm(partial, { force: true });
  });
  return { path: target, name: asset.name };
}
