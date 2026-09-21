import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AndroidAudioPreparation } from '../../../../contract/game-release.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { isInside } from './game-build-file-service.ts';
import { GameBuildProcessCanceledError, runGameBuildProcess } from './game-build-process-service.ts';
import { managedFfmpegPath, managedFfprobePath } from './game-media-tools-service.ts';

interface AudioInfo {
  sampleRate: number;
  channels: number;
  codec: string;
  loopStart?: number;
  loopLength?: number;
  comment?: string;
}

export function inspectAndroidAudio(
  workflowRoot: string, project: string, engine: RpgMakerEngine, encryptedAudio: boolean,
): { blockers: string[]; preparation?: AndroidAudioPreparation } {
  if (engine !== 'rpg-maker-mv') return { blockers: [] };
  const root = resolveRmmvLayout(project).resourceRoot;
  const missing = missingAudioPairs(root, encryptedAudio);
  if (!missing.length) return { blockers: [] };
  const unsupported = missing.filter(pair => encryptedAudio || !/\.ogg$/i.test(pair.sourcePath));
  if (unsupported.length) {
    return { blockers: [`Encrypted Android mobile audio cannot be prepared automatically. Supply the matching mobile audio: ${unsupported.slice(0, 5).map(pair => pair.targetPath).join(', ')}.`] };
  }
  return { blockers: [], preparation: audioPlan(workflowRoot, missing) };
}

// The strict check is also used after preparing the build copy and by existing callers.
export function preflightAndroidAudio(project: string, engine: RpgMakerEngine, encryptedAudio: boolean): string[] {
  if (engine !== 'rpg-maker-mv') return [];
  const missing = missingAudioPairs(resolveRmmvLayout(project).resourceRoot, encryptedAudio);
  return missing.length ? [`RPG Maker MV on Android requires ${encryptedAudio ? '.rpgmvm' : '.m4a'} audio. ${missing.length} mobile audio file(s) are missing or empty: ${missing.slice(0, 5).map(pair => pair.targetPath).join(', ')}.`] : [];
}

export function assertAndroidAudioConfirmation(plan: AndroidAudioPreparation | undefined, confirmedId?: string): void {
  if (plan && plan.id !== confirmedId) throw new Error('Confirm Android audio preparation for the current missing files before building.');
  if (plan && !plan.toolsReady) throw new Error('Android audio preparation requires the managed FFmpeg and FFprobe tools. Install media tools before building.');
}

export async function prepareAndroidAudio(
  workflowRoot: string, project: string, buildRoot: string, confirmedId: string,
  options: { isCanceled?: () => boolean; onProgress?: (completed: number, total: number) => void } = {},
): Promise<string[]> {
  const assertNotCanceled = () => { if (options.isCanceled?.()) throw new GameBuildProcessCanceledError(); };
  assertNotCanceled();
  const sourceRoot = fs.realpathSync.native(resolveRmmvLayout(project).resourceRoot);
  const destinationRoot = fs.realpathSync.native(buildRoot);
  if (isInside(sourceRoot, destinationRoot) || isInside(destinationRoot, sourceRoot)) {
    throw new Error('Android audio preparation requires a separate build copy, not the source project.');
  }
  const plan = audioPlan(workflowRoot, missingAudioPairs(destinationRoot, false));
  if (!plan.files.length) return [];
  assertAndroidAudioConfirmation(plan, confirmedId);
  const generated: string[] = [];
  options.onProgress?.(0, plan.files.length);
  for (const pair of plan.files) {
    assertNotCanceled();
    const input = resolveAudioFile(destinationRoot, pair.sourcePath);
    const output = resolveAudioFile(destinationRoot, pair.targetPath);
    if (!/\.ogg$/i.test(pair.sourcePath)) throw new Error(`Android audio preparation requires an unencrypted OGG source: ${pair.sourcePath}.`);
    const info = await probeAudio(workflowRoot, input, options.isCanceled);
    const temporary = `${output}.${crypto.randomUUID()}.m4a`;
    let conversionError: unknown;
    try {
      const result = await runGameBuildProcess(managedFfmpegPath(workflowRoot), androidAudioConversionArguments(input, temporary, info), {
        maxBuffer: 4 * 1024 * 1024, timeoutMs: 5 * 60_000, isCanceled: options.isCanceled,
      });
      if (result.status !== 0) throw new Error(`Android audio conversion failed for ${pair.sourcePath}: ${result.stderr.trim() || `exit ${result.status}`}`);
      const encoded = await probeAudio(workflowRoot, temporary, options.isCanceled);
      if (encoded.codec !== 'aac' || encoded.sampleRate !== info.sampleRate || encoded.channels !== info.channels
        || (loopComment(info) && encoded.comment !== loopComment(info))) {
        throw new Error(`Android audio metadata verification failed for ${pair.targetPath}.`);
      }
      assertNotCanceled();
      if (fs.existsSync(output)) {
        if (fs.statSync(output).size !== 0) throw new Error(`Android audio output already exists: ${pair.targetPath}.`);
        fs.rmSync(output);
      }
      fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL);
      generated.push(pair.targetPath);
      options.onProgress?.(generated.length, plan.files.length);
    } catch (error) {
      conversionError = error;
      throw error;
    } finally {
      try { if (fs.existsSync(temporary)) fs.rmSync(temporary); }
      catch (cleanupError) {
        if (conversionError) throw new AggregateError([conversionError, cleanupError], `${String(conversionError)}\nAndroid audio temporary-file cleanup failed: ${String(cleanupError)}`);
        throw cleanupError;
      }
    }
  }
  const missing = missingAudioPairs(destinationRoot, false);
  if (missing.length) throw new Error('Android audio preparation did not produce all required mobile audio files.');
  return generated;
}

