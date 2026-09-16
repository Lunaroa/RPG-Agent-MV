export const PROJECT_FILE_ERROR_CODES = {
  unsafePath: 'PROJECT_FILE_UNSAFE_PATH',
  identityCollision: 'PROJECT_FILE_IDENTITY_COLLISION',
  conflict: 'PROJECT_FILE_CONFLICT',
  busy: 'PROJECT_FILE_BUSY',
  transactionFailed: 'PROJECT_FILE_TRANSACTION_FAILED',
} as const;

export type ProjectFileErrorCode = typeof PROJECT_FILE_ERROR_CODES[keyof typeof PROJECT_FILE_ERROR_CODES];

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ProjectFileErrorCode, message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileError';
    this.code = code;
    this.details = details;
  }
}
