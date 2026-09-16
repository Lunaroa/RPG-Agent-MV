import fs from 'node:fs';

export const WINDOWS_REQUIRED_RUNTIME_FILES = [
  'Game.exe', 'nw.dll', 'nw_elf.dll', 'node.dll', 'icudtl.dat', 'resources.pak',
  'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'ffmpeg.dll',
  'nw_100_percent.pak', 'nw_200_percent.pak',
] as const;

const WINDOWS_PLATFORM_RUNTIME_FILES = new Set([
  ...WINDOWS_REQUIRED_RUNTIME_FILES.map((value) => value.toLowerCase()),
  'natives_blob.bin',
  'notification_helper.exe',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
]);

export function isWindowsPlatformRuntimePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (WINDOWS_PLATFORM_RUNTIME_FILES.has(normalized)) return true;
  return normalized.startsWith('locales/')
    || normalized.startsWith('swiftshader/')
    || normalized.startsWith('widevinecdm/')
    || normalized.startsWith('.rpg-agent/updater/');
}

export function inspectWindowsExecutableArchitecture(file: string): 'x86' | 'x64' | 'arm64' {
  const content = fs.readFileSync(file);
  if (content.byteLength < 64 || content.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`Windows runtime executable has an invalid DOS header: ${file}.`);
  }
  const peOffset = content.readUInt32LE(0x3c);
  if (peOffset > content.byteLength - 6 || content.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(`Windows runtime executable has an invalid PE header: ${file}.`);
  }
  const machine = content.readUInt16LE(peOffset + 4);
  if (machine === 0x014c) return 'x86';
  if (machine === 0x8664) return 'x64';
  if (machine === 0xaa64) return 'arm64';
  throw new Error(`Windows runtime executable uses an unsupported PE machine type 0x${machine.toString(16)}.`);
}
