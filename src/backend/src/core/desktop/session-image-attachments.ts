import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ProductLanguage } from '../../../../contract/i18n.ts';
import type {
  SessionImageAttachment,
  SessionImageAttachmentInput,
} from '../../../../contract/types.ts';
import {
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MAX_FILE_BYTES,
  CHAT_IMAGE_MAX_TOTAL_BYTES,
  chatImageExtension,
  detectChatImageMime,
  isChatImageMime,
  type ChatImageMime,
} from '../../../../contract/chat-image-attachments.ts';
import { backendText } from '../i18n/messages.ts';

export interface StoredSessionImageAttachment extends SessionImageAttachment {
  filePath: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function sessionImageAttachmentUrl(sessionId: string, attachmentId: string): string {
  if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(attachmentId)) throw new Error('Invalid session attachment identifier.');
  return `rmmv-asset://session/${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}`;
}

export async function storeSessionImageAttachments(
  outDir: string,
  sessionId: string,
  inputs: SessionImageAttachmentInput[] | undefined,
  language: ProductLanguage,
): Promise<StoredSessionImageAttachment[]> {
  const validated = validateSessionImageAttachments(inputs, language);
  if (validated.length === 0) return [];

  const attachmentsDir = path.join(outDir, 'attachments');
  const stagingDir = path.join(outDir, `.attachments-${randomUUID()}`);
  await fsp.mkdir(outDir, { recursive: true });
  try {
    await fsp.mkdir(stagingDir, { recursive: false });
    const stored: StoredSessionImageAttachment[] = [];
    for (const item of validated) {
      const id = randomUUID();
      const fileName = `${id}.${chatImageExtension(item.mime)}`;
      const stagedPath = path.join(stagingDir, fileName);
      await fsp.writeFile(stagedPath, item.bytes, { flag: 'wx' });
      stored.push({
        id,
        filename: item.filename,
        mime: item.mime,
        sizeBytes: item.bytes.byteLength,
        url: sessionImageAttachmentUrl(sessionId, id),
        filePath: path.join(attachmentsDir, fileName),
      });
    }
    await fsp.rename(stagingDir, attachmentsDir);
    return stored;
  } catch (error) {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await fsp.rm(attachmentsDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(backendText('session.image.writeFailed', language), { cause: error });
  }
}

export function restoreSessionImageAttachments(
  outDir: string,
  attachments: SessionImageAttachment[] | undefined,
): StoredSessionImageAttachment[] {
  const attachmentsDir = path.join(outDir, 'attachments');
  return (attachments || []).flatMap((attachment) => {
    if (!attachment || !SAFE_ID.test(String(attachment.id || '')) || !isChatImageMime(attachment.mime)) return [];
    const filePath = path.join(attachmentsDir, `${attachment.id}.${chatImageExtension(attachment.mime)}`);
    return [{ ...attachment, filePath }];
  });
}

export function requireStoredSessionImageAttachment(
  attachment: StoredSessionImageAttachment,
  language: ProductLanguage,
): StoredSessionImageAttachment {
  if (!fs.existsSync(attachment.filePath) || !fs.statSync(attachment.filePath).isFile()) {
    throw new Error(backendText('session.image.missing', language));
  }
  const bytes = fs.readFileSync(attachment.filePath);
  if (bytes.byteLength !== attachment.sizeBytes || detectChatImageMime(bytes) !== attachment.mime) {
    throw new Error(backendText('session.image.missing', language));
  }
  return attachment;
}

function validateSessionImageAttachments(
  inputs: SessionImageAttachmentInput[] | undefined,
  language: ProductLanguage,
): Array<{ filename: string; mime: ChatImageMime; bytes: Buffer }> {
  if (!inputs?.length) return [];
  if (inputs.length > CHAT_IMAGE_MAX_COUNT) {
    throw new Error(backendText('session.image.countExceeded', language, { count: CHAT_IMAGE_MAX_COUNT }));
  }

  let totalBytes = 0;
  const validated = inputs.map((input, index) => {
    const declaredMime = String(input?.mime || '').toLowerCase();
    if (!isChatImageMime(declaredMime)) throw new Error(backendText('session.image.unsupportedFormat', language));
    const encoded = String(input?.dataBase64 || '');
    if (!encoded || !BASE64.test(encoded)) throw new Error(backendText('session.image.invalidData', language));
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error(backendText('session.image.invalidData', language));
    if (bytes.byteLength !== Number(input.sizeBytes)) throw new Error(backendText('session.image.invalidData', language));
    if (bytes.byteLength > CHAT_IMAGE_MAX_FILE_BYTES) {
      throw new Error(backendText('session.image.fileTooLarge', language, { size: CHAT_IMAGE_MAX_FILE_BYTES / 1024 / 1024 }));
    }
    const actualMime = detectChatImageMime(bytes);
    if (!actualMime) throw new Error(backendText('session.image.unsupportedFormat', language));
    if (actualMime !== declaredMime) throw new Error(backendText('session.image.mimeMismatch', language));
    totalBytes += bytes.byteLength;
    return {
      filename: normalizeDisplayFilename(input.filename, index, actualMime),
      mime: actualMime,
      bytes,
    };
  });
  if (totalBytes > CHAT_IMAGE_MAX_TOTAL_BYTES) {
    throw new Error(backendText('session.image.totalTooLarge', language, { size: CHAT_IMAGE_MAX_TOTAL_BYTES / 1024 / 1024 }));
  }
  return validated;
}

function normalizeDisplayFilename(value: unknown, index: number, mime: ChatImageMime): string {
  const leaf = path.basename(String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim());
  return leaf.slice(0, 160) || `pasted-image-${index + 1}.${chatImageExtension(mime)}`;
}
