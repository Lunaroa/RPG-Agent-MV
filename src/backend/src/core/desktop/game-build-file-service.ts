import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import type { GameBuildFileManifestEntry, GameContentProcessingMode } from '../../../../contract/game-release.ts';

const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set(['.git', '.luna_rpg', 'node_modules']);

export interface DirectoryDigest {
  bytes: number;
  sha256: string;
  files: GameBuildFileManifestEntry[];
}

export function sanitizeArtifactSegment(value: string): string {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '');
  if (!normalized) return 'game';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized);
  return (reserved ? `_${normalized}` : normalized).slice(0, 120);
}

export function gameArtifactBaseName(
  gameName: string,
  version: string,
  platform: string,
  architecture: string,
): string {
  return [gameName, version, platform, architecture].map(sanitizeArtifactSegment).join('-');
}

export function createOutputStagingDirectory(outputDirectory: string): string {
  const root = path.resolve(outputDirectory);
  fs.mkdirSync(root, { recursive: true });
  assertDirectory(root, 'Build output directory');
  return fs.mkdtempSync(path.join(root, '.rpg-agent-build-'));
}

export function copyGameDirectory(source: string, target: string): void {
  const sourceRoot = fs.realpathSync.native(path.resolve(source));
  if (!fs.statSync(sourceRoot).isDirectory()) throw new Error(`Game source is not a directory: ${source}`);
  const targetRoot = path.resolve(target);
  const allowedNestedRoot = path.join(sourceRoot, '.luna_rpg');
  if (isInside(sourceRoot, targetRoot) && !isInside(allowedNestedRoot, targetRoot)) {
    throw new Error('The temporary build directory must not be inside the copied game source.');
  }
  copyDirectory(sourceRoot, targetRoot, '');
}

export function collectDirectoryDigest(
  root: string,
  processingForPath: (relativePath: string) => GameContentProcessingMode = () => 'none',
): DirectoryDigest {
  const files = listRegularFiles(root).map((file) => {
    const content = fs.readFileSync(file.absolutePath);
    return {
      path: file.relativePath,
      bytes: content.byteLength,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      processing: processingForPath(file.relativePath),
    } satisfies GameBuildFileManifestEntry;
  });
  const directoryHash = crypto.createHash('sha256');
  for (const file of files) {
    directoryHash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`, 'utf8');
  }
  return {
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: directoryHash.digest('hex'),
    files,
  };
}

export function sha256File(file: string): string {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Artifact is not a regular file: ${file}`);
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function writeZipArchive(sourceDirectory: string, outputFile: string, rootDirectoryName: string): void {
  const rootName = sanitizeArtifactSegment(rootDirectoryName);
  const files = listRegularFiles(sourceDirectory);
  if (files.length > ZIP_MAX_UINT16) throw new Error('ZIP output contains too many files for the supported ZIP32 format.');
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  const now = dosDateTime(new Date());

  for (const file of files) {
    const data = fs.readFileSync(file.absolutePath);
    if (data.byteLength > ZIP_MAX_UINT32) throw new Error(`ZIP file is larger than 4 GiB: ${file.relativePath}`);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const compressed = deflated.byteLength < data.byteLength ? deflated : data;
    const method = compressed === data ? 0 : 8;
    const name = Buffer.from(`${rootName}/${file.relativePath}`, 'utf8');
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.byteLength + name.byteLength + compressed.byteLength;
    if (localOffset > ZIP_MAX_UINT32) throw new Error('ZIP output is larger than 4 GiB; ZIP64 output is not enabled.');
  }

  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  if (centralSize > ZIP_MAX_UINT32 || localOffset + centralSize > ZIP_MAX_UINT32) {
    throw new Error('ZIP output is larger than 4 GiB; ZIP64 output is not enabled.');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  writeBufferAtomically(outputFile, Buffer.concat([...localParts, ...centralParts, end]));
}

export function publishStagedDirectory(
  stagedDirectory: string,
  desiredPath: string,
  conflict: 'overwrite' | 'new-directory' | 'cancel',
): string | null {
  const staged = fs.realpathSync.native(path.resolve(stagedDirectory));
  assertDirectory(staged, 'Staged build');
  let destination = path.resolve(desiredPath);
  if (fs.existsSync(destination)) {
    if (conflict === 'cancel') return null;
    if (conflict === 'new-directory') destination = availableSibling(destination);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) {
    fs.renameSync(staged, destination);
    return destination;
  }
  if (conflict !== 'overwrite') throw new Error('The build destination already exists.');
  const backup = `${destination}.previous-${crypto.randomUUID()}`;
  fs.renameSync(destination, backup);
  try {
    fs.renameSync(staged, destination);
    fs.rmSync(backup, { recursive: true, force: false });
    return destination;
  } catch (error) {
    if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
    throw error;
  }
}

export function writeJsonAtomically(file: string, value: unknown): void {
  writeBufferAtomically(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

export function assertOutputLocation(project: string, outputDirectory: string): void {
  const projectRoot = fs.realpathSync.native(path.resolve(project));
  const output = path.resolve(outputDirectory);
  if (!isInside(projectRoot, output)) return;
  const allowedRoot = path.join(projectRoot, '.luna_rpg');
  if (!isInside(allowedRoot, output) || output === allowedRoot) {
    throw new Error('Build output inside the game project is allowed only under .luna_rpg so it cannot be copied into future builds.');
  }
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyDirectory(sourceRoot: string, targetRoot: string, relativeDirectory: string): void {
  const source = relativeDirectory ? path.join(sourceRoot, ...relativeDirectory.split('/')) : sourceRoot;
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (shouldExclude(relativePath, entry.isDirectory())) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) throw new Error(`Game builds do not follow symbolic links: ${relativePath}`);
    if (entry.isDirectory()) {
      copyDirectory(sourceRoot, targetPath, relativePath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      fs.chmodSync(targetPath, stat.mode);
    } else {
      throw new Error(`Unsupported filesystem entry in game source: ${relativePath}`);
    }
  }
}

function shouldExclude(relativePath: string, directory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some((part) => DEFAULT_EXCLUDED_DIRECTORIES.has(part))) return true;
  if (directory && (normalized.toLowerCase() === 'save' || normalized.toLowerCase() === 'www/save')) return true;
  return false;
}

function listRegularFiles(root: string): Array<{ absolutePath: string; relativePath: string }> {
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  assertDirectory(resolvedRoot, 'Artifact directory');
  const result: Array<{ absolutePath: string; relativePath: string }> = [];
  walk(resolvedRoot, '');
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  function walk(directory: string, relativeDirectory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Artifact contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile()) result.push({ absolutePath, relativePath: relativePath.replace(/\\/g, '/') });
      else throw new Error(`Artifact contains an unsupported filesystem entry: ${relativePath}`);
    }
  }
}

function writeBufferAtomically(file: string, content: Buffer): void {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function availableSibling(desiredPath: string): string {
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${desiredPath}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find an available output directory name.');
}

function assertDirectory(directory: string, label: string): void {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
