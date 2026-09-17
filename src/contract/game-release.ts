export const GAME_VERSION_PATTERN = /^\d+\.\d+\.\d+(?: *-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;

export type SaveCompatibilityAction = 'allow' | 'warn' | 'block' | 'callback';
export type SaveCompatibilityKind = 'legacy' | 'older' | 'same' | 'newer' | 'differentChannel';
export type GameManifestSignatureAlgorithm = 'ECDSA-P256-SHA256';

export interface GameVersionParts {
  major: string;
  minor: string;
  patch: string;
  suffix: string;
}

export interface GameReleaseUpdateConfig {
  enabled: boolean;
  indexUrl: string;
  checkOnStart: boolean;
  backgroundDownload?: boolean;
  policy: 'optional' | 'required';
  defaultLanguage?: string;
  manifestSignature?: GameManifestSignatureConfig;
}

export interface GameManifestSignatureConfig {
  enabled: boolean;
  algorithm: GameManifestSignatureAlgorithm;
  keyId: string;
  publicKey: string;
}

export interface GameSaveCompatibilityConfig {
  legacy: SaveCompatibilityAction;
  older: SaveCompatibilityAction;
  same: SaveCompatibilityAction;
  newer: SaveCompatibilityAction;
  differentChannel: SaveCompatibilityAction;
  messages?: Partial<Record<SaveCompatibilityKind, string>>;
}

export interface GameReleaseConfig {
  schemaVersion: 1;
  gameId: string;
  version: string;
  channel: string;
  update: GameReleaseUpdateConfig;
  saveCompatibility: GameSaveCompatibilityConfig;
}

export interface GameReleaseManagedChange {
  relativePath: string;
  kind: 'create' | 'update';
  description: string;
}

export interface GameReleaseStatus {
  exists: boolean;
  relativePath: string;
  config: GameReleaseConfig;
  sourceHash: string | null;
  runtimePluginsReady: boolean;
  managedChanges: GameReleaseManagedChange[];
}

export interface GameReleaseSaveRequest {
  config: GameReleaseConfig;
  expectedSourceHash?: string | null;
  installRuntimePlugins?: boolean;
}

export interface GameReleaseSaveResult extends GameReleaseStatus {
  backupDirectory?: string;
  write: unknown;
}

export interface GameReleaseUpdateIndexTestResult {
  ok: true;
  latestVersion: string | null;
  latestReleaseId: string | null;
  releaseCount: number;
  signed: boolean;
}

export type GameBuildTarget = 'web' | 'windows' | 'android';
export type GameBuildPackageType = 'full' | 'file-delta' | 'binary-diff';
export type GameContentCategory = 'images' | 'audio' | 'video' | 'data' | 'javascript' | 'ui';
export type GameContentProcessingMode = 'none' | 'compress' | 'obfuscate' | 'encrypt';
export type AndroidAbi = 'arm64-v8a' | 'armeabi-v7a' | 'x86_64';

export interface GameContentProcessingConfig {
  images: GameContentProcessingMode;
  audio: GameContentProcessingMode;
  video: GameContentProcessingMode;
  data: GameContentProcessingMode;
  javascript: GameContentProcessingMode;
  ui: GameContentProcessingMode;
  encryptionKeyId?: string;
}

export interface AndroidBuildConfig {
  applicationId: string;
  displayName: string;
  versionCode: number;
  orientation: 'landscape' | 'portrait' | 'sensor';
  minSdk: number;
  targetSdk: number;
  abis: AndroidAbi[];
  iconRelativePath: string;
  splashRelativePath?: string;
  signing: 'debug' | 'release';
  keystorePath?: string;
  keyAlias?: string;
  signingCredentialId?: string;
  newApplication?: boolean;
}

export interface GameBuildUploadConfig {
  enabled: boolean;
  adapter: 'webdav' | 'http-put';
  baseUrl: string;
  credentialId?: string;
  authorization: 'none' | 'basic' | 'bearer';
}

export interface GameBuildPreset {
  id: string;
  name: string;
  target: GameBuildTarget;
  architecture: string;
  channel: string;
  outputDirectory: string;
  zip: boolean;
  packageType: GameBuildPackageType;
  baseReleaseId?: string;
  processing: GameContentProcessingConfig;
  android?: AndroidBuildConfig;
  upload?: GameBuildUploadConfig;
}

export interface GameReleasePublicationDraftLocale {
  language: string;
  title: string;
  summary: string;
  maintenance: string;
}

export interface GameReleasePublicationDraft {
  defaultLanguage: string;
  locales: GameReleasePublicationDraftLocale[];
  required: boolean;
}

export interface GameReleaseProjectSettings {
  presets: GameBuildPreset[];
  selectedPresetId?: string;
  publicationDirectory?: string;
  androidToolchainRoot?: string;
  lastSuccessfulAndroidVersionCodes?: Record<string, number>;
  manifestSigningCredentialId?: string;
  publicationDraft?: GameReleasePublicationDraft;
}

export interface GameBuildArtifact {
  kind: 'directory' | 'zip' | 'apk' | 'manifest' | 'report' | 'delta';
  platform: GameBuildTarget;
  architecture: string;
  path: string;
  bytes: number;
  sha256: string;
  packageType: GameBuildPackageType;
  versionName?: string;
  versionCode?: number;
  certificateSha256?: string;
  applicationId?: string;
}

export interface GameBuildFileManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
  processing: GameContentProcessingMode;
  sourcePath?: string;
}

