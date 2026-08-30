import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  UiDesignerDocument,
  UiDesignerGlobalDataReadResult,
  UiDesignerGlobalDataValue,
  UiDesignerSceneFileRecord,
  UiFileResult,
} from '../../../../contract/ui-designer.ts';
import { normalizeUiDesignerPaneSize } from '../../../../contract/ui-designer-geometry.ts';
import {
  assertValidUiDesignerDocument,
  UiDesignerValidationError,
} from './ui-designer-validation.ts';
import { lunaRpgDirPath } from './project-config-service.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';

export const UI_DESIGNER_FILE_EXTENSION = '.mzui';
export const UI_DESIGNER_RECENT_LIMIT = 10;

const UI_SCENE_NAME_PATTERN = /^Scene_[A-Za-z0-9_$]+$/;
const UI_DESIGNER_PROJECT_DIRECTORY = 'ui-designer';
export const UI_DESIGNER_SCENE_DIRECTORY = 'ui-scenes';
const UI_DESIGNER_LEGACY_SCENE_DIRECTORY = 'scenes';
const UI_DESIGNER_THUMBNAIL_DIRECTORY = 'thumbnails';
const UI_DESIGNER_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const UI_DESIGNER_SCENE_MIGRATION_MARKER = 'project-scenes-v1.migrated.json';
const UI_DESIGNER_GLOBAL_DATA_MIGRATION_MARKER = 'global-data-v1.migrated.json';

export function projectUiDesignerSceneDirectory(projectRoot: string): string {
  return path.join(resolveRmmvLayout(projectRoot).dataDir, UI_DESIGNER_SCENE_DIRECTORY);
}

function legacyProjectUiDesignerSceneDirectory(projectRoot: string): string {
  return path.join(lunaRpgDirPath(projectRoot), UI_DESIGNER_PROJECT_DIRECTORY, UI_DESIGNER_LEGACY_SCENE_DIRECTORY);
}

export function projectUiDesignerThumbnailDirectory(projectRoot: string): string {
  return path.join(lunaRpgDirPath(projectRoot), UI_DESIGNER_PROJECT_DIRECTORY, UI_DESIGNER_THUMBNAIL_DIRECTORY);
}

export function projectUiDesignerScenePath(projectRoot: string, sceneName: string): string {
  if (!UI_SCENE_NAME_PATTERN.test(sceneName)) throw new Error(`UI designer scene name is invalid: ${sceneName}`);
  return path.join(projectUiDesignerSceneDirectory(projectRoot), `${sceneName}${UI_DESIGNER_FILE_EXTENSION}`);
}

export const UI_DESIGNER_GLOBAL_DATA_FILENAME = 'global-ui.json';

export function projectUiDesignerGlobalDataPath(projectRoot: string): string {
  return path.join(resolveRmmvLayout(projectRoot).dataDir, 'GlobalUI.json');
}

function legacyProjectUiDesignerGlobalDataPath(projectRoot: string): string {
  return path.join(lunaRpgDirPath(projectRoot), UI_DESIGNER_PROJECT_DIRECTORY, UI_DESIGNER_GLOBAL_DATA_FILENAME);
}

function uiDesignerMigrationMarkerPath(projectRoot: string, name: string): string {
  return path.join(lunaRpgDirPath(projectRoot), UI_DESIGNER_PROJECT_DIRECTORY, name);
}

function migrationCompleted(markerPath: string, operation: string): boolean {
  if (!fs.existsSync(markerPath)) return false;
  const stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UiDesignerPersistenceError(operation, 'The UI designer migration marker is not a safe file.');
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { version?: unknown };
    if (parsed.version !== 1) throw new Error('Unsupported marker version.');
    return true;
  } catch (error) {
    throw new UiDesignerPersistenceError(operation, 'The UI designer migration marker is invalid.', error);
  }
}

function markMigrationCompleted(markerPath: string): void {
  writeFileAtomically(markerPath, Buffer.from(`${JSON.stringify({ version: 1 }, null, 2)}\n`, 'utf8'));
}

export interface UiDesignerProjectSceneMigrationResult {
  copied: string[];
}

/**
 * Copy project-owned legacy scene sources into the Runtime-readable data
 * directory. The legacy files stay untouched and are no longer scanned after
 * this succeeds.
 */
