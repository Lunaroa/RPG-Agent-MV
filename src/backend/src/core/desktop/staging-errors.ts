export const STAGING_ERROR_CODES = {
  busy: 'STAGING_BUSY',
  conflict: 'STAGING_CONFLICT',
  duplicateFile: 'STAGING_DUPLICATE_FILE',
  duplicateOperationId: 'STAGING_DUPLICATE_OPERATION_ID',
  emptyFileSet: 'STAGING_EMPTY_FILE_SET',
  fileNotStaged: 'STAGING_FILE_NOT_STAGED',
  fileOwned: 'STAGING_FILE_OWNED',
  invalidManifest: 'STAGING_INVALID_MANIFEST',
  invalidOperationId: 'STAGING_INVALID_OPERATION_ID',
  invalidPlanHash: 'STAGING_INVALID_PLAN_HASH',
  operationFileMismatch: 'STAGING_OPERATION_FILE_MISMATCH',
  operationNotFound: 'STAGING_OPERATION_NOT_FOUND',
  operationOwned: 'STAGING_OPERATION_OWNED',
  ownerRequired: 'STAGING_OWNER_REQUIRED',
  unsafePath: 'STAGING_UNSAFE_PATH',
  unownedDraft: 'STAGING_UNOWNED_DRAFT',
  wrongOwner: 'STAGING_WRONG_OWNER',
} as const;

export type StagingErrorCode = typeof STAGING_ERROR_CODES[keyof typeof STAGING_ERROR_CODES];

export class StagingError extends Error {
  readonly code: StagingErrorCode;
  readonly details?: unknown;

  constructor(code: StagingErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'StagingError';
    this.code = code;
    this.details = details;
  }
}
