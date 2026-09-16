import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  GameBuildArtifact,
  GameBuildReport,
  GameManifestSignatureConfig,
  GameReleaseIndex,
  GameReleasePackageRecord,
  GameReleasePublicationMetadata,
  GameReleasePublishRequest,
  GameReleasePublishResult,
  GameReleaseRecord,
} from '../../../../contract/game-release.ts';
import {
  collectDirectoryDigest,
  copyGameDirectory,
  isInside,
  sha256File,
  writeJsonAtomically,
} from './game-build-file-service.ts';
import { readGameBuildReport } from './game-build-service.ts';
import {
  signGameReleaseManifest,
  validateGameManifestSignatureConfig,
  verifyGameReleaseManifestSignature,
} from './game-manifest-signing-service.ts';
import { uploadStaticRelease } from './game-release-upload-service.ts';
import { isWindowsPlatformRuntimePath } from './game-windows-runtime-contract.ts';

const INDEX_FILE = 'releases.json';

export async function publishGameRelease(
  project: string,
  value: GameReleasePublishRequest,
): Promise<GameReleasePublishResult> {
  const request = validatePublishRequest(value);
  const metadata = validatePublicationMetadata(request.metadata);
  const report = readGameBuildReport(project, request.releaseId);
  if (report.status !== 'success') throw new Error('Only a successful build can be published.');
  const manifestSignature = manifestSignatureFromReport(report);
  const publishRoot = resolvePublishRoot(project, request.publishDirectory);
  fs.mkdirSync(publishRoot, { recursive: true });
  const gameId = requirePathSegment(report.gameId, 'gameId');
  const channelName = requirePathSegment(report.channel, 'channel');
  const releaseId = requirePathSegment(report.releaseId, 'releaseId');
  const releaseRelativeDirectory = `games/${gameId}/${channelName}/${releaseId}`;
  const releaseDirectory = path.join(publishRoot, ...releaseRelativeDirectory.split('/'));
  const artifacts = selectPublishArtifacts(report.artifacts);
  if (!artifacts.length) throw new Error('The build report has no publishable package artifact.');

  const indexPath = path.join(publishRoot, INDEX_FILE);
  const index = readIndex(indexPath);
  const existingRecord = index.games[gameId]?.channels[channelName]?.releases
    .find((release) => release.releaseId === releaseId);
  if (existingRecord || fs.existsSync(releaseDirectory)) {
    if (!existingRecord || !fs.existsSync(releaseDirectory) || !fs.statSync(releaseDirectory).isDirectory()) {
      throw new Error(`The local publication for ${releaseId} is incomplete. Inspect the publish directory before retrying.`);
    }
    assertRetryMatches(existingRecord, report, metadata);
    const signatureChanged = applyGameManifestSignature(index, gameId, manifestSignature, request);
    if (signatureChanged) writeJsonAtomically(indexPath, index);
    return uploadExistingPublication(
      publishRoot,
      releaseDirectory,
      existingRecord,
      request,
      manifestSignature === null,
    );
  }

  const staging = `${releaseDirectory}.staging-${crypto.randomUUID()}`;
  const packageRecords: GameReleasePackageRecord[] = [];
  const publishedRelativeFiles: string[] = [];
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const artifact of artifacts) {
      const destinationName = path.basename(artifact.path);
      const destination = path.join(staging, destinationName);
      const directoryArtifact = isArtifactDirectory(artifact);
      let packageFiles: GameReleasePackageRecord['packageFiles'];
      let packageBytes = artifact.bytes;
      let packageSha256 = artifact.sha256;
      if (directoryArtifact) {
        copyGameDirectory(artifact.path, destination);
        const copiedDigest = collectDirectoryDigest(destination);
        if (copiedDigest.sha256 !== artifact.sha256) throw new Error(`Build directory changed after it was recorded: ${artifact.path}.`);
        if (artifact.platform === 'windows') stripWindowsPlatformRuntime(destination, copiedDigest.files.map((file) => file.path));
        const publishedDigest = collectDirectoryDigest(destination);
        packageBytes = publishedDigest.bytes;
        packageSha256 = publishedDigest.sha256;
        packageFiles = publishedDigest.files;
        for (const file of publishedDigest.files) publishedRelativeFiles.push(`${releaseRelativeDirectory}/${destinationName}/${file.path}`);
      } else {
        assertArtifactFile(artifact);
        fs.copyFileSync(artifact.path, destination);
        publishedRelativeFiles.push(`${releaseRelativeDirectory}/${destinationName}`);
      }
      packageRecords.push({
        packageId: crypto.randomUUID(),
        platform: artifact.platform,
        architecture: artifact.architecture,
        delivery: artifact.kind === 'apk' ? 'apk' : 'content',
        packageType: artifact.packageType,
        ...(artifact.packageType !== 'full' && report.baseReleaseId ? { baseReleaseId: report.baseReleaseId } : {}),
        url: `${releaseRelativeDirectory}/${destinationName}${directoryArtifact ? '/' : ''}`,
        bytes: packageBytes,
        sha256: packageSha256,
        ...(packageFiles ? { packageFiles } : {}),
        deletedFiles: artifact.platform === 'windows'
          ? report.deletedFiles.filter((file) => !isWindowsPlatformRuntimePath(file))
          : report.deletedFiles,
        targetFiles: artifact.platform === 'windows'
          ? report.files.filter((file) => !isWindowsPlatformRuntimePath(file.path))
          : report.files,
        ...(artifact.versionCode ? { versionCode: artifact.versionCode } : {}),
        ...(artifact.applicationId ? { applicationId: artifact.applicationId } : {}),
        ...(artifact.certificateSha256 ? { signingCertificateSha256: artifact.certificateSha256 } : {}),
      });
    }
    fs.mkdirSync(path.dirname(releaseDirectory), { recursive: true });
    fs.renameSync(staging, releaseDirectory);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const record: GameReleaseRecord = {
    releaseId: report.releaseId,
    version: report.version,
    versionCore: report.versionCore,
    suffix: report.suffix,
    channel: report.channel,
    publishedAt: new Date().toISOString(),
    title: metadata.title,
    summary: metadata.summary,
    defaultLanguage: metadata.defaultLanguage,
    required: metadata.required,
    maintenance: metadata.maintenance,
    packages: packageRecords,
  };
  try {
    const game = index.games[gameId] ||= { channels: {} };
    const channel = game.channels[channelName] ||= { latestReleaseId: null, maintenance: null, releases: [] };
    channel.releases.push(record);
    channel.maintenance = metadata.maintenance;
    if (request.updateLatest || !channel.latestReleaseId) channel.latestReleaseId = releaseId;
    applyGameManifestSignature(index, gameId, manifestSignature, request);
    index.generatedAt = new Date().toISOString();
    writeJsonAtomically(indexPath, index);
  } catch (error) {
    if (fs.existsSync(releaseDirectory)) fs.rmSync(releaseDirectory, { recursive: true, force: false });
    throw error;
  }

  const warnings: string[] = [];
  if (!manifestSignature) warnings.push(unsignedManifestWarning());
  let uploadedFiles: string[] = [];
  if (request.upload?.enabled) {
    if (request.upload.baseUrl.startsWith('http:')) {
      warnings.push('The update server uses HTTP. Upload credentials and downloads are not protected in transit.');
    }
    try {
      uploadedFiles = await uploadStaticRelease(
        publishRoot,
        publishedRelativeFiles,
        INDEX_FILE,
        request.upload,
        request.uploadCredential,
      );
    } catch (error) {
      throw new Error(
        `The local publication is complete at ${releaseDirectory}, but upload failed. Retry the same release after fixing the connection: ${message(error)}`,
      );
    }
  }
  return { indexPath, releaseDirectory, record, uploadedFiles, warnings };
}

