export const CHAT_IMAGE_MAX_COUNT = 4;
export const CHAT_IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type ChatImageMime = typeof CHAT_IMAGE_MIME_TYPES[number];

const MIME_SET = new Set<string>(CHAT_IMAGE_MIME_TYPES);

export function isChatImageMime(value: unknown): value is ChatImageMime {
  return typeof value === 'string' && MIME_SET.has(value.toLowerCase());
}

export function chatImageExtension(mime: ChatImageMime): 'png' | 'jpg' | 'webp' | 'gif' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'gif';
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** Detect supported chat images from their actual bytes, never from a filename. */
export function detectChatImageMime(bytes: Uint8Array): ChatImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif';
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}
