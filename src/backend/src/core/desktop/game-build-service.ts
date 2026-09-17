import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  GameBuildArtifact,
  GameBuildFileManifestEntry,
  GameBuildPreflightResult,
  GameBuildProgressEvent,
  GameBuildPreset,
  GameBuildReport,
  GameBuildRequest,
  GameBuildResult,
  GameContentCategory,
  GameReleaseConfig,
  GameReleaseProjectSettings,
} from '../../../../contract/game-release.ts';
import { inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import {
  buildAndroidApks,
  preflightAndroidBuild,
  recordAndroidBuildSuccess,
  type AndroidBuildOutput,
} from './game-android-build-service.ts';
import { createBinaryPatch } from './game-binary-diff.ts';
import {
  applyContentProcessing,
  preflightContentProcessing,
} from './game-content-processing-service.ts';
import { compareGameBuildContent } from './game-build-content-changes.ts';
import { readGameEncryptionKey } from './game-encryption-key-service.ts';
import {
  assertOutputLocation,
  collectDirectoryDigest,
  copyGameDirectory,
  createOutputStagingDirectory,
  gameArtifactBaseName,
  isInside,
  sha256File,
  writeJsonAtomically,
  writeZipArchive,
} from './game-build-file-service.ts';
import {
  createDefaultGameReleaseProjectSettings,
  validateGameReleaseProjectSettings,
} from './game-build-preset.ts';
import {
  createDefaultGameReleaseConfig,
  inspectGameReleaseRuntimeChanges,
  readGameReleaseStatus,
  saveGameReleaseConfig,
  validateGameReleaseConfig,
} from './game-release-service.ts';
import { parseGameVersion } from './game-version.ts';
import { installWindowsUpdaterRuntime } from './game-windows-updater-service.ts';
import {
  inspectWindowsExecutableArchitecture,
  WINDOWS_REQUIRED_RUNTIME_FILES,
} from './game-windows-runtime-contract.ts';
import { validatePluginConfiguration } from './plugin-management-service.ts';
import { patchProjectConfig, readProjectConfig } from './project-config-service.ts';

const HISTORY_DIRECTORY = path.join('.luna_rpg', 'release-history');
const PACKAGE_METADATA_PATH = '.rpg-agent/release-package.json';
const CURRENT_RELEASE_PATH = '.rpg-agent/current-release.json';
const PROCESSING_CATEGORIES: GameContentCategory[] = ['images', 'audio', 'video', 'data', 'javascript', 'ui'];
const BUILD_WORKER_TYPESCRIPT = import.meta.url.endsWith('.ts');
const BUILD_WORKER_FILE = BUILD_WORKER_TYPESCRIPT ? './game-build-worker.ts' : './game-build-worker.js';
const BUILD_WORKER_URL = new URL(BUILD_WORKER_FILE, import.meta.url);
const BUILD_WORKER_EXEC_ARGV = BUILD_WORKER_TYPESCRIPT
  ? ['--experimental-strip-types', '--experimental-transform-types']
  : [];

export interface GameBuildExecutionOptions {
  signal?: AbortSignal;
  isCanceled?: () => boolean;
  reportProgress?: (event: Omit<GameBuildProgressEvent, 'operationId'>) => void;
}

export interface GameBuildWorkerHandle {
  result: Promise<GameBuildResult>;
  cancel: () => void;
}

interface GameBuildPreflightInput {
  presetId: string;
  releaseConfig?: GameReleaseConfig;
}

interface BaseReleaseContext {
  report: GameBuildReport;
  files: Map<string, GameBuildFileManifestEntry>;
}

export function readGameBuildSettings(project: string): GameReleaseProjectSettings {
  const current = readProjectConfig(project).release;
  return current
    ? validateGameReleaseProjectSettings(current)
    : createDefaultGameReleaseProjectSettings(project);
}

export function saveGameBuildSettings(project: string, value: unknown): GameReleaseProjectSettings {
  const release = validateGameReleaseProjectSettings(value);
  patchProjectConfig(project, { release });
  return release;
}

export function listAndroidIconCandidates(project: string): string[] {
  const resourceRoot = resolveRmmvLayout(project).resourceRoot;
  const iconDirectory = path.join(resourceRoot, 'icon');
  if (!fs.existsSync(iconDirectory) || !fs.statSync(iconDirectory).isDirectory()) return [];
  return fs.readdirSync(iconDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => `icon/${entry.name}`)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function preflightGameBuild(
  workflowRoot: string,
  project: string,
  input: GameBuildPreflightInput,
): GameBuildPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const settings = readGameBuildSettings(project);
  const preset = requirePreset(settings, input.presetId);
  let currentStatus: ReturnType<typeof readGameReleaseStatus>;
  try {
    currentStatus = readGameReleaseStatus(workflowRoot, project);
  } catch (error) {
    throw new Error(`The game release configuration cannot be read: ${message(error)}`);
  }
  const release = input.releaseConfig
    ? validateGameReleaseConfig(input.releaseConfig)
    : currentStatus.config;
  if (!currentStatus.exists && !input.releaseConfig) {
    blockers.push('Save the game version configuration before building.');
  }
  if (preset.channel !== release.channel) {
    blockers.push(`The preset channel (${preset.channel}) must match the game channel (${release.channel}).`);
  }

  const manifest = inspectRmmvProject(project);
  if (!manifest.runnableStructure) {
    blockers.push(`The RPG Maker project is not runnable: ${manifest.missingRequired.join(', ') || 'required runtime files are missing'}.`);
  }
  const pluginValidation = validatePluginConfiguration(workflowRoot, project);
  blockers.push(...pluginValidation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `Plugin configuration: ${issue.message}`));
  warnings.push(...pluginValidation.issues
    .filter((issue) => issue.severity === 'warn')
    .map((issue) => `Plugin warning: ${issue.message}`));

  const managedChanges = inspectGameReleaseRuntimeChanges(workflowRoot, project, release);
  if (!currentStatus.exists) {
    managedChanges.unshift({
      relativePath: currentStatus.relativePath,
      kind: 'create',
      description: 'Create the game release configuration in the engine data directory.',
    });
  } else if (JSON.stringify(currentStatus.config) !== JSON.stringify(release)) {
    managedChanges.unshift({
      relativePath: currentStatus.relativePath,
      kind: 'update',
      description: 'Update the game release configuration before building.',
    });
  }

  const activeProcessing = PROCESSING_CATEGORIES.filter((category) => preset.processing[category] !== 'none');
  if (manifest.encryptedResources && activeProcessing.length) {
    blockers.push('The source project already contains encrypted resources. Use an unencrypted source project before applying build processing.');
  }
  const processingPreflight = preflightContentProcessing(workflowRoot, project, preset.processing);
  blockers.push(...processingPreflight.blockers);
  warnings.push(...processingPreflight.warnings);

  const outputRoot = resolveOutputDirectory(project, preset.outputDirectory);
  try {
    assertOutputLocation(project, outputRoot);
    assertWritableDestination(outputRoot);
  } catch (error) {
    blockers.push(message(error));
  }
  const gameName = readGameName(project, release.gameId);
  const outputPath = path.join(outputRoot, gameArtifactBaseName(gameName, release.version, preset.target, preset.architecture));
  const existingOutput = fs.existsSync(outputPath) || (preset.zip && fs.existsSync(`${outputPath}.zip`));

  if (preset.packageType !== 'full') {
    try {
      requireBaseRelease(project, preset, release);
    } catch (error) {
      blockers.push(message(error));
    }
  }
  if (preset.target === 'windows') {
    try {
      resolveWindowsRuntime(workflowRoot, project, manifest.engine, preset.architecture);
    } catch (error) {
      blockers.push(message(error));
    }
  } else if (preset.target === 'android') {
    const android = preflightAndroidBuild(workflowRoot, project, settings, preset);
    blockers.push(...android.blockers);
    warnings.push(...android.warnings);
  }
  if (preset.upload?.enabled && preset.upload.baseUrl.startsWith('http:')) {
    warnings.push('The upload destination uses HTTP. Hashes detect corruption but do not protect credentials or prove server identity.');
  }
  if (release.update.enabled && !release.update.manifestSignature?.enabled) {
    warnings.push('The update manifest is unsigned. SHA-256 detects corruption but cannot prove that a release came from the developer.');
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    release,
    preset,
    outputPath,
    existingOutput,
    managedChanges,
  };
}

