export const CONTROLLED_EDITING_DISABLED_CODE = 'CONTROLLED_EDITING_DISABLED' as const;

export const STORY_PROJECT_NOT_INITIALIZED_MESSAGE =
  'Story project is not initialized; controlled event editing is unavailable';

export const IPC_STRUCTURED_ERROR_PREFIX = '[IPC_STRUCTURED_ERROR]' as const;

export interface IpcStructuredErrorEnvelope {
  code: string;
  details: unknown;
}

export interface ParsedIpcStructuredError extends IpcStructuredErrorEnvelope {
  message: string;
}

export function appendIpcStructuredError(
  message: string,
  code: string,
  details: unknown,
): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify({ code, details });
  } catch {
    return message;
  }
  if (!encoded) return message;
  return `${message}\n${IPC_STRUCTURED_ERROR_PREFIX}${encoded}`;
}

export function parseIpcStructuredError(message: string): ParsedIpcStructuredError | null {
  const marker = `\n${IPC_STRUCTURED_ERROR_PREFIX}`;
  const markerIndex = message.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const encoded = message.slice(markerIndex + marker.length).trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(encoded) as Partial<IpcStructuredErrorEnvelope>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.code !== 'string' || !Object.hasOwn(parsed, 'details')) {
      return null;
    }
    return {
      message: message.slice(0, markerIndex),
      code: parsed.code,
      details: parsed.details,
    };
  } catch {
    return null;
  }
}

export type DesktopErrorCode = typeof CONTROLLED_EDITING_DISABLED_CODE;
