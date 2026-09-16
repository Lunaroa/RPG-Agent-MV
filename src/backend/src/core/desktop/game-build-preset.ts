import crypto from 'node:crypto';
import path from 'node:path';

import type {
  AndroidAbi,
  AndroidBuildConfig,
  GameBuildPreset,
  GameBuildUploadConfig,
  GameContentCategory,
  GameContentProcessingConfig,
  GameContentProcessingMode,
  GameReleaseProjectSettings,
} from '../../../../contract/game-release.ts';

const TARGETS = new Set(['web', 'windows', 'android']);
const PACKAGE_TYPES = new Set(['full', 'file-delta', 'binary-diff']);
const PROCESSING_MODES = new Set<GameContentProcessingMode>(['none', 'compress', 'obfuscate', 'encrypt']);
const CONTENT_CATEGORIES: GameContentCategory[] = ['images', 'audio', 'video', 'data', 'javascript', 'ui'];
const ANDROID_ABIS = new Set<AndroidAbi>(['arm64-v8a', 'armeabi-v7a', 'x86_64']);

export function createDefaultGameReleaseProjectSettings(project: string): GameReleaseProjectSettings {
  const outputDirectory = path.join(path.resolve(project), '.luna_rpg', 'builds');
  const publicationDirectory = path.join(path.resolve(project), '.luna_rpg', 'published');
  const preset: GameBuildPreset = {
    id: crypto.randomUUID(),
    name: 'Web',
    target: 'web',
    architecture: 'web',
    channel: 'stable',
    outputDirectory,
    zip: false,
    packageType: 'full',
    processing: defaultProcessing(),
  };
  return { presets: [preset], selectedPresetId: preset.id, publicationDirectory };
}

export function validateGameReleaseProjectSettings(value: unknown): GameReleaseProjectSettings {
  const root = requireRecord(value, 'release settings');
  assertExactKeys(root, [
    'presets', 'selectedPresetId', 'publicationDirectory', 'androidToolchainRoot', 'lastSuccessfulAndroidVersionCodes',
    'manifestSigningCredentialId',
  ], 'release settings');
  if (!Array.isArray(root.presets)) throw new Error('release.presets must be an array.');
  const presets = root.presets.map((preset, index) => validateGameBuildPreset(preset, index));
  const ids = presets.map((preset) => preset.id);
  if (new Set(ids).size !== ids.length) throw new Error('Each packaging preset must have a unique id.');
  const selectedPresetId = root.selectedPresetId === undefined
    ? undefined
    : requireString(root.selectedPresetId, 'release.selectedPresetId', 128);
  if (selectedPresetId && !ids.includes(selectedPresetId)) {
    throw new Error('release.selectedPresetId must identify an existing preset.');
  }
  const androidToolchainRoot = root.androidToolchainRoot === undefined
    ? undefined
    : requireString(root.androidToolchainRoot, 'release.androidToolchainRoot', 4096);
  const publicationDirectory = root.publicationDirectory === undefined
    ? undefined
    : requireNonEmptyString(root.publicationDirectory, 'release.publicationDirectory', 4096);
  const lastSuccessfulAndroidVersionCodes = root.lastSuccessfulAndroidVersionCodes === undefined
    ? undefined
    : validateVersionCodeHistory(root.lastSuccessfulAndroidVersionCodes);
  const manifestSigningCredentialId = root.manifestSigningCredentialId === undefined
    ? undefined
    : requireStableId(root.manifestSigningCredentialId, 'release.manifestSigningCredentialId', 128);
  return {
    presets,
    ...(selectedPresetId ? { selectedPresetId } : {}),
    ...(publicationDirectory ? { publicationDirectory } : {}),
    ...(androidToolchainRoot ? { androidToolchainRoot } : {}),
    ...(lastSuccessfulAndroidVersionCodes ? { lastSuccessfulAndroidVersionCodes } : {}),
    ...(manifestSigningCredentialId ? { manifestSigningCredentialId } : {}),
  };
}