async function uploadExistingPublication(
  publishRoot: string,
  releaseDirectory: string,
  record: GameReleaseRecord,
  request: GameReleasePublishRequest,
  unsignedManifest: boolean,
): Promise<GameReleasePublishResult> {
  const warnings: string[] = [];
  if (unsignedManifest) warnings.push(unsignedManifestWarning());
  let uploadedFiles: string[] = [];
  if (request.upload?.enabled) {
    if (request.upload.baseUrl.startsWith('http:')) {
      warnings.push('The update server uses HTTP. Upload credentials and downloads are not protected in transit.');
    }
    const files = listPublicationFiles(publishRoot, releaseDirectory);
    try {
      uploadedFiles = await uploadStaticRelease(
        publishRoot,
        files,
        INDEX_FILE,
        request.upload,
        request.uploadCredential,
      );
    } catch (error) {
      throw new Error(
        `The local publication is complete at ${releaseDirectory}, but upload failed. Retry after fixing the connection: ${message(error)}`,
      );
    }
  }
  return {
    indexPath: path.join(publishRoot, INDEX_FILE),
    releaseDirectory,
    record,
    uploadedFiles,
    warnings,
  };
}

function manifestSignatureFromReport(report: GameBuildReport): GameManifestSignatureConfig | null {
  const algorithm = report.runtime?.manifestSignatureAlgorithm;
  const keyId = report.runtime?.manifestSignatureKeyId;
  const publicKey = report.runtime?.manifestSignaturePublicKey;
  if (algorithm === null && keyId === null && publicKey === null) return null;
  if (algorithm === undefined && keyId === undefined && publicKey === undefined) return null;
  if (typeof algorithm !== 'string' || typeof keyId !== 'string' || typeof publicKey !== 'string') {
    throw new Error('The build report contains an incomplete manifest signing identity.');
  }
  return validateGameManifestSignatureConfig({ enabled: true, algorithm, keyId, publicKey });
}

