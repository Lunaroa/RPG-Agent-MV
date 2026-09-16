import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_END_SEARCH = 65_535 + 22;

interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localOffset: number;
  directory: boolean;
}

export function extractZipArchive(archive: string, destination: string): string[] {
  const file = fs.openSync(archive, 'r');
  try {
    const stat = fs.fstatSync(file);
    const tailLength = Math.min(stat.size, MAX_END_SEARCH);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(file, tail, 0, tailLength, stat.size - tailLength);
    const endOffset = findEndRecord(tail);
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('ZIP64 toolchain archives are not supported.');
    }
    if (centralOffset + centralSize > stat.size) throw new Error('ZIP central directory is outside the archive.');
    const central = Buffer.alloc(centralSize);
    fs.readSync(file, central, 0, centralSize, centralOffset);
    const entries = parseCentralDirectory(central, entryCount);
    const root = path.resolve(destination);
    fs.mkdirSync(root, { recursive: true });
    const extracted: string[] = [];
    for (const entry of entries) {
      const target = safeArchivePath(root, entry.name);
      if (entry.directory) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      const header = Buffer.alloc(30);
      fs.readSync(file, header, 0, header.byteLength, entry.localOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`ZIP local header is invalid: ${entry.name}.`);
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const dataOffset = entry.localOffset + header.byteLength + nameLength + extraLength;
      if (dataOffset + entry.compressedBytes > stat.size) throw new Error(`ZIP entry is truncated: ${entry.name}.`);
      const compressed = Buffer.alloc(entry.compressedBytes);
      fs.readSync(file, compressed, 0, compressed.byteLength, dataOffset);
      const content = entry.method === 0
        ? compressed
        : entry.method === 8
          ? zlib.inflateRawSync(compressed)
          : (() => { throw new Error(`ZIP compression method ${entry.method} is unsupported: ${entry.name}.`); })();
      if (content.byteLength !== entry.uncompressedBytes || crc32(content) !== entry.crc32) {
        throw new Error(`ZIP entry failed size or CRC verification: ${entry.name}.`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: 'wx' });
      extracted.push(entry.name);
    }
    return extracted;
  } finally {
    fs.closeSync(file);
  }
}

function findEndRecord(tail: Buffer): number {
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === END_SIGNATURE) {
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === tail.byteLength) return offset;
    }
  }
  throw new Error('ZIP end-of-central-directory record was not found.');
}

function parseCentralDirectory(content: Buffer, expectedCount: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  while (offset < content.byteLength) {
    if (offset + 46 > content.byteLength || content.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory is malformed.');
    }
    const flags = content.readUInt16LE(offset + 8);
    if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported.');
    const method = content.readUInt16LE(offset + 10);
    const checksum = content.readUInt32LE(offset + 16);
    const compressedBytes = content.readUInt32LE(offset + 20);
    const uncompressedBytes = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const localOffset = content.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > content.byteLength) throw new Error('ZIP central directory entry is truncated.');
    const name = content.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (!name || names.has(name)) throw new Error(`ZIP archive contains an empty or duplicate path: ${name}.`);
    names.add(name);
    entries.push({
      name,
      method,
      crc32: checksum,
      compressedBytes,
      uncompressedBytes,
      localOffset,
      directory: name.endsWith('/'),
    });
    offset = end;
  }
  if (entries.length !== expectedCount) throw new Error('ZIP entry count does not match its central directory.');
  return entries;
}

function safeArchivePath(root: string, name: string): string {
  if (path.posix.isAbsolute(name) || path.win32.isAbsolute(name)
    || name.split('/').some((part, index, parts) => (!part && index !== parts.length - 1) || part === '.' || part === '..')) {
    throw new Error(`ZIP archive contains an unsafe path: ${name}.`);
  }
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!normalized) throw new Error('ZIP archive contains an empty path.');
  const target = path.resolve(root, ...normalized.split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`ZIP archive contains an unsafe path: ${name}.`);
  }
  return target;
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
