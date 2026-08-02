import {
  appendIpcStructuredError,
  CONTROLLED_EDITING_DISABLED_CODE,
  STORY_PROJECT_NOT_INITIALIZED_MESSAGE,
} from '../../../contract/desktop-errors.ts';
import { StoryProjectNotInitializedError } from '../../../backend/src/core/desktop/story-page-sync-service.ts';
import { StagingError } from '../../../backend/src/core/desktop/staging-errors.ts';

type IpcError = Error & { code?: string; details?: unknown };

export function formatIpcErrorMessage(code: string, message: string, details?: unknown): string {
  const formatted = `[${code}] ${message}`;
  return details === undefined ? formatted : appendIpcStructuredError(formatted, code, details);
}

export function toIpcThrowable(error: unknown): Error {
  if (error instanceof StoryProjectNotInitializedError) {
    return new Error(formatIpcErrorMessage(error.code, error.message));
  }
  if (error instanceof StagingError) {
    const wrapped = new Error(formatIpcErrorMessage(error.code, error.message, error.details)) as IpcError;
    wrapped.name = error.name;
    wrapped.code = error.code;
    wrapped.details = error.details;
    return wrapped;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}


export function invokeDesktop<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toIpcThrowable(error);
  }
}