export function validateGameBuildPreset(value: unknown, index = 0): GameBuildPreset {
  const label = `release.presets[${index}]`;
  const raw = requireRecord(value, label);
  assertExactKeys(raw, [
    'id', 'name', 'target', 'architecture', 'channel', 'outputDirectory', 'zip', 'packageType',
    'baseReleaseId', 'processing', 'android', 'upload',
  ], label);
  const id = requireStableId(raw.id, `${label}.id`, 128);
  const name = requireNonEmptyString(raw.name, `${label}.name`, 120);
  if (typeof raw.target !== 'string' || !TARGETS.has(raw.target)) throw new Error(`${label}.target is invalid.`);
  const target = raw.target as GameBuildPreset['target'];
  const architecture = requireStableId(raw.architecture, `${label}.architecture`, 64);
  if (target === 'web' && architecture !== 'web') throw new Error(`${label}.architecture must be web for Web builds.`);
  if (target === 'windows' && !['x64', 'x86', 'arm64'].includes(architecture)) {
    throw new Error(`${label}.architecture must be x64, x86, or arm64 for Windows builds.`);
  }
  if (target === 'android' && architecture !== 'per-abi') {
    throw new Error(`${label}.architecture must be per-abi for Android builds.`);
  }
  const channel = requireStableId(raw.channel, `${label}.channel`, 64);
  const outputDirectory = requireNonEmptyString(raw.outputDirectory, `${label}.outputDirectory`, 4096);
  if (typeof raw.zip !== 'boolean') throw new Error(`${label}.zip must be true or false.`);
  if (typeof raw.packageType !== 'string' || !PACKAGE_TYPES.has(raw.packageType)) {
    throw new Error(`${label}.packageType is invalid.`);
  }
  const packageType = raw.packageType as GameBuildPreset['packageType'];
  const baseReleaseId = raw.baseReleaseId === undefined
    ? undefined
    : requireStableId(raw.baseReleaseId, `${label}.baseReleaseId`, 128);
  if (packageType !== 'full' && !baseReleaseId) {
    throw new Error(`${label}.baseReleaseId is required for delta packages.`);
  }
  if (packageType === 'full' && baseReleaseId) {
    throw new Error(`${label}.baseReleaseId is only valid for delta packages.`);
  }
  const processing = validateProcessing(raw.processing, `${label}.processing`);
  const android = raw.android === undefined ? undefined : validateAndroid(raw.android, `${label}.android`);
  if (target === 'android' && !android) throw new Error(`${label}.android is required for Android builds.`);
  if (target !== 'android' && android) throw new Error(`${label}.android is only valid for Android builds.`);
  const upload = raw.upload === undefined ? undefined : validateUpload(raw.upload, `${label}.upload`);
  return {
    id,
    name,
    target,
    architecture,
    channel,
    outputDirectory,
    zip: raw.zip,
    packageType,
    ...(baseReleaseId ? { baseReleaseId } : {}),
    processing,
    ...(android ? { android } : {}),
    ...(upload ? { upload } : {}),
  };
}

export function defaultProcessing(): GameContentProcessingConfig {
  return { images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none' };
}

function validateProcessing(value: unknown, label: string): GameContentProcessingConfig {
  const raw = requireRecord(value, label);
  assertExactKeys(raw, [...CONTENT_CATEGORIES, 'encryptionKeyId'], label);
  const result = Object.fromEntries(CONTENT_CATEGORIES.map((category) => {
    const mode = raw[category];
    if (typeof mode !== 'string' || !PROCESSING_MODES.has(mode as GameContentProcessingMode)) {
      throw new Error(`${label}.${category} has an invalid processing mode.`);
    }
    return [category, mode];
  })) as unknown as GameContentProcessingConfig;
  const encryptionKeyId = raw.encryptionKeyId === undefined
    ? undefined
    : requireStableId(raw.encryptionKeyId, `${label}.encryptionKeyId`, 128);
  const usesEncryption = CONTENT_CATEGORIES.some((category) => result[category] === 'encrypt');
  if (usesEncryption && !encryptionKeyId) throw new Error(`${label}.encryptionKeyId is required when encryption is enabled.`);
  if (!usesEncryption && encryptionKeyId) throw new Error(`${label}.encryptionKeyId is only valid when encryption is enabled.`);
  return { ...result, ...(encryptionKeyId ? { encryptionKeyId } : {}) };
}

function validateAndroid(value: unknown, label: string): AndroidBuildConfig {
  const raw = requireRecord(value, label);
  assertExactKeys(raw, [
    'applicationId', 'displayName', 'versionCode', 'orientation', 'minSdk', 'targetSdk', 'abis',
    'iconRelativePath', 'splashRelativePath', 'signing', 'keystorePath', 'keyAlias',
    'signingCredentialId', 'newApplication',
  ], label);
  const applicationId = requireString(raw.applicationId, `${label}.applicationId`, 255);
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(applicationId)) {
    throw new Error(`${label}.applicationId must be a lowercase reverse-domain Android application id.`);
  }
  const displayName = requireNonEmptyString(raw.displayName, `${label}.displayName`, 80);
  const versionCode = requireInteger(raw.versionCode, `${label}.versionCode`, 1, 2_100_000_000);
  if (!['landscape', 'portrait', 'sensor'].includes(String(raw.orientation))) {
    throw new Error(`${label}.orientation is invalid.`);
  }
  const orientation = raw.orientation as AndroidBuildConfig['orientation'];
  const minSdk = requireInteger(raw.minSdk, `${label}.minSdk`, 21, 100);
  const targetSdk = requireInteger(raw.targetSdk, `${label}.targetSdk`, minSdk, 100);
  if (!Array.isArray(raw.abis) || raw.abis.length === 0) throw new Error(`${label}.abis must select at least one ABI.`);
  const abis = raw.abis.map((abi, abiIndex) => {
    if (typeof abi !== 'string' || !ANDROID_ABIS.has(abi as AndroidAbi)) {
      throw new Error(`${label}.abis[${abiIndex}] is unsupported.`);
    }
    return abi as AndroidAbi;
  });
  if (new Set(abis).size !== abis.length) throw new Error(`${label}.abis contains duplicates.`);
  const iconRelativePath = requireSafeRelativePath(raw.iconRelativePath, `${label}.iconRelativePath`);
  const splashRelativePath = raw.splashRelativePath === undefined
    ? undefined
    : requireSafeRelativePath(raw.splashRelativePath, `${label}.splashRelativePath`);
  if (raw.signing !== 'debug' && raw.signing !== 'release') throw new Error(`${label}.signing must be debug or release.`);
  const signing = raw.signing;
  const keystorePath = raw.keystorePath === undefined ? undefined : requireNonEmptyString(raw.keystorePath, `${label}.keystorePath`, 4096);
  const keyAlias = raw.keyAlias === undefined ? undefined : requireNonEmptyString(raw.keyAlias, `${label}.keyAlias`, 255);
  const signingCredentialId = raw.signingCredentialId === undefined
    ? undefined
    : requireStableId(raw.signingCredentialId, `${label}.signingCredentialId`, 128);
  if (signing === 'release' && (!keystorePath || !keyAlias || !signingCredentialId)) {
    throw new Error(`${label} release signing requires keystorePath, keyAlias, and signingCredentialId.`);
  }
  if (raw.newApplication !== undefined && typeof raw.newApplication !== 'boolean') {
    throw new Error(`${label}.newApplication must be true or false.`);
  }
  return {
    applicationId,
    displayName,
    versionCode,
    orientation,
    minSdk,
    targetSdk,
    abis,
    iconRelativePath,
    ...(splashRelativePath ? { splashRelativePath } : {}),
    signing,
    ...(keystorePath ? { keystorePath } : {}),
    ...(keyAlias ? { keyAlias } : {}),
    ...(signingCredentialId ? { signingCredentialId } : {}),
    ...(raw.newApplication !== undefined ? { newApplication: raw.newApplication } : {}),
  };
}