function applyGameManifestSignature(
  index: GameReleaseIndex,
  gameId: string,
  config: GameManifestSignatureConfig | null,
  request: GameReleasePublishRequest,
): boolean {
  const game = index.games[gameId];
  if (!game) throw new Error(`The release index does not contain game ${gameId}.`);
  if (!config) {
    if (game.signature) {
      throw new Error('This game release index is already signed. Publish with the matching manifest signing identity instead of removing its trust chain.');
    }
    return false;
  }
  if (game.signature && verifyGameReleaseManifestSignature(gameId, game, config)) return false;
  const privateKey = request.manifestSigningCredential?.privateKey;
  if (!privateKey) {
    throw new Error('This build requires its manifest signing private key, but the local secure credential is unavailable.');
  }
  game.signature = signGameReleaseManifest(gameId, game, config, privateKey);
  return true;
}

function unsignedManifestWarning(): string {
  return 'The release manifest is unsigned. SHA-256 detects corruption but cannot prove that the server content came from the developer.';
}

function assertRetryMatches(
  record: GameReleaseRecord,
  report: ReturnType<typeof readGameBuildReport>,
  metadata: GameReleasePublicationMetadata,
): void {
  if (record.version !== report.version || record.channel !== report.channel
    || record.defaultLanguage !== metadata.defaultLanguage || record.required !== metadata.required
    || JSON.stringify(record.title) !== JSON.stringify(metadata.title)
    || JSON.stringify(record.summary) !== JSON.stringify(metadata.summary)
    || JSON.stringify(record.maintenance) !== JSON.stringify(metadata.maintenance)) {
    throw new Error(`Release ${report.releaseId} is already published with different metadata or build content.`);
  }
}