export function readAudioInfo(output: string): AudioInfo {
  const data = JSON.parse(output) as { streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; tags?: Record<string, string> }>; format?: { tags?: Record<string, string> } };
  const streams = data.streams?.filter(stream => stream.codec_type === 'audio') || [];
  if (streams.length !== 1) throw new Error('Android audio preparation requires exactly one audio stream.');
  const stream = streams[0]!;
  const sampleRate = Number(stream.sample_rate);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(stream.channels) || stream.channels! <= 0) {
    throw new Error('Android audio has an invalid sample rate or channel count.');
  }
  const tags: Record<string, string> = {};
  for (const source of [data.format?.tags, stream.tags]) {
    for (const [key, value] of Object.entries(source || {})) {
      const normalized = key.toUpperCase();
      if (tags[normalized] !== undefined && tags[normalized] !== value) throw new Error(`Android audio contains conflicting metadata: ${normalized}.`);
      tags[normalized] = value;
    }
  }
  const loop = (key: string): number | undefined => {
    if (tags[key] === undefined) return undefined;
    if (!/^\d+$/.test(tags[key]!) || !Number.isSafeInteger(Number(tags[key]))) throw new Error(`Android audio has invalid ${key} metadata.`);
    return Number(tags[key]);
  };
  return { sampleRate, channels: stream.channels!, codec: stream.codec_name || '', loopStart: loop('LOOPSTART'), loopLength: loop('LOOPLENGTH'), comment: tags.COMMENT };
}

export function androidAudioConversionArguments(input: string, output: string, info: AudioInfo): string[] {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-i', input, '-map', '0:a:0', '-map_metadata', '0',
    '-c:a', 'aac', '-b:a', '160k', '-ar', String(info.sampleRate), '-movie_timescale', String(info.sampleRate), '-movflags', '+faststart'];
  const comment = loopComment(info);
  if (comment) args.push('-metadata', `comment=${comment}`);
  return [...args, output];
}

function loopComment(info: AudioInfo): string {
  return [info.loopStart === undefined ? '' : `LOOPSTART=${info.loopStart}`, info.loopLength === undefined ? '' : `LOOPLENGTH=${info.loopLength}`].filter(Boolean).join('\n');
}

async function probeAudio(workflowRoot: string, file: string, isCanceled?: () => boolean): Promise<AudioInfo> {
  const result = await runGameBuildProcess(managedFfprobePath(workflowRoot), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
    maxBuffer: 4 * 1024 * 1024, timeoutMs: 30_000, isCanceled,
  });
  if (result.status !== 0) throw new Error(`Android audio inspection failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  return readAudioInfo(result.stdout);
}

function audioPlan(workflowRoot: string, files: AndroidAudioPreparation['files']): AndroidAudioPreparation {
  return {
    id: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files,
    toolsReady: [managedFfmpegPath(workflowRoot), managedFfprobePath(workflowRoot)].every(file => fs.existsSync(file) && fs.statSync(file).isFile()),
  };
}

function missingAudioPairs(root: string, encrypted: boolean): AndroidAudioPreparation['files'] {
  const files: string[] = [];
  const audioRoot = path.join(root, 'audio');
  if (!fs.existsSync(audioRoot)) return [];
  const walk = (directory: string) => {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Android audio contains a symbolic link.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Android audio contains a symbolic link.');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join('/'));
    }
  };
  walk(audioRoot);
  const existing = new Set(files);
  const missing = new Map<string, { sourcePath: string; targetPath: string }>();
  for (const sourcePath of files.sort()) {
    if (!/\.(ogg|rpgmvo)$/i.test(sourcePath)) continue;
    const targetPath = sourcePath.replace(/\.(ogg|rpgmvo)$/i, encrypted ? '.rpgmvm' : '.m4a');
    if (existing.has(targetPath) && fs.statSync(resolveAudioFile(root, targetPath)).size > 0) continue;
    // Plain OGG is the explicit convertible source if both exported formats are present.
    if (!missing.has(targetPath) || /\.ogg$/i.test(sourcePath)) missing.set(targetPath, { sourcePath, targetPath });
  }
  return [...missing.values()].sort((a, b) => a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0);
}

function resolveAudioFile(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split('/'));
  if (!relative.startsWith('audio/') || !isInside(root, target) || target === root) throw new Error('Unsafe Android audio path.');
  return target;
}
