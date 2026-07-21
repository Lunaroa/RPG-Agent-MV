import path from 'node:path';
import fs from 'node:fs';

export function resolveDocumentationRoot(options: {
  packaged: boolean;
  appPath: string;
  installRoot: string;
}): string {
  return path.resolve(options.packaged ? path.join(options.appPath, 'docs') : path.join(options.installRoot, 'docs'));
}

export function resolveDocumentationPath(docsRootInput: string, relativeInput: string, extensions: readonly string[]): string {
  const docsRoot = path.resolve(docsRootInput);
  const relative = String(relativeInput || '').replaceAll('\\', '/');
  if (!relative || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\0')) {
    throw new Error('Documentation path must be relative.');
  }
  const normalized = path.posix.normalize(relative);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Documentation path leaves the documentation root.');
  const target = path.resolve(docsRoot, ...normalized.split('/'));
  const prefix = `${docsRoot}${path.sep}`;
  if (target !== docsRoot && !target.startsWith(prefix)) throw new Error('Documentation path leaves the documentation root.');
  if (!extensions.includes(path.extname(target).toLocaleLowerCase())) throw new Error('Documentation file type is not allowed.');
  const realRoot = fs.realpathSync.native(docsRoot);
  const realTarget = fs.realpathSync.native(target);
  const realPrefix = `${realRoot}${path.sep}`;
  if (realTarget !== realRoot && !realTarget.startsWith(realPrefix)) throw new Error('Documentation path leaves the documentation root.');
  return realTarget;
}