function listPublicationFiles(publishRoot: string, releaseDirectory: string): string[] {
  const files: string[] = [];
  visit(releaseDirectory);
  return files.sort((left, right) => left.localeCompare(right, 'en'));

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Published release contains a symbolic link: ${absolute}.`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(publishRoot, absolute).replace(/\\/g, '/'));
      else throw new Error(`Published release contains an unsupported filesystem entry: ${absolute}.`);
    }
  }
}

function selectPublishArtifacts(artifacts: GameBuildArtifact[]): GameBuildArtifact[] {
  const apks = artifacts.filter((artifact) => artifact.kind === 'apk');
  if (apks.length) {
    const content = artifacts.filter((artifact) => (
      artifact.platform === 'android' && (artifact.kind === 'directory' || artifact.kind === 'delta')
    ));
    return [...content, ...apks];
  }
  const windowsDirectories = artifacts.filter((artifact) => (
    artifact.platform === 'windows' && (artifact.kind === 'directory' || artifact.kind === 'delta')
  ));
  if (windowsDirectories.length) return windowsDirectories;
  const zips = artifacts.filter((artifact) => artifact.kind === 'zip');
  if (zips.length) return zips;
  return artifacts.filter((artifact) => artifact.kind === 'directory' || artifact.kind === 'delta');
}

function stripWindowsPlatformRuntime(directory: string, relativePaths: string[]): void {
  for (const relativePath of relativePaths) {
    if (!isWindowsPlatformRuntimePath(relativePath)) continue;
    const target = path.join(directory, ...relativePath.split('/'));
    if (fs.existsSync(target)) fs.rmSync(target, { force: false });
  }
  removeEmptyDirectories(directory);
}

function removeEmptyDirectories(directory: string): boolean {
  let empty = true;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (removeEmptyDirectories(target)) fs.rmdirSync(target);
      else empty = false;
    } else {
      empty = false;
    }
  }
  return empty;
}

function assertArtifactFile(artifact: GameBuildArtifact): void {
  if (!fs.existsSync(artifact.path) || !fs.statSync(artifact.path).isFile()) {
    throw new Error(`Build artifact no longer exists: ${artifact.path}.`);
  }
  if (fs.statSync(artifact.path).size !== artifact.bytes || sha256File(artifact.path) !== artifact.sha256) {
    throw new Error(`Build artifact changed after it was recorded: ${artifact.path}.`);
  }
}

function isArtifactDirectory(artifact: GameBuildArtifact): boolean {
  if (!fs.existsSync(artifact.path)) throw new Error(`Build artifact no longer exists: ${artifact.path}.`);
  const stat = fs.lstatSync(artifact.path);
  if (stat.isSymbolicLink()) throw new Error(`Build artifact must not be a symbolic link: ${artifact.path}.`);
  return stat.isDirectory();
}

function readIndex(file: string): GameReleaseIndex {
  if (!fs.existsSync(file)) return { schemaVersion: 1, generatedAt: new Date(0).toISOString(), games: {} };
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as GameReleaseIndex;
  if (!value || value.schemaVersion !== 1 || typeof value.generatedAt !== 'string'
    || !value.games || typeof value.games !== 'object' || Array.isArray(value.games)) {
    throw new Error('The existing release index has an unsupported format.');
  }
  return value;
}

function validatePublishRequest(value: GameReleasePublishRequest): GameReleasePublishRequest {
  if (!value || typeof value !== 'object') throw new Error('Publish request is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(value.releaseId || ''))) throw new Error('Publish releaseId is invalid.');
  if (typeof value.publishDirectory !== 'string' || !value.publishDirectory.trim()) throw new Error('Publish directory is required.');
  if (typeof value.updateLatest !== 'boolean') throw new Error('updateLatest must be true or false.');
  validatePublicationMetadata(value.metadata);
  return structuredClone(value);
}

function validatePublicationMetadata(value: GameReleasePublicationMetadata): GameReleasePublicationMetadata {
  if (!value || typeof value !== 'object') throw new Error('Release publication metadata is required.');
  const defaultLanguage = requireLanguage(value.defaultLanguage, 'defaultLanguage');
  const title = validateLocalizedText(value.title, 'title', 200);
  const summary = validateLocalizedText(value.summary, 'summary', 4000);
  const maintenance = value.maintenance === null ? null : validateLocalizedText(value.maintenance, 'maintenance', 4000);
  if (!title[defaultLanguage] || !summary[defaultLanguage]) {
    throw new Error('Release title and summary must include the selected default language.');
  }
  if (typeof value.required !== 'boolean') throw new Error('Release required flag must be true or false.');
  return { defaultLanguage, title, summary, required: value.required, maintenance };
}

function validateLocalizedText(value: Record<string, string>, label: string, maximum: number): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a language-to-text object.`);
  const result: Record<string, string> = {};
  for (const [language, text] of Object.entries(value)) {
    const normalizedLanguage = requireLanguage(language, `${label} language`);
    if (typeof text !== 'string' || !text.trim() || text.length > maximum) {
      throw new Error(`${label}.${normalizedLanguage} must contain 1 to ${maximum} characters.`);
    }
    result[normalizedLanguage] = text.trim();
  }
  if (!Object.keys(result).length) throw new Error(`${label} must contain at least one language.`);
  return result;
}

function requireLanguage(value: string, label: string): string {
  const language = String(value || '').trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new Error(`${label} is not a valid language tag.`);
  return language;
}

function requirePathSegment(value: string, label: string): string {
  const segment = String(value || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(segment)) {
    throw new Error(`${label} cannot be used in a release path.`);
  }
  return segment;
}

function resolvePublishRoot(project: string, configured: string): string {
  const root = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(project, configured);
  const projectRoot = fs.realpathSync.native(path.resolve(project));
  if (isInside(projectRoot, root) && !isInside(path.join(projectRoot, '.luna_rpg'), root)) {
    throw new Error('A publish directory inside the game project must be under .luna_rpg.');
  }
  return root;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