export interface GameBuildReport {
  schemaVersion: 1;
  releaseId: string;
  status: 'success' | 'failed';
  startedAt: string;
  finishedAt: string;
  gameId: string;
  gameName: string;
  version: string;
  versionCore: [string, string, string];
  suffix: string;
  channel: string;
  target: GameBuildTarget;
  architectures: string[];
  presetId: string;
  presetName: string;
  packageType: GameBuildPackageType;
  baseReleaseId?: string;
  gitCommit: string | null;
  processing: GameContentProcessingConfig;
  encryptionKeyId?: string;
  encryptionKeySha256?: string;
  runtime: Record<string, string | null>;
  artifacts: GameBuildArtifact[];
  files: GameBuildFileManifestEntry[];
  deletedFiles: string[];
  warnings: string[];
  failedStage?: string;
  error?: string;
}

export interface GameBuildPreflightResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  release: GameReleaseConfig;
  preset: GameBuildPreset;
  outputPath: string;
  existingOutput: boolean;
  managedChanges: GameReleaseManagedChange[];
}

export interface GameBuildRequest {
  operationId?: string;
  presetId: string;
  outputConflict: 'overwrite' | 'new-directory' | 'cancel';
  releaseConfig?: GameReleaseConfig;
  releaseExpectedSourceHash?: string | null;
  confirmManagedChanges?: boolean;
  uploadCredential?: {
    username?: string;
    password?: string;
    token?: string;
  };
  signingCredential?: {
    storePassword?: string;
    keyPassword?: string;
  };
  rememberSigningCredential?: boolean;
}

export type GameBuildProgressStage =
  | 'preflight'
  | 'managed-files'
  | 'prepare-output'
  | 'copy-project'
  | 'process-content'
  | 'android-apk'
  | 'create-package'
  | 'zip'
  | 'publish-output'
  | 'write-report'
  | 'complete';

export interface GameBuildProgressEvent {
  operationId: string;
  stage: GameBuildProgressStage;
  percent: number;
}

export interface GameBuildResult {
  status: 'success' | 'failed' | 'canceled';
  releaseId?: string;
  outputPath?: string;
  reportPath?: string;
  artifacts: GameBuildArtifact[];
  warnings: string[];
  failedStage?: string;
  error?: string;
}

export interface GameReleasePackageRecord {
  packageId: string;
  platform: GameBuildTarget;
  architecture: string;
  delivery: 'content' | 'apk';
  packageType: GameBuildPackageType;
  baseReleaseId?: string;
  url: string;
  bytes: number;
  sha256: string;
  packageFiles?: GameBuildFileManifestEntry[];
  deletedFiles: string[];
  targetFiles: GameBuildFileManifestEntry[];
  versionCode?: number;
  applicationId?: string;
  signingCertificateSha256?: string;
}