export async function buildGame(
  workflowRoot: string,
  project: string,
  request: GameBuildRequest,
  options: GameBuildExecutionOptions = {},
): Promise<GameBuildResult> {
  const startedAt = new Date().toISOString();
  const releaseId = crypto.randomUUID();
  const progress = (stage: GameBuildProgressEvent['stage'], percent: number) => {
    options.reportProgress?.({ stage, percent });
  };
  const cancellationRequested = () => Boolean(options.signal?.aborted || options.isCanceled?.());
  const assertNotCanceled = () => {
    if (cancellationRequested()) throw new GameBuildCanceledError();
  };
  let preflight: GameBuildPreflightResult;
  try {
    progress('preflight', 2);
    assertNotCanceled();
    preflight = preflightGameBuild(workflowRoot, project, {
      presetId: request.presetId,
      ...(request.releaseConfig ? { releaseConfig: request.releaseConfig } : {}),
    });
  } catch (error) {
    if (error instanceof GameBuildCanceledError || cancellationRequested()) return canceledResult();
    const recovered = recoverFailedPreflight(workflowRoot, project, request, error);
    return failedBuildWithReport(project, recovered, releaseId, startedAt, 'preflight', error);
  }
  if (!preflight.ok) {
    return failedBuildWithReport(
      project,
      preflight,
      releaseId,
      startedAt,
      'preflight',
      new Error(preflight.blockers.join('\n')),
    );
  }
  if (preflight.existingOutput && request.outputConflict === 'cancel') {
    return { status: 'canceled', artifacts: [], warnings: preflight.warnings };
  }
  if (preflight.managedChanges.length && request.confirmManagedChanges !== true) {
    return failedBuildWithReport(
      project,
      preflight,
      releaseId,
      startedAt,
      'managed-files-confirmation',
      new Error('Review and confirm the listed project file changes before building.'),
    );
  }

  let failedStage = 'managed-files';
  let stagingRoot: string | null = null;
  try {
    progress('managed-files', 8);
    assertNotCanceled();
    if (preflight.managedChanges.length) {
      saveGameReleaseConfig(workflowRoot, project, {
        config: preflight.release,
        ...(request.releaseExpectedSourceHash !== undefined
          ? { expectedSourceHash: request.releaseExpectedSourceHash }
          : {}),
        installRuntimePlugins: true,
      });
    }
    const verified = preflightGameBuild(workflowRoot, project, { presetId: request.presetId });
    if (!verified.ok || verified.managedChanges.length) {
      throw new Error([...verified.blockers, ...verified.managedChanges.map((change) => change.description)].join('\n'));
    }

    failedStage = 'prepare-output';
    progress('prepare-output', 16);
    assertNotCanceled();
    const preset = verified.preset;
    const outputRoot = resolveOutputDirectory(project, preset.outputDirectory);
    const destinations = resolveDestinations(verified.outputPath, preset.zip, request.outputConflict);
    if (!destinations) return { status: 'canceled', artifacts: [], warnings: verified.warnings };
    stagingRoot = createOutputStagingDirectory(outputRoot);
    const completeContent = path.join(stagingRoot, 'complete-content');
    const packageContent = path.join(stagingRoot, 'package-content');

    failedStage = 'copy-project';
    progress('copy-project', 24);
    assertNotCanceled();
    const runtime = prepareCompleteContent(workflowRoot, project, preset, completeContent);
    failedStage = 'process-content';
    progress('process-content', 38);
    assertNotCanceled();
    const processing = await applyContentProcessing(
      workflowRoot,
      project,
      completeContent,
      preset.processing,
      inspectRmmvProject(project).engine,
      { isCanceled: cancellationRequested },
    );
    assertNotCanceled();
    writeJsonAtomically(path.join(completeContent, ...CURRENT_RELEASE_PATH.split('/')), {
      schemaVersion: 1,
      releaseId,
      gameId: verified.release.gameId,
      version: verified.release.version,
      channel: verified.release.channel,
    });
    const targetDigest = collectDirectoryDigest(
      completeContent,
      (relativePath) => processing.processed[relativePath] || 'none',
    );
    const base = preset.packageType === 'full' ? null : requireBaseRelease(project, preset, verified.release);
    const deletedFiles = base
      ? [...base.files.keys()].filter((file) => !targetDigest.files.some((entry) => entry.path === file)).sort()
      : [];
    const contentChanges = base
      ? compareGameBuildContent(base.report.releaseId, targetDigest.files, base.files, preset.target)
      : undefined;

    let androidOutput: AndroidBuildOutput | null = null;
    if (preset.target === 'android') {
      failedStage = 'android-apk';
      progress('android-apk', 58);
      assertNotCanceled();
      androidOutput = await buildAndroidApks({
        workflowRoot,
        project,
        settings: readGameBuildSettings(project),
        preset,
        request,
        completeContent,
        outputContainer: packageContent,
        gameName: readGameName(project, verified.release.gameId),
        version: verified.release.version,
        releaseId,
        allowCleartext: verified.release.update.indexUrl.startsWith('http:'),
        isCanceled: cancellationRequested,
      });
      assertNotCanceled();
    }

    failedStage = 'create-package';
    progress('create-package', 68);
    assertNotCanceled();
    const packagePayload = preset.target === 'android' ? path.join(packageContent, 'content') : packageContent;
    const packageDetails = createPackageContent(
      preset,
      completeContent,
      packagePayload,
      targetDigest.files,
      deletedFiles,
      base,
    );
    const versionParts = parseGameVersion(verified.release.version);
    const packageManifest = {
      schemaVersion: 1,
      releaseId,
      gameId: verified.release.gameId,
      version: verified.release.version,
      versionCore: [versionParts.major, versionParts.minor, versionParts.patch],
      suffix: versionParts.suffix,
      channel: verified.release.channel,
      target: preset.target,
      architecture: preset.architecture,
      packageType: preset.packageType,
      ...(preset.baseReleaseId ? { baseReleaseId: preset.baseReleaseId } : {}),
      processing: preset.processing,
      encryption: preset.processing.encryptionKeyId
        ? {
          algorithm: 'AES-256-GCM',
          keyId: preset.processing.encryptionKeyId,
          keySha256: processing.encryptionKeySha256,
          ivBytes: 12,
          tagBytes: 16,
        }
        : null,
      targetFiles: targetDigest.files,
      deletedFiles,
      patches: packageDetails.patches,
      ...(androidOutput ? {
        android: {
          applicationId: preset.android!.applicationId,
          versionCodes: androidOutput.versionCodes,
          signingCertificateSha256: androidOutput.certificateSha256,
        },
      } : {}),
    };
    const packageMetadataFile = path.join(packagePayload, ...PACKAGE_METADATA_PATH.split('/'));
    writeJsonAtomically(packageMetadataFile, packageManifest);
    const packageDigest = collectDirectoryDigest(packagePayload);

    failedStage = 'zip';
    progress('zip', 78);
    assertNotCanceled();
    const baseName = path.basename(destinations.directory);
    const stagedZip = preset.zip ? path.join(stagingRoot, `${baseName}.zip`) : null;
    if (stagedZip) writeZipArchive(packageContent, stagedZip, baseName);

    failedStage = 'publish-output';
    progress('publish-output', 86);
    assertNotCanceled();
    publishArtifacts(packageContent, stagedZip, destinations, request.outputConflict);
    const contentDestination = preset.target === 'android'
      ? path.join(destinations.directory, 'content')
      : destinations.directory;
    const artifacts: GameBuildArtifact[] = [{
      kind: preset.packageType === 'full' ? 'directory' : 'delta',
      platform: preset.target,
      architecture: preset.target === 'android' ? 'universal' : preset.architecture,
      path: contentDestination,
      bytes: packageDigest.bytes,
      sha256: packageDigest.sha256,
      packageType: preset.packageType,
      ...(preset.android ? { applicationId: preset.android.applicationId } : {}),
    }];
    const manifestDestination = path.join(contentDestination, ...PACKAGE_METADATA_PATH.split('/'));
    artifacts.push({
      kind: 'manifest',
      platform: preset.target,
      architecture: preset.architecture,
      path: manifestDestination,
      bytes: fs.statSync(manifestDestination).size,
      sha256: sha256File(manifestDestination),
      packageType: preset.packageType,
    });
    if (androidOutput) {
      for (const artifact of androidOutput.artifacts) {
        const publishedPath = path.join(destinations.directory, path.basename(artifact.path));
        artifacts.push({ ...artifact, path: publishedPath });
      }
    }
    if (destinations.zip) {
      artifacts.push({
        kind: 'zip',
        platform: preset.target,
        architecture: preset.architecture,
        path: destinations.zip,
        bytes: fs.statSync(destinations.zip).size,
        sha256: sha256File(destinations.zip),
        packageType: preset.packageType,
      });
    }

    failedStage = 'write-report';
    progress('write-report', 95);
    const report: GameBuildReport = {
      schemaVersion: 1,
      releaseId,
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      gameId: verified.release.gameId,
      gameName: readGameName(project, verified.release.gameId),
      version: verified.release.version,
      versionCore: [versionParts.major, versionParts.minor, versionParts.patch],
      suffix: versionParts.suffix,
      channel: verified.release.channel,
      target: preset.target,
      architectures: architectureList(preset),
      presetId: preset.id,
      presetName: preset.name,
      packageType: preset.packageType,
      ...(preset.baseReleaseId ? { baseReleaseId: preset.baseReleaseId } : {}),
      gitCommit: readGitCommit(project),
      processing: preset.processing,
      ...(preset.processing.encryptionKeyId ? { encryptionKeyId: preset.processing.encryptionKeyId } : {}),
      ...(processing.encryptionKeySha256 ? { encryptionKeySha256: processing.encryptionKeySha256 } : {}),
      runtime: {
        ...runtime,
        ...(androidOutput?.runtime || {}),
        manifestSignatureAlgorithm: verified.release.update.manifestSignature?.enabled
          ? verified.release.update.manifestSignature.algorithm
          : null,
        manifestSignatureKeyId: verified.release.update.manifestSignature?.enabled
          ? verified.release.update.manifestSignature.keyId
          : null,
        manifestSignaturePublicKey: verified.release.update.manifestSignature?.enabled
          ? verified.release.update.manifestSignature.publicKey
          : null,
      },
      artifacts,
      files: targetDigest.files,
      deletedFiles,
      ...(contentChanges ? { contentChanges } : {}),
      warnings: verified.warnings,
    };
    const reportPath = releaseReportPath(project, releaseId);
    writeJsonAtomically(reportPath, report);
    if (preset.target === 'android') {
      try {
        saveGameBuildSettings(project, recordAndroidBuildSuccess(readGameBuildSettings(project), preset));
      } catch (settingsError) {
        report.warnings.push(`The APK build succeeded, but the next Android versionCode could not be saved automatically: ${message(settingsError)}`);
        writeJsonAtomically(reportPath, report);
      }
    }
    cleanupStaging(stagingRoot);
    stagingRoot = null;
    progress('complete', 100);
    return {
      status: 'success',
      releaseId,
      outputPath: destinations.directory,
      reportPath,
      artifacts,
      warnings: report.warnings,
      ...(contentChanges ? { contentChanges } : {}),
    };
  } catch (error) {
    if (stagingRoot) cleanupStaging(stagingRoot);
    if (error instanceof GameBuildCanceledError || cancellationRequested()) return canceledResult(preflight.warnings);
    return failedBuildWithReport(project, preflight, releaseId, startedAt, failedStage, error);
  }
}