export function migrateLegacyProjectUiDesignerScenes(projectRoot: string): UiDesignerProjectSceneMigrationResult {
  const sourceDirectory = legacyProjectUiDesignerSceneDirectory(projectRoot);
  const targetDirectory = projectUiDesignerSceneDirectory(projectRoot);
  if (!fs.existsSync(sourceDirectory)) return { copied: [] };
  const marker = uiDesignerMigrationMarkerPath(projectRoot, UI_DESIGNER_SCENE_MIGRATION_MARKER);
  if (migrationCompleted(marker, 'migrate-project-scenes')) return { copied: [] };
  const sourceStat = fs.lstatSync(sourceDirectory);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new UiDesignerPersistenceError('migrate-project-scenes', 'The legacy UI scene directory is not a safe project directory.');
  }
  const copied: string[] = [];
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.name.toLowerCase().endsWith(UI_DESIGNER_FILE_EXTENSION))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const source = path.join(sourceDirectory, entry.name);
    const stat = fs.lstatSync(source);
    if (!entry.isFile() || stat.isSymbolicLink()) {
      throw new UiDesignerPersistenceError('migrate-project-scenes', `Legacy UI scene ${entry.name} is not a safe file.`);
    }
    const read = readUiDesignerFile(source);
    const expectedName = `${read.document.meta.sceneName}${UI_DESIGNER_FILE_EXTENSION}`;
    if (entry.name !== expectedName) {
      throw new UiDesignerPersistenceError('migrate-project-scenes', `Legacy UI scene ${entry.name} does not match its scene name ${read.document.meta.sceneName}.`);
    }
    const target = path.join(targetDirectory, expectedName);
    const body = fs.readFileSync(source);
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink() || !fs.readFileSync(target).equals(body)) {
        throw new UiDesignerPersistenceError('migrate-project-scenes', `A different UI scene already exists at ${expectedName}; migration did not overwrite it.`);
      }
      continue;
    }
    writeFileAtomically(target, body);
    copied.push(target);
  }
  markMigrationCompleted(marker);
  return { copied };
}

function migrateLegacyProjectUiDesignerGlobalData(projectRoot: string): void {
  const source = legacyProjectUiDesignerGlobalDataPath(projectRoot);
  if (!fs.existsSync(source)) return;
  const marker = uiDesignerMigrationMarkerPath(projectRoot, UI_DESIGNER_GLOBAL_DATA_MIGRATION_MARKER);
  if (migrationCompleted(marker, 'migrate-project-global-data')) return;
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new UiDesignerPersistenceError('migrate-project-global-data', 'The legacy global UI data entry is not a safe file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new UiDesignerPersistenceError('migrate-project-global-data', 'The legacy global UI data is not valid JSON.', error);
  }
  assertUiDesignerGlobalData(parsed);
  const target = projectUiDesignerGlobalDataPath(projectRoot);
  const body = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || !fs.readFileSync(target).equals(body)) {
      throw new UiDesignerPersistenceError('migrate-project-global-data', 'Different global UI data already exists in the project data directory; migration did not overwrite it.');
    }
    markMigrationCompleted(marker);
    return;
  }
  writeFileAtomically(target, body);
  markMigrationCompleted(marker);
}

function assertUiDesignerGlobalData(value: unknown): UiDesignerGlobalDataValue {
  if (Array.isArray(value)) return value as UiDesignerGlobalDataValue;
  if (value !== null && typeof value === 'object') return value as UiDesignerGlobalDataValue;
  throw new Error('UI designer global data must be a JSON object or array.');
}

