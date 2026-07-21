import fs from 'node:fs';
import path from 'node:path';

export const MAP_PREVIEW_SCHEME = {
  scheme: 'rpg-agent-preview',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
} as const;

export function normalizeMapPreviewProtocolKey(value: string): string {
  const key = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(key)) throw new Error('Invalid map preview protocol key.');
  return key;
}

export function resolveConfinedMapPreviewResource(rootInput: string, relativeInput: string): string {
  const root = fs.realpathSync.native(path.resolve(rootInput));
  if (!relativeInput || relativeInput.includes('\0') || path.isAbsolute(relativeInput)) {
    throw new Error('Invalid map preview resource path.');
  }
  const target = path.resolve(root, ...relativeInput.replace(/\\/g, '/').split('/'));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Map preview resource escaped its isolated root.');
  if (!fs.existsSync(target)) return target;
  const realTarget = fs.realpathSync.native(target);
  const realRelative = path.relative(root, realTarget);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Map preview resource symlink escaped its isolated root.');
  }
  return realTarget;
}
