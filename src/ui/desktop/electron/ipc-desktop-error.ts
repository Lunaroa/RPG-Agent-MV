import {
  CONTROLLED_EDITING_DISABLED_CODE,
  STORY_PROJECT_NOT_INITIALIZED_MESSAGE,
} from '../../../contract/desktop-errors.ts';
import { StoryProjectNotInitializedError } from '../../../backend/src/core/desktop/story-page-sync-service.ts';

export function formatIpcErrorMessage(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function toIpcThrowable(error: unknown): Error {
  if (error instanceof StoryProjectNotInitializedError) {
    return new Error(formatIpcErrorMessage(error.code, error.message));
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