export function startGameBuildWorker(
  workflowRoot: string,
  project: string,
  request: GameBuildRequest,
  onProgress: (event: GameBuildProgressEvent) => void,
): GameBuildWorkerHandle {
  const operationId = requireOperationId(request.operationId);
  const worker = new Worker(BUILD_WORKER_URL, { execArgv: BUILD_WORKER_EXEC_ARGV });
  worker.unref();
  const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const cancelState = new Int32Array(cancelBuffer);
  let settled = false;
  let cancelRequested = false;
  let resolveResult!: (value: GameBuildResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<GameBuildResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settleResult = (value: GameBuildResult) => {
    if (settled) return;
    settled = true;
    resolveResult(value);
    void worker.terminate();
  };
  worker.on('message', (messageValue: unknown) => {
    if (!messageValue || typeof messageValue !== 'object') return;
    const value = messageValue as {
      type?: string;
      event?: Omit<GameBuildProgressEvent, 'operationId'>;
      result?: GameBuildResult;
      error?: string;
    };
    if (value.type === 'progress' && value.event) {
      onProgress({ operationId, ...value.event });
    } else if (value.type === 'result' && value.result) {
      settleResult(value.result);
    } else if (value.type === 'error') {
      if (settled) return;
      settled = true;
      rejectResult(new Error(value.error || 'The packaging worker failed.'));
      void worker.terminate();
    }
  });
  worker.once('error', (error) => {
    if (settled) return;
    settled = true;
    if (cancelRequested) resolveResult(canceledResult());
    else rejectResult(error instanceof Error ? error : new Error(String(error)));
  });
  worker.once('exit', (code) => {
    if (settled) return;
    settled = true;
    if (cancelRequested) resolveResult(canceledResult());
    else rejectResult(new Error(`The packaging worker exited with code ${code}.`));
  });
  worker.postMessage({ type: 'start', workflowRoot, project, request, cancelBuffer });
  return {
    result,
    cancel: () => {
      if (settled || cancelRequested) return;
      cancelRequested = true;
      Atomics.store(cancelState, 0, 1);
      Atomics.notify(cancelState, 0);
    },
  };
}

class GameBuildCanceledError extends Error {
  constructor() {
    super('The build was canceled.');
    this.name = 'GameBuildCanceledError';
  }
}

function canceledResult(warnings: string[] = []): GameBuildResult {
  return { status: 'canceled', artifacts: [], warnings };
}

function requireOperationId(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('A valid packaging operation id is required.');
  }
  return value;
}

