import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { transform } from 'esbuild';
import sharp from 'sharp';

import type {
  GameContentCategory,
  GameContentProcessingConfig,
  GameContentProcessingMode,
} from '../../../../contract/game-release.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { readGameEncryptionKey } from './game-encryption-key-service.ts';

interface RuntimeContentRecord {
  sourcePath: string;
  transformedPath: string;
  sourceUrl: string;
  transformedUrl: string;
  mode: 'obfuscate' | 'encrypt';
  mime: string;
}

export interface GameContentProcessingResult {
  processed: Record<string, GameContentProcessingMode>;
  records: RuntimeContentRecord[];
  encryptionKeySha256?: string;
}

export interface GameContentProcessingPreflight {
  blockers: string[];
  warnings: string[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.ogg', '.m4a', '.wav']);
const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4']);
const BOOTSTRAP_JAVASCRIPT = new Set([
  'js/plugins.js', 'js/main.js',
  'js/rpg_core.js', 'js/rpg_managers.js', 'js/rpg_objects.js', 'js/rpg_scenes.js', 'js/rpg_sprites.js', 'js/rpg_windows.js',
  'js/rmmz_core.js', 'js/rmmz_managers.js', 'js/rmmz_objects.js', 'js/rmmz_scenes.js', 'js/rmmz_sprites.js', 'js/rmmz_windows.js',
]);
const ENCRYPTED_MAGIC = Buffer.from('RPGAGENTENC1\n', 'ascii');
const OBFUSCATED_MAGIC = Buffer.from('RPGOBF1\n', 'ascii');

export function preflightContentProcessing(
  workflowRoot: string,
  project: string,
  config: GameContentProcessingConfig,
): GameContentProcessingPreflight {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const modes = Object.values(config).filter((value): value is GameContentProcessingMode => (
    value === 'compress' || value === 'obfuscate' || value === 'encrypt'
  ));
  if (!modes.length) return { blockers, warnings };
  if (config.encryptionKeyId) {
    try {
      readGameEncryptionKey(project, config.encryptionKeyId);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (config.audio === 'compress' || config.video === 'compress') {
    const ffmpeg = managedFfmpegPath(workflowRoot);
    if (!fs.existsSync(ffmpeg) || !fs.statSync(ffmpeg).isFile()) {
      blockers.push('Managed FFmpeg is required for audio or video compression and is not installed.');
    }
    if (config.audio === 'compress') {
      const unsupported = listFiles(resolveRmmvLayout(project).resourceRoot).filter((relativePath) => (
        contentCategory(relativePath) === 'audio' && path.posix.extname(relativePath.toLowerCase()) === '.wav'
      ));
      if (unsupported.length) {
        blockers.push(`WAV compression is not configured for this build pipeline: ${unsupported.slice(0, 5).join(', ')}.`);
      }
    }
  }
  if (Object.values(config).includes('encrypt')) {
    warnings.push('Encrypted builds keep a recoverable runtime key. This protects against casual inspection, not a determined reverse engineer.');
  }
  return { blockers, warnings };
}

export async function applyContentProcessing(
  workflowRoot: string,
  project: string,
  buildRoot: string,
  config: GameContentProcessingConfig,
  _engine: RpgMakerEngine,
): Promise<GameContentProcessingResult> {
  const preflight = preflightContentProcessing(workflowRoot, project, config);
  if (preflight.blockers.length) throw new Error(preflight.blockers.join('\n'));
  const keyRecord = config.encryptionKeyId ? readGameEncryptionKey(project, config.encryptionKeyId) : null;
  const processed: Record<string, GameContentProcessingMode> = {};
  const records: RuntimeContentRecord[] = [];
  const files = listFiles(buildRoot);

  for (const relativePath of files) {
    const category = contentCategory(relativePath);
    if (!category) continue;
    const mode = config[category];
    if (mode === 'none') continue;
    const absolutePath = resolveRelative(buildRoot, relativePath);
    if (mode === 'compress') {
      await compressFile(workflowRoot, absolutePath, relativePath, category);
      processed[relativePath] = 'compress';
      continue;
    }
    if (category === 'javascript' && mode === 'obfuscate') {
      await minifyJavascript(absolutePath, relativePath);
      processed[relativePath] = 'obfuscate';
      continue;
    }
    if (category === 'javascript' && isBootstrapJavascript(relativePath)) {
      continue;
    }
    const content = fs.readFileSync(absolutePath);
    const transformed = mode === 'encrypt'
      ? encryptContent(content, requireEncryptionKey(keyRecord?.key))
      : obfuscateContent(content);
    const transformedRelativePath = `${relativePath}.rpgagent`;
    const transformedAbsolutePath = resolveRelative(buildRoot, transformedRelativePath);
    fs.writeFileSync(transformedAbsolutePath, transformed);
    fs.rmSync(absolutePath);
    processed[transformedRelativePath] = mode;
    records.push({
      sourcePath: relativePath,
      transformedPath: transformedRelativePath,
      sourceUrl: runtimeUrl(relativePath),
      transformedUrl: runtimeUrl(transformedRelativePath),
      mode,
      mime: mimeForPath(relativePath),
    });
  }

  if (records.length) installRuntimeLoader(buildRoot, records, keyRecord?.key || null);
  return {
    processed,
    records,
    ...(keyRecord ? { encryptionKeySha256: keyRecord.summary.sha256 } : {}),
  };
}

export function contentCategory(relativePath: string): GameContentCategory | null {
  const normalized = stripWww(relativePath.toLowerCase());
  const extension = path.posix.extname(normalized);
  if (normalized.startsWith('data/ui-scenes/') || extension === '.mzui') return 'ui';
  if (normalized.startsWith('img/') && IMAGE_EXTENSIONS.has(extension)) return 'images';
  if (normalized.startsWith('audio/') && AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (normalized.startsWith('movies/') && VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (normalized.startsWith('data/') && extension === '.json') return 'data';
  if (normalized.startsWith('js/') && extension === '.js') return 'javascript';
  return null;
}

function stripWww(relativePath: string): string {
  return relativePath.startsWith('www/') ? relativePath.slice(4) : relativePath;
}

function runtimeUrl(relativePath: string): string {
  return stripWww(relativePath.replace(/\\/g, '/'));
}

function isBootstrapJavascript(relativePath: string): boolean {
  return BOOTSTRAP_JAVASCRIPT.has(stripWww(relativePath.replace(/\\/g, '/')))
    || relativePath.endsWith('/RPGAgentContentLoader.js');
}

async function compressFile(
  workflowRoot: string,
  absolutePath: string,
  relativePath: string,
  category: GameContentCategory,
): Promise<void> {
  if (category === 'images') {
    const extension = path.extname(absolutePath).toLowerCase();
    const pipeline = sharp(absolutePath, { failOn: 'error' });
    const output = extension === '.png'
      ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : extension === '.webp'
        ? await pipeline.webp({ quality: 82, effort: 6 }).toBuffer()
        : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (output.byteLength < fs.statSync(absolutePath).size) fs.writeFileSync(absolutePath, output);
    return;
  }
  if (category === 'audio' || category === 'video') {
    compressMedia(workflowRoot, absolutePath, relativePath, category);
    return;
  }
  if (category === 'javascript') {
    await minifyJavascript(absolutePath, relativePath);
    return;
  }
  const value = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  fs.writeFileSync(absolutePath, JSON.stringify(value), 'utf8');
}

async function minifyJavascript(absolutePath: string, relativePath: string): Promise<void> {
  const result = await transform(fs.readFileSync(absolutePath, 'utf8'), {
    loader: 'js',
    minify: true,
    target: 'es2015',
    legalComments: 'none',
    sourcefile: relativePath,
  });
  fs.writeFileSync(absolutePath, result.code, 'utf8');
}

function compressMedia(
  workflowRoot: string,
  absolutePath: string,
  relativePath: string,
  category: 'audio' | 'video',
): void {
  const ffmpeg = managedFfmpegPath(workflowRoot);
  const extension = path.extname(absolutePath).toLowerCase();
  const temporary = `${absolutePath}.${crypto.randomUUID()}${extension}`;
  const codec = category === 'audio'
    ? extension === '.ogg'
      ? ['-c:a', 'libvorbis', '-q:a', '5']
      : extension === '.m4a'
        ? ['-c:a', 'aac', '-b:a', '160k']
        : null
    : extension === '.webm'
      ? ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-c:a', 'libopus']
      : extension === '.mp4'
        ? ['-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
        : null;
  if (!codec) throw new Error(`Compression is not configured for this media format: ${relativePath}.`);
  try {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', absolutePath, ...codec, temporary], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0 || !fs.existsSync(temporary)) {
      throw new Error(`FFmpeg could not compress ${relativePath}: ${result.error?.message || lastLine(result.stderr) || `exit ${result.status}`}`);
    }
    if (fs.statSync(temporary).size < fs.statSync(absolutePath).size) replaceFile(absolutePath, temporary);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function replaceFile(target: string, replacement: string): void {
  const backup = `${target}.previous-${crypto.randomUUID()}`;
  fs.renameSync(target, backup);
  try {
    fs.renameSync(replacement, target);
    fs.rmSync(backup);
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

function encryptContent(content: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([ENCRYPTED_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function obfuscateContent(content: Buffer): Buffer {
  return Buffer.concat([OBFUSCATED_MAGIC, Buffer.from(content.toString('base64'), 'ascii')]);
}

function installRuntimeLoader(buildRoot: string, records: RuntimeContentRecord[], key: Buffer | null): void {
  const indexRelativePath = listFiles(buildRoot).find((relativePath) => runtimeUrl(relativePath) === 'index.html');
  if (!indexRelativePath) throw new Error('Content processing requires the game index.html entry file.');
  const indexFile = resolveRelative(buildRoot, indexRelativePath);
  const prefix = indexRelativePath.startsWith('www/') ? 'www/' : '';
  const loaderRelativePath = `${prefix}js/RPGAgentContentLoader.js`;
  const loaderFile = resolveRelative(buildRoot, loaderRelativePath);
  fs.mkdirSync(path.dirname(loaderFile), { recursive: true });
  fs.writeFileSync(loaderFile, renderRuntimeLoader(records, key), 'utf8');
  const source = fs.readFileSync(indexFile, 'utf8');
  if (source.includes('RPGAgentContentLoader.js')) throw new Error('The build copy already contains a content loader reference.');
  const loaderTag = '<script src="js/RPGAgentContentLoader.js"></script>\n';
  const pluginScript = /<script\b[^>]*\bsrc=["']js\/plugins\.js["'][^>]*><\/script>/i;
  const mainScript = /<script\b[^>]*\bsrc=["']js\/main\.js["'][^>]*><\/script>/i;
  if (pluginScript.test(source)) fs.writeFileSync(indexFile, source.replace(pluginScript, `${loaderTag}$&`), 'utf8');
  else if (mainScript.test(source)) fs.writeFileSync(indexFile, source.replace(mainScript, `${loaderTag}$&`), 'utf8');
  else throw new Error('The game index does not contain a supported plugins.js or main.js script entry.');
}

function renderRuntimeLoader(records: RuntimeContentRecord[], key: Buffer | null): string {
  const manifest = JSON.stringify(Object.fromEntries(records.map((record) => [record.sourceUrl, {
    path: record.transformedUrl,
    mode: record.mode,
    mime: record.mime,
  }])));
  const keyParts = key ? key.toString('base64').match(/.{1,8}/g)?.reverse() || [] : [];
  return `(() => {
  'use strict';
  const records = ${manifest};
  const keyParts = ${JSON.stringify(keyParts)};
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const encryptedMagic = 'RPGAGENTENC1\\n';
  const obfuscatedMagic = 'RPGOBF1\\n';
  function bytes(text) { return Uint8Array.from(text, value => value.charCodeAt(0)); }
  function startsWith(data, text) { const mark = bytes(text); return mark.every((value, index) => data[index] === value); }
  function recordFor(value) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(String(value), location.href).pathname).replace(/\\\\/g, '/'); }
    catch { pathname = String(value).split(/[?#]/)[0].replace(/\\\\/g, '/'); }
    for (const [name, record] of Object.entries(records)) {
      if (pathname === name || pathname.endsWith('/' + name)) return record;
    }
    return null;
  }
  function base64Bytes(text) { const raw = atob(text); return Uint8Array.from(raw, value => value.charCodeAt(0)); }
  function keyBytes() { return base64Bytes(keyParts.slice().reverse().join('')); }
  async function decrypt(data) {
    if (startsWith(data, obfuscatedMagic)) {
      return base64Bytes(new TextDecoder().decode(data.subarray(obfuscatedMagic.length)));
    }
    if (!startsWith(data, encryptedMagic)) throw new Error('Processed game content has an invalid header.');
    const offset = encryptedMagic.length;
    const iv = data.subarray(offset, offset + 12);
    const tag = data.subarray(offset + 12, offset + 28);
    const payload = data.subarray(offset + 28);
    if (globalThis.process && process.versions && process.versions.nw && typeof require === 'function') {
      const nodeCrypto = require('crypto');
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', Buffer.from(keyBytes()), Buffer.from(iv));
      decipher.setAuthTag(Buffer.from(tag));
      return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(payload)), decipher.final()]));
    }
    if (!globalThis.crypto || !crypto.subtle) throw new Error('AES-GCM content decryption is unavailable in this runtime.');
    const imported = await crypto.subtle.importKey('raw', keyBytes(), 'AES-GCM', false, ['decrypt']);
    const joined = new Uint8Array(payload.length + tag.length);
    joined.set(payload); joined.set(tag, payload.length);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, imported, joined));
  }
  async function load(record) {
    const response = await nativeFetch(record.path, { cache: 'no-store' });
    if (!response.ok) throw new Error('Processed game content returned HTTP ' + response.status + ': ' + record.path);
    return decrypt(new Uint8Array(await response.arrayBuffer()));
  }
  globalThis.fetch = async function(input, init) {
    const record = recordFor(typeof input === 'string' ? input : input && input.url);
    if (!record) return nativeFetch(input, init);
    const data = await load(record);
    return new Response(data, { status: 200, headers: { 'Content-Type': record.mime, 'Content-Length': String(data.byteLength) } });
  };
  if (globalThis.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__rpgAgentRecord = recordFor(url);
      if (!this.__rpgAgentRecord) return originalOpen.apply(this, arguments);
      return originalOpen.call(this, method, 'data:application/octet-stream;base64,', true);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const record = this.__rpgAgentRecord;
      if (!record) return originalSend.call(this, body);
      const request = this;
      load(record).then(data => {
        const array = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const text = new TextDecoder().decode(data);
        const response = request.responseType === 'arraybuffer' ? array : request.responseType === 'json' ? JSON.parse(text) : text;
        Object.defineProperties(request, {
          readyState: { configurable: true, value: 4 }, status: { configurable: true, value: 200 },
          statusText: { configurable: true, value: 'OK' }, response: { configurable: true, value: response },
          responseText: { configurable: true, value: request.responseType && request.responseType !== 'text' ? '' : text },
        });
        request.dispatchEvent(new Event('load'));
        request.dispatchEvent(new Event('loadend'));
      }).catch(error => {
        request.__rpgAgentError = error;
        request.dispatchEvent(new Event('error'));
        request.dispatchEvent(new Event('loadend'));
      });
    };
  }
  function patchMediaSource(prototype) {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
    if (!descriptor || !descriptor.set || !descriptor.get) return;
    Object.defineProperty(prototype, 'src', {
      configurable: descriptor.configurable, enumerable: descriptor.enumerable, get: descriptor.get,
      set(value) {
        const record = recordFor(value);
        if (!record) return descriptor.set.call(this, value);
        const target = this;
        load(record).then(data => descriptor.set.call(target, URL.createObjectURL(new Blob([data], { type: record.mime }))))
          .catch(error => { console.error('[RPGAgentContentLoader]', error); if (typeof target.onerror === 'function') target.onerror(error); });
      },
    });
  }
  patchMediaSource(globalThis.HTMLImageElement && HTMLImageElement.prototype);
  patchMediaSource(globalThis.HTMLMediaElement && HTMLMediaElement.prototype);
  if (globalThis.PluginManager && typeof PluginManager.loadScript === 'function') {
    const nativeLoadScript = PluginManager.loadScript;
    PluginManager.loadScript = function(name) {
      const record = recordFor('js/plugins/' + name);
      if (!record) return nativeLoadScript.apply(this, arguments);
      load(record).then(data => {
        const script = document.createElement('script');
        script.type = 'text/javascript'; script.async = false;
        script.src = URL.createObjectURL(new Blob([data], { type: 'text/javascript' }));
        script.onerror = this.onError.bind(this);
        document.body.appendChild(script);
      }).catch(error => { console.error('[RPGAgentContentLoader]', error); this._errorUrls.push(name); });
    };
  }
  globalThis.RPGAgentContent = Object.freeze({ records: Object.keys(records), load: async path => load(recordFor(path)) });
})();
`;
}

function managedFfmpegPath(workflowRoot: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'game-build', 'tools', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function requireEncryptionKey(key: Buffer | undefined): Buffer {
  if (!key || key.byteLength !== 32) throw new Error('A valid 256-bit encryption key is required.');
  return key;
}

function listFiles(root: string): string[] {
  const result: string[] = [];
  walk(path.resolve(root), '');
  return result.sort((left, right) => left.localeCompare(right, 'en'));
  function walk(directory: string, relativeDirectory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (fs.lstatSync(absolutePath).isSymbolicLink()) throw new Error(`Build content contains a symbolic link: ${relativePath}.`);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile()) result.push(relativePath.replace(/\\/g, '/'));
    }
  }
}

function resolveRelative(root: string, relativePath: string): string {
  const target = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe build content path: ${relativePath}.`);
  return target;
}

function mimeForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    '.json': 'application/json', '.mzui': 'application/json', '.js': 'text/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
    '.webm': 'video/webm', '.mp4': 'video/mp4',
  } as Record<string, string>)[extension] || 'application/octet-stream';
}

function lastLine(value: string | Buffer | null | undefined): string {
  return String(value || '').trim().split(/\r?\n/).at(-1) || '';
}