/** Reads the project-wide global UI data; a missing file means "no data yet". */
export function readProjectUiDesignerGlobalData(projectRoot: string): UiDesignerGlobalDataReadResult {
  migrateLegacyProjectUiDesignerGlobalData(projectRoot);
  const resolved = projectUiDesignerGlobalDataPath(projectRoot);
  const metadata = readMetadataIfExists(resolved);
  if (!metadata) return { data: {}, metadata: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`UI designer global data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);}
  return { data: assertUiDesignerGlobalData(parsed), metadata };
}

export function saveProjectUiDesignerGlobalData(
  projectRoot: string,
  data: UiDesignerGlobalDataValue,
  options: UiDesignerSaveOptions = {},
): UiDesignerFileMetadata {
  migrateLegacyProjectUiDesignerGlobalData(projectRoot);
  const resolved = projectUiDesignerGlobalDataPath(projectRoot);
  const valid = assertUiDesignerGlobalData(data);
  const existing = readMetadataIfExists(resolved);
  if (!options.force && options.expected && !matchesExpected(existing, options.expected)) {
    throw new UiDesignerFileConflictError(resolved, options.expected, existing);
  }
  const body = Buffer.from(`${JSON.stringify(valid, null, 2)}\n`, 'utf8');
  writeFileAtomically(resolved, body);
  return metadataForBytes(resolved, body);
}

function decodePngDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error('UI designer thumbnail must be a PNG data URL.');
  const body = Buffer.from(match[1], 'base64');
  if (!body.length || body.length > UI_DESIGNER_THUMBNAIL_MAX_BYTES || body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('UI designer thumbnail PNG is invalid or too large.');
  }
  return body;
}

function pngDataUrl(filePath: string): string | undefined {
  try {
    const body = fs.readFileSync(filePath);
    if (!body.length || body.length > UI_DESIGNER_THUMBNAIL_MAX_BYTES) return undefined;
    return `data:image/png;base64,${body.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export function writeProjectUiDesignerThumbnail(projectRoot: string, sceneName: string, dataUrl: string): string {
  if (!UI_SCENE_NAME_PATTERN.test(sceneName)) throw new Error(`UI designer scene name is invalid: ${sceneName}`);
  const target = path.join(projectUiDesignerThumbnailDirectory(projectRoot), `${sceneName}.png`);
  writeFileAtomically(target, decodePngDataUrl(dataUrl));
  return target;
}

/**
 * Lists only the canonical scene sources owned by the current project. Invalid
 * entries fail explicitly instead of disappearing from the editor or falling
 * back to an unrelated project file.
 */
export function listUiDesignerSceneFiles(projectRoot: string): UiDesignerSceneFileRecord[] {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) return [];
  migrateLegacyProjectUiDesignerScenes(root);
  const directory = projectUiDesignerSceneDirectory(root);
  if (!fs.existsSync(directory)) return [];
  const records: UiDesignerSceneFileRecord[] = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.toLowerCase().endsWith(UI_DESIGNER_FILE_EXTENSION))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(fullPath);
    if (!entry.isFile() || stat.isSymbolicLink()) {
      throw new UiDesignerPersistenceError('list-project-scenes', `UI scene ${entry.name} is not a safe file.`);
    }
    const read = readUiDesignerFile(fullPath);
    const sceneName = read.document.meta.sceneName;
    if (entry.name !== `${sceneName}${UI_DESIGNER_FILE_EXTENSION}`) {
      throw new UiDesignerPersistenceError('list-project-scenes', `UI scene filename ${entry.name} does not match ${sceneName}.`);
    }
    const thumbnailPath = path.join(projectUiDesignerThumbnailDirectory(root), `${sceneName}.png`);
    const thumbnailUrl = pngDataUrl(thumbnailPath);
    records.push({
      path: path.relative(root, fullPath).split(path.sep).join('/'),
      sourcePath: fullPath,
      sceneName,
      modifiedAt: stat.mtime.toISOString(),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizePanePreferences(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  if ('leftPaneWidth' in next) next.leftPaneWidth = normalizeUiDesignerPaneSize('left', next.leftPaneWidth);
  if ('centerPaneWidth' in next) next.centerPaneWidth = normalizeUiDesignerPaneSize('center', next.centerPaneWidth);
  if ('rightPaneWidth' in next) next.rightPaneWidth = normalizeUiDesignerPaneSize('right', next.rightPaneWidth);
  return next;
}

export interface UiDesignerFileMetadata {
  path: string;
  digest: string;
  mtimeMs: number;
  size: number;
}

export interface UiDesignerReadResult {
  document: UiDesignerDocument;
  metadata: UiDesignerFileMetadata;
}

export interface UiDesignerSaveOptions {
  expected?: Partial<Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>>;
  force?: boolean;
}

export interface UiDesignerSnapshotRecord {
  id: string;
  sourcePath: string;
  snapshotPath: string;
  savedAt: string;
  digest: string;
  mtimeMs: number;
}

export interface UiDesignerRecentFileRecord {
  sourcePath: string;
  sceneName?: string;
  projectPath?: string;
  lastOpenedAt: string;
  lastSavedAt?: string;
  exists: boolean;
  thumbnailUrl?: string;
}

export interface UiDesignerRecoveryRecord extends UiDesignerSnapshotRecord {
  key?: string;
}

export class UiDesignerPersistenceError extends Error {
  readonly code = 'UI_DESIGNER_PERSISTENCE_ERROR';
  readonly operation: string;
  readonly recoverable = true;

  constructor(operation: string, message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'UiDesignerPersistenceError';
    this.operation = operation;
  }
}

export class UiDesignerFileConflictError extends Error {
  readonly code = 'UI_DESIGNER_CONFLICT';
  readonly expected: UiDesignerSaveOptions['expected'];
  readonly actual: UiDesignerFileMetadata | null;

  constructor(
    filePath: string,
    expected: UiDesignerSaveOptions['expected'],
    actual: UiDesignerFileMetadata | null,
  ) {
    super(`UI designer file changed since it was opened: ${filePath}. Save again with force only after reviewing the conflict.`);
    this.name = 'UiDesignerFileConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

export function readUiDesignerFile(filePath: string): UiDesignerReadResult {
  const resolved = assertUiDesignerFilePath(filePath);
  const body = fs.readFileSync(resolved);
  const document = parseUiDesignerDocument(body);
  return { document, metadata: metadataForBytes(resolved, body) };
}

export function parseUiDesignerDocument(body: Buffer | string): UiDesignerDocument {
  let parsed: unknown;
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`UI designer file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return assertValidUiDesignerDocument(parsed);
  } catch (error) {
    if (error instanceof UiDesignerValidationError) throw error;
    throw new Error(`UI designer file validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function serializeUiDesignerDocument(document: UiDesignerDocument): Buffer {
  const valid = assertValidUiDesignerDocument(document);
  return Buffer.from(`${JSON.stringify(valid, null, 2)}\n`, 'utf8');
}

export function saveUiDesignerFile(
  filePath: string,
  document: UiDesignerDocument,
  options: UiDesignerSaveOptions = {},
): UiDesignerFileMetadata {
  const resolved = assertUiDesignerFilePath(filePath);
  const existing = readMetadataIfExists(resolved);
  if (!options.force && options.expected && !matchesExpected(existing, options.expected)) {
    throw new UiDesignerFileConflictError(resolved, options.expected, existing);
  }
  const body = serializeUiDesignerDocument(document);
  writeFileAtomically(resolved, body);
  return metadataForBytes(resolved, body);
}

export class UiDesignerUserDataStore {
  private readonly workingDocumentsRoot: string;
  private readonly snapshotsRoot: string;
  private readonly recentPath: string;
  private readonly recoveryPath: string;
  private readonly recentFilesPath: string;
  private readonly recentThumbnailsRoot: string;
  private readonly preferencesPath: string;

  constructor(userDataRoot: string) {
    const resolvedUserDataRoot = path.resolve(userDataRoot);
    const persistentRoot = path.join(resolvedUserDataRoot, 'data', 'ui-designer');
    const recoveryRoot = path.join(resolvedUserDataRoot, 'runtime', 'ui-designer');
    this.workingDocumentsRoot = path.join(recoveryRoot, 'documents');
    this.snapshotsRoot = path.join(recoveryRoot, 'snapshots');
    this.recoveryPath = path.join(recoveryRoot, 'recovery.json');
    this.recentFilesPath = path.join(persistentRoot, 'recent-files.json');
    this.recentThumbnailsRoot = path.join(persistentRoot, 'thumbnails');
    // Keep the old filename as a read/write compatibility alias for callers
    // that used listRecentSnapshots before recovery was split out.
    this.recentPath = path.join(recoveryRoot, 'recent.json');
    this.preferencesPath = path.join(persistentRoot, 'preferences.json');
    migrateLegacyUiDesignerStore(resolvedUserDataRoot, {
      snapshotsRoot: this.snapshotsRoot,
      recoveryPath: this.recoveryPath,
      recentFilesPath: this.recentFilesPath,
      recentPath: this.recentPath,
      preferencesPath: this.preferencesPath,
    });
  }

  isWorkingDocumentPath(filePath: string): boolean {
    if (typeof filePath !== 'string' || !filePath.trim()) return false;
    const resolved = path.resolve(filePath);
    const relative = path.relative(path.resolve(this.workingDocumentsRoot), resolved);
    return path.extname(resolved).toLowerCase() === UI_DESIGNER_FILE_EXTENSION
      && Boolean(relative)
      && path.dirname(relative) === '.';
  }

  saveWorkingDocument(
    document: UiDesignerDocument,
    options: UiDesignerSaveOptions & { path?: string; duplicate?: boolean } = {},
  ): UiDesignerFileMetadata {
    const requestedPath = typeof options.path === 'string' ? options.path : '';
    const reuseExisting = options.duplicate !== true && this.isWorkingDocumentPath(requestedPath);
    const targetPath = reuseExisting ? path.resolve(requestedPath) : this.nextWorkingDocumentPath();
    return saveUiDesignerFile(targetPath, document, reuseExisting
      ? { expected: options.expected, force: options.force }
      : {});
  }

  captureSnapshot(filePath: string): UiDesignerSnapshotRecord {
    const read = readUiDesignerFile(filePath);
    const id = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const snapshotPath = path.join(this.snapshotsRoot, `${id}${UI_DESIGNER_FILE_EXTENSION}`);
    writeFileAtomically(snapshotPath, serializeUiDesignerDocument(read.document));
    const record: UiDesignerSnapshotRecord = {
      id,
      sourcePath: read.metadata.path,
      snapshotPath,
      savedAt: new Date().toISOString(),
      digest: read.metadata.digest,
      mtimeMs: read.metadata.mtimeMs,
    };
    const recent = [record, ...this.listRecentSnapshots().filter((item) => item.id !== id)]
      .slice(0, UI_DESIGNER_RECENT_LIMIT);
    writeJsonAtomically(this.recoveryPath, recent);
    writeJsonAtomically(this.recentPath, recent);
    this.recordRecentFile(read.metadata.path, { saved: true, sceneName: read.document.meta.sceneName });
    return record;
  }

  /** Persist an in-memory recovery document without pretending it came from disk. */
  writeRecovery(
    document: UiDesignerDocument,
    sourcePath?: string,
    sourceMetadata?: Partial<Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>>,
    key?: string,
  ): UiDesignerRecoveryRecord {
    const body = serializeUiDesignerDocument(document);
    const id = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const snapshotPath = path.join(this.snapshotsRoot, `${id}${UI_DESIGNER_FILE_EXTENSION}`);
    writeFileAtomically(snapshotPath, body);
    const record: UiDesignerRecoveryRecord = {
      id,
      sourcePath: sourcePath ? path.resolve(sourcePath) : '',
      snapshotPath,
      savedAt: new Date().toISOString(),
      digest: sourceMetadata?.digest || crypto.createHash('sha256').update(body).digest('hex'),
      mtimeMs: typeof sourceMetadata?.mtimeMs === 'number' ? sourceMetadata.mtimeMs : Date.now(),
      ...(key ? { key } : {}),
    };
    const recovery = [record, ...this.listRecentSnapshots().filter((item) => item.id !== id && (!key || (item as UiDesignerRecoveryRecord).key !== key))]
      .slice(0, UI_DESIGNER_RECENT_LIMIT);
    this.writeRecoveryRecords(recovery);
    return record;
  }

  clearRecovery(id: string): void {
    const records = this.listRecentSnapshots();
    const target = records.find((record) => record.id === id);
    if (target) {
      const snapshotPath = this.resolveSnapshotPath(target);
      if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath, { force: true });
    }
    this.writeRecoveryRecords(records.filter((record) => record.id !== id));
  }

  readRecovery(id: string): { record: UiDesignerRecoveryRecord; document: UiDesignerDocument } {
    const record = this.listRecentSnapshots().find((item) => item.id === id) as UiDesignerRecoveryRecord | undefined;
    if (!record) throw new UiDesignerPersistenceError('read-recovery', `Recovery record ${id} was not found.`);
    try {
      return { record, document: readUiDesignerFile(this.resolveSnapshotPath(record)).document };
    } catch (error) {
      throw new UiDesignerPersistenceError('read-recovery', `Recovery record ${id} is invalid and cannot be loaded.`, error);
    }
  }

  recordRecentFile(filePath: string, options: { opened?: boolean; saved?: boolean; sceneName?: string; projectPath?: string; thumbnailDataUrl?: string } = {}): UiDesignerRecentFileRecord {
    const resolved = path.resolve(filePath);
    const now = new Date().toISOString();
    const current = this.readRecentFiles();
    const previous = current.find((item) => item.sourcePath === resolved);
    const owningProject = options.projectPath || previous?.projectPath;
    const record: UiDesignerRecentFileRecord = {
      sourcePath: resolved,
      ...(options.sceneName || previous?.sceneName ? { sceneName: options.sceneName || previous?.sceneName } : {}),
      ...(owningProject ? { projectPath: path.resolve(owningProject) } : {}),
      lastOpenedAt: options.opened === true || !previous ? now : previous.lastOpenedAt,
      ...(options.saved || previous?.lastSavedAt ? { lastSavedAt: options.saved ? now : previous?.lastSavedAt } : {}),
      exists: fs.existsSync(resolved),
    };
    let thumbnailUrl: string | undefined;
    if (options.thumbnailDataUrl) {
      const thumbnailPath = this.recentThumbnailPath(resolved);
      writeFileAtomically(thumbnailPath, decodePngDataUrl(options.thumbnailDataUrl));
      thumbnailUrl = pngDataUrl(thumbnailPath);
    } else {
      thumbnailUrl = pngDataUrl(this.recentThumbnailPath(resolved));
    }
    const next = [record, ...current.filter((item) => item.sourcePath !== resolved)].slice(0, UI_DESIGNER_RECENT_LIMIT);
    writeJsonAtomically(this.recentFilesPath, next);
    return { ...record, ...(thumbnailUrl ? { thumbnailUrl } : {}) };
  }

  listRecentFiles(projectPath?: string): UiDesignerRecentFileRecord[] {
    const project = projectPath?.trim() ? path.resolve(projectPath) : '';
    return this.readRecentFiles().filter((record) => !project
      || (record.projectPath ? isPathWithin(project, record.projectPath) && isPathWithin(record.projectPath, project) : isPathWithin(project, record.sourcePath)))
      .map((record) => {
      const thumbnailUrl = pngDataUrl(this.recentThumbnailPath(record.sourcePath));
      return { ...record, exists: fs.existsSync(record.sourcePath), ...(thumbnailUrl ? { thumbnailUrl } : {}) };
    });
  }

  private recentThumbnailPath(sourcePath: string): string {
    const key = crypto.createHash('sha256').update(path.resolve(sourcePath)).digest('hex');
    return path.join(this.recentThumbnailsRoot, `${key}.png`);
  }

  removeRecentFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    writeJsonAtomically(this.recentFilesPath, this.readRecentFiles().filter((record) => record.sourcePath !== resolved));
    const thumbnailPath = this.recentThumbnailPath(resolved);
    if (fs.existsSync(thumbnailPath)) fs.rmSync(thumbnailPath, { force: true });
  }

  listRecentSnapshots(): UiDesignerSnapshotRecord[] {
    const source = fs.existsSync(this.recoveryPath) ? this.recoveryPath : this.recentPath;
    if (!fs.existsSync(source)) return [];
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(source, 'utf8')); }
    catch (error) { throw new UiDesignerPersistenceError('list-recovery', 'Recovery history is damaged. Restore or remove the recovery metadata file before continuing.', error); }
    if (!Array.isArray(raw) || raw.some((value) => !isSnapshotRecord(value))) {
      throw new UiDesignerPersistenceError('list-recovery', 'Recovery history has an invalid record shape and was not silently discarded.');
    }
    const records = raw.slice(0, UI_DESIGNER_RECENT_LIMIT) as UiDesignerSnapshotRecord[];
    records.forEach((record) => this.resolveSnapshotPath(record));
    const missing = records.find((record) => !fs.existsSync(record.snapshotPath));
    if (missing) throw new UiDesignerPersistenceError('list-recovery', `Recovery snapshot ${missing.id} is missing; choose another recovery record or repair the user-data folder.`);
    return records;
  }

  listRecovery(): UiDesignerRecoveryRecord[] {
    return this.listRecentSnapshots() as UiDesignerRecoveryRecord[];
  }

  restoreSnapshot(
    snapshotId: string,
    targetPath: string,
    options: UiDesignerSaveOptions = {},
  ): UiDesignerFileMetadata {
    const record = this.listRecentSnapshots().find((item) => item.id === snapshotId);
    if (!record) throw new Error(`UI designer snapshot not found: ${snapshotId}`);
    const read = readUiDesignerFile(this.resolveSnapshotPath(record));
    return saveUiDesignerFile(targetPath, read.document, options);
  }

  readPreferences<T = Record<string, unknown>>(): T {
    if (!fs.existsSync(this.preferencesPath)) return {} as T;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(this.preferencesPath, 'utf8')); }
    catch (error) { throw new UiDesignerPersistenceError('read-preferences', 'UI designer preferences are damaged. Restore the preferences file or reset preferences explicitly.', error); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UiDesignerPersistenceError('read-preferences', 'UI designer preferences have an invalid shape and were not silently reset.');
    return normalizePanePreferences(raw as Record<string, unknown>) as T;
  }

  writePreferences(value: Record<string, unknown>): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UI designer preferences must be an object.');
    writeJsonAtomically(this.preferencesPath, normalizePanePreferences(value));
  }

  private writeRecoveryRecords(records: UiDesignerRecoveryRecord[]): void {
    writeJsonAtomically(this.recoveryPath, records);
    writeJsonAtomically(this.recentPath, records);
    const keep = new Set(records.map((record) => this.resolveSnapshotPath(record)));
    if (fs.existsSync(this.snapshotsRoot)) {
      for (const file of fs.readdirSync(this.snapshotsRoot)) {
        const candidate = path.join(this.snapshotsRoot, file);
        if (file.endsWith(UI_DESIGNER_FILE_EXTENSION) && !keep.has(candidate)) fs.rmSync(candidate, { force: true });
      }
    }
  }

  private resolveSnapshotPath(record: Pick<UiDesignerSnapshotRecord, 'id' | 'snapshotPath'>): string {
    const root = path.resolve(this.snapshotsRoot);
    const candidate = path.resolve(String(record.snapshotPath || ''));
    if (!isPathWithin(root, candidate)) {
      throw new UiDesignerPersistenceError('recovery-path', `Recovery record ${record.id} points outside the UI designer recovery folder.`);
    }
    try {
      const realRoot = fs.realpathSync.native(root);
      const realCandidate = fs.realpathSync.native(candidate);
      if (!isPathWithin(realRoot, realCandidate)) {
        throw new UiDesignerPersistenceError('recovery-path', `Recovery record ${record.id} escapes the UI designer recovery folder.`);
      }
    } catch (error) {
      if (error instanceof UiDesignerPersistenceError) throw error;
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return candidate;
      throw new UiDesignerPersistenceError('recovery-path', `Recovery record ${record.id} could not be checked safely.`, error);
    }
    return candidate;
  }

  private readRecentFiles(): UiDesignerRecentFileRecord[] {
    if (!fs.existsSync(this.recentFilesPath)) return [];
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(this.recentFilesPath, 'utf8')); }
    catch (error) { throw new UiDesignerPersistenceError('list-recent-files', 'Recent-file history is damaged. Repair or remove the recent-file metadata file before continuing.', error); }
    if (!Array.isArray(raw) || raw.some((value) => !isRecentFileRecord(value))) throw new UiDesignerPersistenceError('list-recent-files', 'Recent-file history has an invalid record shape and was not silently discarded.');
    return raw.slice(0, UI_DESIGNER_RECENT_LIMIT) as UiDesignerRecentFileRecord[];
  }

  private nextWorkingDocumentPath(): string {
    fs.mkdirSync(this.workingDocumentsRoot, { recursive: true });
    if (fs.lstatSync(this.workingDocumentsRoot).isSymbolicLink()) {
      throw new UiDesignerPersistenceError('save-working-document', 'The UI designer working-document folder cannot be a symbolic link.');
    }
    let candidate: string;
    do {
      candidate = path.join(this.workingDocumentsRoot, `${crypto.randomUUID()}${UI_DESIGNER_FILE_EXTENSION}`);
    } while (fs.existsSync(candidate));
    return candidate;
  }
}