export function readGameBuildReport(project: string, releaseId: string): GameBuildReport {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseId)) throw new Error('Release id is invalid.');
  const file = releaseReportPath(project, releaseId);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Build baseline does not exist: ${releaseId}.`);
  const report = JSON.parse(fs.readFileSync(file, 'utf8')) as GameBuildReport;
  if (report.schemaVersion !== 1 || report.releaseId !== releaseId || !Array.isArray(report.files)) {
    throw new Error(`Build baseline is invalid: ${releaseId}.`);
  }
  return report;
}

function prepareCompleteContent(
  workflowRoot: string,
  project: string,
  preset: GameBuildPreset,
  target: string,
): Record<string, string | null> {
  const manifest = inspectRmmvProject(project);
  if (preset.target === 'web') {
    copyGameDirectory(manifest.resourceRoot, target);
    return { engine: manifest.engine, engineVersion: manifest.engineVersion, platformRuntime: 'browser' };
  }
  if (preset.target === 'android') {
    copyGameDirectory(manifest.resourceRoot, target);
    return { engine: manifest.engine, engineVersion: manifest.engineVersion, platformRuntime: 'managed-android-webview-shell' };
  }
  if (preset.target !== 'windows') throw new Error(`Unsupported build target: ${preset.target}.`);
  const runtime = resolveWindowsRuntime(workflowRoot, project, manifest.engine, preset.architecture);
  if (runtime.source === 'project') {
    copyGameDirectory(project, target);
  } else {
    copyGameDirectory(runtime.root, target);
    const contentRoot = runtime.contentDirectory === '.'
      ? target
      : path.join(target, ...runtime.contentDirectory.split('/'));
    copyGameDirectory(manifest.resourceRoot, contentRoot);
    const privateManifest = path.join(target, 'rpg-agent-runtime.json');
    if (fs.existsSync(privateManifest)) fs.rmSync(privateManifest);
  }
  installWindowsUpdaterRuntime(target, workflowRoot);
  return {
    engine: manifest.engine,
    engineVersion: manifest.engineVersion,
    platformRuntime: runtime.source === 'project' ? 'project-local' : runtime.runtimeVersion,
    architecture: preset.architecture,
  };
}

function createPackageContent(
  preset: GameBuildPreset,
  completeContent: string,
  packageContent: string,
  targetFiles: GameBuildFileManifestEntry[],
  deletedFiles: string[],
  base: BaseReleaseContext | null,
): { patches: Array<Record<string, unknown>> } {
  if (preset.packageType === 'full') {
    fs.renameSync(completeContent, packageContent);
    return { patches: [] };
  }
  if (!base) throw new Error('A delta package requires an exact base release.');
  fs.mkdirSync(packageContent, { recursive: true });
  const changedFiles = targetFiles.filter((file) => base.files.get(file.path)?.sha256 !== file.sha256);
  if (preset.packageType === 'file-delta') {
    for (const file of changedFiles) copyRelativeFile(completeContent, packageContent, file.path);
    return { patches: [] };
  }
  const patches: Array<Record<string, unknown>> = [];
  for (const file of changedFiles) {
    const target = fs.readFileSync(resolveSafeRelative(completeContent, file.path));
    const baseEntry = base.files.get(file.path);
    const baseFile = baseEntry ? locateBaseArtifactFile(base.report, file.path) : null;
    const baseContent = baseFile ? fs.readFileSync(baseFile) : null;
    const patch = createBinaryPatch(baseContent, target);
    const patchPath = `.rpg-agent/patches/${encodePatchPath(file.path)}.rpgpatch`;
    const destination = resolveSafeRelative(packageContent, patchPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, patch);
    patches.push({
      targetPath: file.path,
      patchPath,
      baseSha256: baseEntry?.sha256 || null,
      targetSha256: file.sha256,
      patchSha256: sha256File(destination),
      targetBytes: file.bytes,
    });
  }
  return { patches };
}

function locateBaseArtifactFile(report: GameBuildReport, relativePath: string): string {
  const directory = report.artifacts.find((artifact) => artifact.kind === 'directory' && artifact.packageType === 'full');
  if (!directory || !fs.existsSync(directory.path)) {
    throw new Error(`The exact full baseline directory for ${report.releaseId} is unavailable.`);
  }
  const file = resolveSafeRelative(directory.path, relativePath);
  if (!fs.existsSync(file) || sha256File(file) !== report.files.find((entry) => entry.path === relativePath)?.sha256) {
    throw new Error(`The baseline file no longer matches its build report: ${relativePath}.`);
  }
  return file;
}

function requireBaseRelease(project: string, preset: GameBuildPreset, release: GameReleaseConfig): BaseReleaseContext {
  const baseReleaseId = preset.baseReleaseId;
  if (!baseReleaseId) throw new Error('A delta package requires baseReleaseId.');
  const report = readGameBuildReport(project, baseReleaseId);
  if (report.status !== 'success') throw new Error(`The selected baseline did not complete successfully: ${baseReleaseId}.`);
  if (report.gameId !== release.gameId || report.channel !== release.channel || report.target !== preset.target) {
    throw new Error('The selected baseline belongs to a different game, channel, or target platform.');
  }
  if (preset.target !== 'android' && !report.architectures.includes(preset.architecture)) {
    throw new Error('The selected baseline uses a different target architecture.');
  }
  if ((report.encryptionKeyId || null) !== (preset.processing.encryptionKeyId || null)) {
    throw new Error('The selected baseline uses a different encryption key. Create a new full baseline after changing keys.');
  }
  if (preset.processing.encryptionKeyId) {
    const currentKeySha256 = readGameEncryptionKey(project, preset.processing.encryptionKeyId).summary.sha256;
    if (report.encryptionKeySha256 !== currentKeySha256) {
      throw new Error('The selected baseline uses different encryption key material. Create a new full baseline after changing keys.');
    }
  }
  const files = new Map<string, GameBuildFileManifestEntry>();
  for (const file of report.files) {
    if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error(`The selected baseline has an invalid file manifest: ${baseReleaseId}.`);
    }
    if (files.has(file.path)) throw new Error(`The selected baseline contains a duplicate file path: ${file.path}.`);
    files.set(file.path, file);
  }
  return { report, files };
}

function resolveWindowsRuntime(
  workflowRoot: string,
  project: string,
  engine: string,
  architecture: string,
): { source: 'project' | 'managed'; root: string; contentDirectory: string; runtimeVersion: string } {
  if (hasCompleteWindowsRuntime(project)) {
    assertWindowsRuntimeArchitecture(project, architecture);
    return { source: 'project', root: path.resolve(project), contentDirectory: '.', runtimeVersion: 'project-local' };
  }
  const root = path.join(path.resolve(workflowRoot), 'runtime', 'game-build', 'windows', engine, architecture);
  const manifestPath = path.join(root, 'rpg-agent-runtime.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `No complete Windows ${architecture} runtime is available. Keep the project's exported RPG Maker/NW.js runtime `
      + `(including ${WINDOWS_REQUIRED_RUNTIME_FILES.join(', ')} and a locales/*.pak file), or install a licensed managed `
      + `${engine} runtime at ${root}.`,
    );
  }
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const keys = Object.keys(value);
  const allowed = ['schemaVersion', 'engine', 'architecture', 'contentDirectory', 'runtimeVersion'];
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length || value.schemaVersion !== 1 || value.engine !== engine || value.architecture !== architecture
    || (value.contentDirectory !== '.' && value.contentDirectory !== 'www')
    || typeof value.runtimeVersion !== 'string' || !value.runtimeVersion) {
    throw new Error(`The managed Windows runtime manifest is invalid: ${manifestPath}.`);
  }
  if (!hasCompleteWindowsRuntime(root)) throw new Error(`The managed Windows runtime is incomplete: ${root}.`);
  assertWindowsRuntimeArchitecture(root, architecture);
  return {
    source: 'managed',
    root,
    contentDirectory: value.contentDirectory,
    runtimeVersion: value.runtimeVersion,
  };
}