export interface GameReleaseRecord {
  releaseId: string;
  version: string;
  versionCore: [string, string, string];
  suffix: string;
  channel: string;
  publishedAt: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  defaultLanguage: string;
  required: boolean;
  maintenance: Record<string, string> | null;
  packages: GameReleasePackageRecord[];
}

export interface GameReleaseIndex {
  schemaVersion: 1;
  generatedAt: string;
  games: Record<string, GameReleaseGameIndex>;
}

export interface GameReleaseGameIndex {
  channels: Record<string, {
    latestReleaseId: string | null;
    maintenance: Record<string, string> | null;
    releases: GameReleaseRecord[];
  }>;
  signature?: GameReleaseManifestSignature;
}

export interface GameReleaseManifestSignature {
  schemaVersion: 1;
  algorithm: GameManifestSignatureAlgorithm;
  keyId: string;
  payloadSha256: string;
  value: string;
}

export interface GameReleaseManifestPayload {
  schemaVersion: 1;
  gameId: string;
  channels: GameReleaseGameIndex['channels'];
}

export interface GameManifestSigningIdentitySummary {
  credentialId: string;
  algorithm: GameManifestSignatureAlgorithm;
  keyId: string;
  publicKey: string;
}

export interface GameManifestSigningSaveRequest {
  releaseConfig: GameReleaseConfig;
  releaseExpectedSourceHash?: string | null;
  settings: GameReleaseProjectSettings;
}

export interface GameManifestSigningSaveResult {
  identity: GameManifestSigningIdentitySummary;
  release: GameReleaseSaveResult;
  settings: GameReleaseProjectSettings;
}

export interface GameReleasePublicationMetadata {
  defaultLanguage: string;
  title: Record<string, string>;
  summary: Record<string, string>;
  required: boolean;
  maintenance: Record<string, string> | null;
}

export interface GameReleasePublishRequest {
  releaseId: string;
  publishDirectory: string;
  metadata: GameReleasePublicationMetadata;
  updateLatest: boolean;
  upload?: GameBuildUploadConfig;
  uploadCredential?: {
    username?: string;
    password?: string;
    token?: string;
  };
  rememberUploadCredential?: boolean;
  /** Main-process-only secret, injected from OS encrypted storage. */
  manifestSigningCredential?: {
    privateKey: string;
  };
}

export interface GameReleasePublishResult {
  indexPath: string;
  releaseDirectory: string;
  record: GameReleaseRecord;
  uploadedFiles: string[];
  warnings: string[];
}

export interface AndroidToolchainStatus {
  configured: boolean;
  root: string;
  javaExecutable: string | null;
  sdkRoot: string | null;
  gradleExecutable: string | null;
  gradleLauncherJar: string | null;
  adbExecutable: string | null;
  sdkManagerExecutable: string | null;
  sdkManagerClasspathJar: string | null;
  apkSignerExecutable: string | null;
  apkSignerJar: string | null;
  aapt2Executable: string | null;
  versions: {
    jdk: string;
    commandLineTools: string;
    gradle: string;
    buildTools: string;
    compileSdk: number;
    androidGradlePlugin: string;
    webkit: string;
  };
  missing: string[];
}

export interface AndroidToolchainInstallRequest {
  root?: string;
  acceptAndroidSdkLicense: boolean;
}

export type GameReleaseCredentialKind = 'android-signing' | 'upload' | 'manifest-signing';

export interface GameReleaseCredentialStatus {
  available: boolean;
  exists: boolean;
  kind?: GameReleaseCredentialKind;
  credentialId?: string;
}

export interface AndroidKeystoreCreateRequest {
  alias: string;
  storePassword: string;
  keyPassword: string;
  commonName: string;
}

export interface AndroidKeystoreCreateResult {
  path: string;
  alias: string;
  certificateSha256: string;
}

export interface GameEncryptionKeySummary {
  id: string;
  algorithm: 'AES-256-GCM';
  createdAt: string;
  sha256: string;
}