interface UiDesignerStorePaths {
  snapshotsRoot: string;
  recoveryPath: string;
  recentFilesPath: string;
  recentPath: string;
  preferencesPath: string;
}

function migrateLegacyUiDesignerStore(userDataRoot: string, target: UiDesignerStorePaths): void {
  const legacyRoot = path.join(userDataRoot, 'ui-designer');
  if (!fs.existsSync(legacyRoot)) return;

  const legacySnapshotsRoot = path.join(legacyRoot, 'snapshots');
  const migrations = [
    ...legacySnapshotMigrations(legacySnapshotsRoot, target.snapshotsRoot),
    legacySnapshotMetadataMigration(path.join(legacyRoot, 'recovery.json'), target.recoveryPath, legacySnapshotsRoot, target.snapshotsRoot),
    legacySnapshotMetadataMigration(path.join(legacyRoot, 'recent.json'), target.recentPath, legacySnapshotsRoot, target.snapshotsRoot),
    legacyFileMigration(path.join(legacyRoot, 'recent-files.json'), target.recentFilesPath),
    legacyFileMigration(path.join(legacyRoot, 'preferences.json'), target.preferencesPath),
  ].filter((migration): migration is LegacyUiDesignerMigration => Boolean(migration));

  migrations.forEach(validateLegacyMigrationTarget);
  migrations.forEach(applyLegacyMigration);

  removeDirectoryIfEmpty(legacySnapshotsRoot);
  removeDirectoryIfEmpty(legacyRoot);
}