function hasCompleteWindowsRuntime(root: string): boolean {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return false;
  if (!WINDOWS_REQUIRED_RUNTIME_FILES.every((relative) => {
    const file = path.join(root, relative);
    return fs.existsSync(file) && fs.statSync(file).isFile();
  })) return false;
  const locales = path.join(root, 'locales');
  return fs.existsSync(locales) && fs.statSync(locales).isDirectory()
    && fs.readdirSync(locales).some((name) => name.toLowerCase().endsWith('.pak'));
}

function assertWindowsRuntimeArchitecture(root: string, expected: string): void {
  const actual = inspectWindowsExecutableArchitecture(path.join(root, 'Game.exe'));
  if (actual !== expected) {
    throw new Error(`The Windows runtime executable is ${actual}, but the packaging preset requires ${expected}.`);
  }
}

function resolveDestinations(
  desiredDirectory: string,
  zip: boolean,
  conflict: GameBuildRequest['outputConflict'],
): { directory: string; zip: string | null } | null {
  const hasConflict = (base: string) => fs.existsSync(base) || (zip && fs.existsSync(`${base}.zip`));
  if (!hasConflict(desiredDirectory)) return { directory: desiredDirectory, zip: zip ? `${desiredDirectory}.zip` : null };
  if (conflict === 'cancel') return null;
  if (conflict === 'overwrite') return { directory: desiredDirectory, zip: zip ? `${desiredDirectory}.zip` : null };
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${desiredDirectory}-${index}`;
    if (!hasConflict(candidate)) return { directory: candidate, zip: zip ? `${candidate}.zip` : null };
  }
  throw new Error('Could not find an available output name.');
}

function publishArtifacts(
  stagedDirectory: string,
  stagedZip: string | null,
  destinations: { directory: string; zip: string | null },
  conflict: GameBuildRequest['outputConflict'],
): void {
  const entries = [
    { staged: stagedDirectory, destination: destinations.directory, directory: true },
    ...(stagedZip && destinations.zip ? [{ staged: stagedZip, destination: destinations.zip, directory: false }] : []),
  ];
  const backups: Array<{ destination: string; backup: string }> = [];
  const published: string[] = [];
  try {
    for (const entry of entries) {
      if (!fs.existsSync(entry.destination)) continue;
      if (conflict !== 'overwrite') throw new Error(`Build destination already exists: ${entry.destination}`);
      const backup = `${entry.destination}.previous-${crypto.randomUUID()}`;
      fs.renameSync(entry.destination, backup);
      backups.push({ destination: entry.destination, backup });
    }
    for (const entry of entries) {
      fs.mkdirSync(path.dirname(entry.destination), { recursive: true });
      fs.renameSync(entry.staged, entry.destination);
      published.push(entry.destination);
    }
    for (const backup of backups) removeExactPath(backup.backup);
  } catch (error) {
    for (const destination of published.reverse()) removeExactPath(destination);
    for (const backup of backups.reverse()) {
      if (!fs.existsSync(backup.destination) && fs.existsSync(backup.backup)) fs.renameSync(backup.backup, backup.destination);
    }
    throw error;
  }
}

function failureReport(
  project: string,
  preflight: GameBuildPreflightResult,
  releaseId: string,
  startedAt: string,
  failedStage: string,
  error: unknown,
): GameBuildReport {
  const parts = parseGameVersion(preflight.release.version);
  return {
    schemaVersion: 1,
    releaseId,
    status: 'failed',
    startedAt,
    finishedAt: new Date().toISOString(),
    gameId: preflight.release.gameId,
    gameName: readGameName(project, preflight.release.gameId),
    version: preflight.release.version,
    versionCore: [parts.major, parts.minor, parts.patch],
    suffix: parts.suffix,
    channel: preflight.release.channel,
    target: preflight.preset.target,
    architectures: architectureList(preflight.preset),
    presetId: preflight.preset.id,
    presetName: preflight.preset.name,
    packageType: preflight.preset.packageType,
    ...(preflight.preset.baseReleaseId ? { baseReleaseId: preflight.preset.baseReleaseId } : {}),
    gitCommit: readGitCommit(project),
    processing: preflight.preset.processing,
    ...(preflight.preset.processing.encryptionKeyId
      ? { encryptionKeyId: preflight.preset.processing.encryptionKeyId }
      : {}),
    ...(preflight.preset.processing.encryptionKeyId
      ? { encryptionKeySha256: readEncryptionKeySha256(project, preflight.preset.processing.encryptionKeyId) }
      : {}),
    runtime: {},
    artifacts: [],
    files: [],
    deletedFiles: [],
    warnings: preflight.warnings,
    failedStage,
    error: message(error),
  };
}

function failedBuildWithReport(
  project: string,
  preflight: GameBuildPreflightResult,
  releaseId: string,
  startedAt: string,
  failedStage: string,
  error: unknown,
): GameBuildResult {
  const reportPath = releaseReportPath(project, releaseId);
  try {
    writeJsonAtomically(reportPath, failureReport(project, preflight, releaseId, startedAt, failedStage, error));
  } catch {
    // The returned build error remains primary when the report destination is unavailable.
  }
  return failedResult(
    failedStage,
    error,
    preflight.warnings,
    releaseId,
    fs.existsSync(reportPath) ? reportPath : undefined,
  );
}

function recoverFailedPreflight(
  workflowRoot: string,
  project: string,
  request: GameBuildRequest,
  error: unknown,
): GameBuildPreflightResult {
  let settings: GameReleaseProjectSettings;
  try {
    settings = readGameBuildSettings(project);
  } catch {
    settings = createDefaultGameReleaseProjectSettings(project);
  }
  const fallbackSettings = createDefaultGameReleaseProjectSettings(project);
  const preset = settings.presets.find((candidate) => candidate.id === request.presetId)
    || settings.presets[0]
    || fallbackSettings.presets[0]!;
  let release: GameReleaseConfig;
  try {
    release = request.releaseConfig
      ? validateGameReleaseConfig(request.releaseConfig)
      : readGameReleaseStatus(workflowRoot, project).config;
  } catch {
    release = createDefaultGameReleaseConfig(project);
  }
  let outputRoot: string;
  try {
    outputRoot = resolveOutputDirectory(project, preset.outputDirectory);
  } catch {
    outputRoot = path.join(path.resolve(project), '.luna_rpg', 'builds');
  }
  return {
    ok: false,
    blockers: [message(error)],
    warnings: ['The failure report used recovered release metadata because the saved configuration could not be read.'],
    release,
    preset,
    outputPath: path.join(
      outputRoot,
      gameArtifactBaseName(readGameName(project, release.gameId), release.version, preset.target, preset.architecture),
    ),
    existingOutput: false,
    managedChanges: [],
  };
}

function failedResult(
  failedStage: string,
  error: unknown,
  warnings: string[] = [],
  releaseId?: string,
  reportPath?: string,
): GameBuildResult {
  return {
    status: 'failed',
    ...(releaseId ? { releaseId } : {}),
    ...(reportPath ? { reportPath } : {}),
    artifacts: [],
    warnings,
    failedStage,
    error: message(error),
  };
}

function requirePreset(settings: GameReleaseProjectSettings, presetId: string): GameBuildPreset {
  const preset = settings.presets.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Packaging preset does not exist: ${presetId}.`);
  return preset;
}

