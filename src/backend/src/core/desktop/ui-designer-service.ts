import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  UiDesignerDocument,
  UiFileResult,
} from '../../../../contract/ui-designer.ts';
import { normalizeUiDesignerPaneSize } from '../../../../contract/ui-designer-geometry.ts';
import {
  assertValidUiDesignerDocument,
  UiDesignerValidationError,
} from './ui-designer-validation.ts';

export const UI_DESIGNER_FILE_EXTENSION = '.mzui';
export const UI_DESIGNER_RECENT_LIMIT = 10;

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
  lastOpenedAt: string;
  lastSavedAt?: string;
  exists: boolean;
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
  private readonly snapshotsRoot: string;
  private readonly recentPath: string;
  private readonly recoveryPath: string;
  private readonly recentFilesPath: string;
  private readonly preferencesPath: string;

  constructor(userDataRoot: string) {
    const resolvedUserDataRoot = path.resolve(userDataRoot);
    const persistentRoot = path.join(resolvedUserDataRoot, 'data', 'ui-designer');
    const recoveryRoot = path.join(resolvedUserDataRoot, 'runtime', 'ui-designer');
    this.snapshotsRoot = path.join(recoveryRoot, 'snapshots');
    this.recoveryPath = path.join(recoveryRoot, 'recovery.json');
    this.recentFilesPath = path.join(persistentRoot, 'recent-files.json');
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

  recordRecentFile(filePath: string, options: { opened?: boolean; saved?: boolean; sceneName?: string } = {}): UiDesignerRecentFileRecord {
    const resolved = path.resolve(filePath);
    const now = new Date().toISOString();
    const current = this.readRecentFiles();
    const previous = current.find((item) => item.sourcePath === resolved);
    const record: UiDesignerRecentFileRecord = {
      sourcePath: resolved,
      ...(options.sceneName || previous?.sceneName ? { sceneName: options.sceneName || previous?.sceneName } : {}),
      lastOpenedAt: options.opened === true || !previous ? now : previous.lastOpenedAt,
      ...(options.saved || previous?.lastSavedAt ? { lastSavedAt: options.saved ? now : previous?.lastSavedAt } : {}),
      exists: fs.existsSync(resolved),
    };
    const next = [record, ...current.filter((item) => item.sourcePath !== resolved)].slice(0, UI_DESIGNER_RECENT_LIMIT);
    writeJsonAtomically(this.recentFilesPath, next);
    return record;
  }

  listRecentFiles(): UiDesignerRecentFileRecord[] {
    return this.readRecentFiles().map((record) => ({ ...record, exists: fs.existsSync(record.sourcePath) }));
  }

  removeRecentFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    writeJsonAtomically(this.recentFilesPath, this.readRecentFiles().filter((record) => record.sourcePath !== resolved));
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
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function isRecentFileRecord(value: unknown): value is UiDesignerRecentFileRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sourcePath === 'string' && record.sourcePath.length > 0
    && (record.sceneName === undefined || typeof record.sceneName === 'string')
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