interface LegacyUiDesignerMigration {
  source: string;
  target: string;
  body: Buffer;
}

function legacySnapshotMigrations(sourceRoot: string, targetRoot: string): LegacyUiDesignerMigration[] {
  if (!fs.existsSync(sourceRoot)) return [];
  const sourceStat = fs.lstatSync(sourceRoot);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new UiDesignerPersistenceError('migrate-user-data', 'The legacy UI designer snapshots path is not a safe directory.');
  }
  return fs.readdirSync(sourceRoot).map((name) => {
    const source = path.join(sourceRoot, name);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || path.extname(name).toLowerCase() !== UI_DESIGNER_FILE_EXTENSION) {
      throw new UiDesignerPersistenceError('migrate-user-data', `The legacy UI designer snapshots folder contains an unsupported entry: ${name}.`);
    }
    return { source, target: path.join(targetRoot, name), body: fs.readFileSync(source) };
  });
}

function legacySnapshotMetadataMigration(
  source: string,
  target: string,
  legacySnapshotsRoot: string,
  targetSnapshotsRoot: string,
): LegacyUiDesignerMigration | null {
  if (!fs.existsSync(source)) return null;
  assertSafeLegacyFile(source);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (error) {
    throw new UiDesignerPersistenceError('migrate-user-data', 'Legacy UI designer recovery metadata is damaged and was not moved.', error);
  }
  if (!Array.isArray(parsed) || parsed.some((value) => !isSnapshotRecord(value))) {
    throw new UiDesignerPersistenceError('migrate-user-data', 'Legacy UI designer recovery metadata has an invalid record shape and was not moved.');
  }
  const legacyRoot = path.resolve(legacySnapshotsRoot);
  const rewritten = (parsed as UiDesignerSnapshotRecord[]).map((record) => {
    const legacySnapshot = path.resolve(record.snapshotPath);
    if (!isPathWithin(legacyRoot, legacySnapshot)) {
      throw new UiDesignerPersistenceError('migrate-user-data', `Legacy recovery record ${record.id} points outside its snapshots folder.`);
    }
    const relative = path.relative(legacyRoot, legacySnapshot);
    return { ...record, snapshotPath: path.join(targetSnapshotsRoot, relative) };
  });
  return { source, target, body: Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`, 'utf8') };
}

function legacyFileMigration(source: string, target: string): LegacyUiDesignerMigration | null {
  if (!fs.existsSync(source)) return null;
  assertSafeLegacyFile(source);
  return { source, target, body: fs.readFileSync(source) };
}

function assertSafeLegacyFile(source: string): void {
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new UiDesignerPersistenceError('migrate-user-data', `The legacy UI designer entry ${path.basename(source)} is not a safe file.`);
  }
}

function validateLegacyMigrationTarget(migration: LegacyUiDesignerMigration): void {
  if (!fs.existsSync(migration.target)) return;
  const stat = fs.lstatSync(migration.target);
  if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(migration.target).equals(migration.body)) {
    throw new UiDesignerPersistenceError('migrate-user-data', `UI designer user data already exists at the destination for ${path.basename(migration.source)}.`);
  }
}

function applyLegacyMigration(migration: LegacyUiDesignerMigration): void {
  if (!fs.existsSync(migration.target)) writeFileAtomically(migration.target, migration.body);
  fs.rmSync(migration.source, { force: true });
}

function removeDirectoryIfEmpty(directory: string): void {
  if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function assertUiDesignerFilePath(filePath: string): string {
  const resolved = path.resolve(String(filePath || ''));
  if (path.extname(resolved).toLowerCase() !== UI_DESIGNER_FILE_EXTENSION) {
    throw new Error(`UI designer files must use ${UI_DESIGNER_FILE_EXTENSION}.`);
  }
  return resolved;
}

function readMetadataIfExists(filePath: string): UiDesignerFileMetadata | null {
  if (!fs.existsSync(filePath)) return null;
  const body = fs.readFileSync(filePath);
  return metadataForBytes(filePath, body);
}

function metadataForBytes(filePath: string, body: Buffer): UiDesignerFileMetadata {
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    digest: crypto.createHash('sha256').update(body).digest('hex'),
    mtimeMs: stat.mtimeMs,
    size: body.byteLength,
  };
}

function matchesExpected(
  actual: UiDesignerFileMetadata | null,
  expected: UiDesignerSaveOptions['expected'],
): boolean {
  if (!actual) return false;
  if (expected?.digest != null && expected.digest !== actual.digest) return false;
  if (expected?.mtimeMs != null && expected.mtimeMs !== actual.mtimeMs) return false;
  return true;
}

/**
 * Write a buffer through the same backup/replace path used by `.mzui` saves.
 *
 * Runtime JSON exports use this helper as well so overwrite semantics remain
 * safe on Windows, where replacing an existing file with rename alone is not
 * guaranteed to be atomic.  The helper also restores a backup left behind by
 * a crash before starting the next write.
 */
export function writeFileAtomically(filePath: string, body: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  recoverAtomicBackup(filePath);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    replaceFile(temporary, filePath);
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  writeFileAtomically(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

function replaceFile(temporary: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.renameSync(temporary, target);
    return;
  }
  const backup = `${target}.backup-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.renameSync(target, backup);
  try {
    fs.renameSync(temporary, target);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

/** Recover a target left without its original after a process crash window. */
function recoverAtomicBackup(target: string): void {
  if (fs.existsSync(target)) return;
  const directory = path.dirname(target);
  const prefix = `${path.basename(target)}.backup-`;
  const candidates = fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(directory, name))
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const [newest, ...stale] = candidates;
  if (!newest) return;
  fs.renameSync(newest, target);
  for (const backup of stale) fs.rmSync(backup, { force: true });
}

function isSnapshotRecord(value: unknown): value is UiDesignerSnapshotRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [record.id, record.snapshotPath, record.savedAt, record.digest]
    .every((item) => typeof item === 'string' && item.length > 0)
    && typeof record.sourcePath === 'string'
    && typeof record.mtimeMs === 'number'
    && Number.isFinite(record.mtimeMs);
}

function isPathWithin(root: string, candidate: string): boolean {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isRecentFileRecord(value: unknown): value is UiDesignerRecentFileRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sourcePath === 'string' && record.sourcePath.length > 0
    && (record.sceneName === undefined || typeof record.sceneName === 'string')
    && (record.projectPath === undefined || typeof record.projectPath === 'string')
    && typeof record.lastOpenedAt === 'string'
    && (record.lastSavedAt === undefined || typeof record.lastSavedAt === 'string')
    && typeof record.exists === 'boolean';
}

export function uiDesignerFileResult<T>(
  status: UiFileResult<T>['status'],
  message: string,
  value?: T,
  filePath?: string,
): UiFileResult<T> {
  return {
    status,
    message,
    ...(value === undefined ? {} : { value }),
    ...(filePath ? { path: path.resolve(filePath) } : {}),
  };
}