function readGameName(project: string, fallback: string): string {
  try {
    const layout = resolveRmmvLayout(project);
    const system = JSON.parse(fs.readFileSync(path.join(layout.dataDir, 'System.json'), 'utf8')) as Record<string, unknown>;
    const title = typeof system.gameTitle === 'string' ? system.gameTitle.trim() : '';
    return title || fallback;
  } catch {
    return fallback;
  }
}

function architectureList(preset: GameBuildPreset): string[] {
  return preset.target === 'android' ? [...(preset.android?.abis || [])] : [preset.architecture];
}

function releaseReportPath(project: string, releaseId: string): string {
  return path.join(path.resolve(project), HISTORY_DIRECTORY, `${releaseId}.json`);
}

function resolveOutputDirectory(project: string, configured: string): string {
  return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(project, configured);
}

function assertWritableDestination(outputDirectory: string): void {
  let current = path.resolve(outputDirectory);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Build output parent does not exist: ${outputDirectory}.`);
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) throw new Error(`Build output parent is not a directory: ${current}.`);
  fs.accessSync(current, fs.constants.W_OK);
}

function readGitCommit(project: string): string | null {
  try {
    const value = execFileSync('git', ['-C', path.resolve(project), 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return /^[a-f0-9]{40}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function copyRelativeFile(sourceRoot: string, targetRoot: string, relativePath: string): void {
  const source = resolveSafeRelative(sourceRoot, relativePath);
  const target = resolveSafeRelative(targetRoot, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Build file is missing: ${relativePath}.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function resolveSafeRelative(root: string, relativePath: string): string {
  const portable = relativePath.replace(/\\/g, '/');
  if (!portable || path.posix.isAbsolute(portable) || path.win32.isAbsolute(relativePath)
    || portable.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe build file path: ${relativePath}.`);
  }
  const target = path.resolve(root, ...portable.split('/'));
  if (!isInside(root, target) || target === path.resolve(root)) throw new Error(`Unsafe build file path: ${relativePath}.`);
  return target;
}

function encodePatchPath(relativePath: string): string {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function removeExactPath(target: string): void {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return;
  const stat = fs.lstatSync(resolved);
  if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(resolved, { recursive: true, force: false });
  else fs.rmSync(resolved, { force: false });
}

function cleanupStaging(stagingRoot: string): void {
  const resolved = path.resolve(stagingRoot);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readEncryptionKeySha256(project: string, keyId: string): string | undefined {
  try {
    return readGameEncryptionKey(project, keyId).summary.sha256;
  } catch {
    return undefined;
  }
}