function validateUpload(value: unknown, label: string): GameBuildUploadConfig {
  const raw = requireRecord(value, label);
  assertExactKeys(raw, ['enabled', 'adapter', 'baseUrl', 'credentialId', 'authorization'], label);
  if (typeof raw.enabled !== 'boolean') throw new Error(`${label}.enabled must be true or false.`);
  if (raw.adapter !== 'webdav' && raw.adapter !== 'http-put') throw new Error(`${label}.adapter is invalid.`);
  const baseUrl = requireString(raw.baseUrl, `${label}.baseUrl`, 2048);
  if (baseUrl) requireHttpUrl(baseUrl, `${label}.baseUrl`);
  if (raw.enabled && !baseUrl) throw new Error(`${label}.baseUrl is required when upload is enabled.`);
  if (!['none', 'basic', 'bearer'].includes(String(raw.authorization))) {
    throw new Error(`${label}.authorization is invalid.`);
  }
  const authorization = raw.authorization as GameBuildUploadConfig['authorization'];
  const credentialId = raw.credentialId === undefined
    ? undefined
    : requireStableId(raw.credentialId, `${label}.credentialId`, 128);
  if (raw.enabled && authorization !== 'none' && !credentialId) {
    throw new Error(`${label}.credentialId is required for authenticated upload.`);
  }
  return {
    enabled: raw.enabled,
    adapter: raw.adapter,
    baseUrl,
    ...(credentialId ? { credentialId } : {}),
    authorization,
  };
}

function validateVersionCodeHistory(value: unknown): Record<string, number> {
  const raw = requireRecord(value, 'release.lastSuccessfulAndroidVersionCodes');
  const result: Record<string, number> = {};
  for (const [key, versionCode] of Object.entries(raw)) {
    requireStableId(key, `release.lastSuccessfulAndroidVersionCodes key ${key}`, 255);
    result[key] = requireInteger(versionCode, `release.lastSuccessfulAndroidVersionCodes.${key}`, 1, 2_100_000_000);
  }
  return result;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}.`);
}

function requireString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (value.length > maximumLength) throw new Error(`${label} must not exceed ${maximumLength} characters.`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string, maximumLength: number): string {
  const text = requireString(value, label, maximumLength).trim();
  if (!text) throw new Error(`${label} must not be empty.`);
  return text;
}

function requireStableId(value: unknown, label: string, maximumLength: number): string {
  const text = requireString(value, label, maximumLength);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(text)) {
    throw new Error(`${label} must contain only ASCII letters, digits, dots, underscores, or hyphens.`);
  }
  return text;
}

function requireSafeRelativePath(value: unknown, label: string): string {
  const text = requireNonEmptyString(value, label, 1024).replace(/\\/g, '/');
  if (path.posix.isAbsolute(text) || path.win32.isAbsolute(text) || text.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be a relative path inside the game project.`);
  }
  return text;
}

function requireInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function requireHttpUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${label} must use HTTP or HTTPS.`);
}
