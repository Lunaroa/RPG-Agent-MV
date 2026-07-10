import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';

export interface StagingOwnershipContext {
  operationId: string;
}

export interface StagingOperation {
  operationId: string;
  kind: 'database';
  planHash: string;
  sessionId?: string;
  changes: unknown;
  files: string[];
  createdAt: string;
}

export interface RegisterDatabaseStagingOperationInput {
  operationId: string;
  planHash: string;
  sessionId?: string;
  changes: unknown;
  files: string[];
}

interface OwnershipManifest {
  files: Record<string, { operationId?: string }>;
  operations: Record<string, StagingOperation>;
}

export function validateStagingOperationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new StagingError(
      STAGING_ERROR_CODES.invalidOperationId,
      'Database staging operationId is invalid.',
    );
  }
  return value;
}

export function normalizeStagingOperations(
  value: unknown,
  normalizeRelativePath: (value: string) => string,
): Record<string, StagingOperation> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new StagingError(STAGING_ERROR_CODES.invalidManifest, 'Staging manifest operations must be an object.');
  }
  const normalized: Record<string, StagingOperation> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new StagingError(STAGING_ERROR_CODES.invalidManifest, `Invalid staging operation metadata: ${key}`);
    }
    const operation = raw as Partial<StagingOperation>;
    if (operation.operationId !== key || operation.kind !== 'database') {
      throw new StagingError(
        STAGING_ERROR_CODES.invalidManifest,
        `Staging operation key must match its database operationId: ${key}`,
      );
    }
    validateStagingOperationId(key);
    if (!/^[a-f0-9]{64}$/i.test(String(operation.planHash || ''))
      || !Array.isArray(operation.files)
      || typeof operation.createdAt !== 'string') {
      throw new StagingError(STAGING_ERROR_CODES.invalidManifest, `Invalid staging operation metadata: ${key}`);
    }
    normalized[key] = {
      operationId: key,
      kind: 'database',
      planHash: operation.planHash!.toLowerCase(),
      ...(typeof operation.sessionId === 'string' && operation.sessionId.trim()
        ? { sessionId: operation.sessionId }
        : {}),
      changes: operation.changes,
      files: operation.files.map(normalizeRelativePath),
      createdAt: operation.createdAt,
    };
  }
  return normalized;
}

export function cloneStagingOperation(operation: StagingOperation): StagingOperation {
  return {
    ...operation,
    files: [...operation.files],
  };
}

export function listStagingOperationMetadata(manifest: OwnershipManifest): StagingOperation[] {
  return Object.values(manifest.operations)
    .sort((left, right) => left.operationId.localeCompare(right.operationId))
    .map(cloneStagingOperation);
}

export function assertStagingWriteOwnership(
  manifest: OwnershipManifest,
  relativePath: string,
  ownership: StagingOwnershipContext | undefined,
): void {
  const entry = manifest.files[relativePath];
  if (!ownership) {
    if (entry?.operationId) {
      throw new StagingError(
        STAGING_ERROR_CODES.ownerRequired,
        `Manual staging write cannot modify operation-owned file: ${relativePath}`,
        { relativePath, operationId: entry.operationId },
      );
    }
    return;
  }

  const operation = manifest.operations[ownership.operationId];
  if (!operation) {
    throw new StagingError(
      STAGING_ERROR_CODES.operationNotFound,
      `Database staging operation does not exist: ${ownership.operationId}`,
      { operationId: ownership.operationId },
    );
  }
  if (entry?.operationId && entry.operationId !== operation.operationId) {
    throw new StagingError(
      STAGING_ERROR_CODES.wrongOwner,
      `Staged file is owned by a different operation: ${relativePath}`,
      { relativePath, expectedOperationId: entry.operationId, actualOperationId: operation.operationId },
    );
  }
  if (!operation.files.includes(relativePath) || !entry || entry.operationId !== operation.operationId) {
    throw new StagingError(
      STAGING_ERROR_CODES.operationFileMismatch,
      `Database staging operation does not own the staged file: ${relativePath}`,
      { relativePath, operationId: operation.operationId },
    );
  }
}
