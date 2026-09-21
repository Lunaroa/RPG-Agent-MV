import fs from 'node:fs';
import path from 'node:path';
import { downloadVerifiedTool } from './game-tool-download.ts';
import { extractZipArchive } from './zip-extraction-service.ts';
import { runGameBuildProcess } from './game-build-process-service.ts';
import { writeJsonAtomically } from './game-build-file-service.ts';
import type { GameToolInstallContext } from './game-tool-install-context.ts';

export const MEDIA_TOOL_SOURCE = Object.freeze({
  version: '9.0.1',
  url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip',
  sha256: 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9',
  license: 'GPL-3.0',
  sourceUrl: 'https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a',
});

export function managedFfmpegPath(workflowRoot: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'game-build', 'tools', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

export function managedFfprobePath(workflowRoot: string): string {
  return path.join(path.dirname(managedFfmpegPath(workflowRoot)), 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

export async function installMediaTools(workflowRoot: string, acceptLicense: boolean, context: GameToolInstallContext): Promise<void> {
  if (!acceptLicense) throw new Error('Accept the FFmpeg GPL-3.0 license before installing media tools.');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Managed media tools require Windows x64.');
  const target = path.dirname(managedFfmpegPath(workflowRoot));
  if (fs.existsSync(target)) throw new Error('The media tools directory already exists. It will not be overwritten.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(`${target}.install-`);
  let installError: unknown;
  try {
    const archive = path.join(staging, 'ffmpeg.zip');
    await downloadVerifiedTool(MEDIA_TOOL_SOURCE.url, archive, MEDIA_TOOL_SOURCE.sha256, {
      isCanceled: context.isCanceled,
      onProgress: (received, total) => context.reportProgress?.({ stage: 'download', component: 'FFmpeg', received, total }),
    });
    context.reportProgress?.({ stage: 'extract', component: 'FFmpeg' });
    extractZipArchive(archive, path.join(staging, 'extracted'));
    const contents = path.join(staging, 'extracted', `ffmpeg-${MEDIA_TOOL_SOURCE.version}-essentials_build`);
    fs.renameSync(path.join(contents, 'bin', 'ffmpeg.exe'), path.join(contents, 'ffmpeg.exe'));
    context.reportProgress?.({ stage: 'verify', component: 'FFmpeg' });
    const verified = await runGameBuildProcess(path.join(contents, 'ffmpeg.exe'), ['-version'], {
      maxBuffer: 1024 * 1024, timeoutMs: 30_000, isCanceled: context.isCanceled,
    });
    if (verified.status !== 0 || !verified.stdout.startsWith(`ffmpeg version ${MEDIA_TOOL_SOURCE.version}`)) throw new Error('The installed FFmpeg version could not be verified.');
    const probeVerified = await runGameBuildProcess(path.join(contents, 'bin', 'ffprobe.exe'), ['-version'], {
      maxBuffer: 1024 * 1024, timeoutMs: 30_000, isCanceled: context.isCanceled,
    });
    if (probeVerified.status !== 0 || !probeVerified.stdout.startsWith(`ffprobe version ${MEDIA_TOOL_SOURCE.version}`)) throw new Error('The installed FFprobe version could not be verified.');
    writeJsonAtomically(path.join(contents, 'rpg-agent-media-tools.json'), MEDIA_TOOL_SOURCE);
    context.reportProgress?.({ stage: 'publish', component: 'FFmpeg' });
    fs.renameSync(contents, target);
  } catch (error) {
    installError = error;
    throw error;
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); }
    catch (cleanupError) {
      if (installError) throw new AggregateError([installError, cleanupError], `${installError instanceof Error ? installError.message : String(installError)}\nMedia tool temporary-file cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      throw cleanupError;
    }
  }
}
