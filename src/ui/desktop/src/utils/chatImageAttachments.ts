import {
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MAX_FILE_BYTES,
  CHAT_IMAGE_MAX_TOTAL_BYTES,
  detectChatImageMime,
  isChatImageMime,
} from '@contract/chat-image-attachments'
import type { SessionImageAttachmentInput } from '@contract/types'

export interface DraftChatImage {
  id: string
  file: File
  filename: string
  mime: string
  sizeBytes: number
  previewUrl: string
}

export type ChatImageValidationCode =
  | 'count'
  | 'format'
  | 'corrupt'
  | 'fileSize'
  | 'totalSize'

export class ChatImageValidationError extends Error {
  readonly code: ChatImageValidationCode

  constructor(code: ChatImageValidationCode) {
    super(code)
    this.code = code
  }
}

export async function validatePastedImageBatch(
  files: File[],
  existing: DraftChatImage[],
): Promise<DraftChatImage[]> {
  if (existing.length + files.length > CHAT_IMAGE_MAX_COUNT) throw new ChatImageValidationError('count')
  const total = existing.reduce((sum, item) => sum + item.sizeBytes, 0)
    + files.reduce((sum, item) => sum + item.size, 0)
  if (total > CHAT_IMAGE_MAX_TOTAL_BYTES) throw new ChatImageValidationError('totalSize')

  const validated: Array<{ file: File; mime: string }> = []
  for (const file of files) {
    if (!isChatImageMime(file.type)) throw new ChatImageValidationError('format')
    if (file.size > CHAT_IMAGE_MAX_FILE_BYTES) throw new ChatImageValidationError('fileSize')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const actualMime = detectChatImageMime(bytes)
    if (!actualMime) throw new ChatImageValidationError('corrupt')
    if (actualMime !== file.type.toLowerCase()) throw new ChatImageValidationError('format')
    validated.push({ file, mime: actualMime })
  }

  return validated.map(({ file, mime }, index) => ({
    id: crypto.randomUUID(),
    file,
    filename: file.name || `pasted-image-${existing.length + index + 1}.${extensionForMime(mime)}`,
    mime,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
  }))
}

export async function serializeDraftChatImages(images: DraftChatImage[]): Promise<SessionImageAttachmentInput[]> {
  return Promise.all(images.map(async (image) => ({
    clientId: image.id,
    filename: image.filename,
    mime: image.mime,
    sizeBytes: image.sizeBytes,
    dataBase64: await fileToBase64(image.file),
  })))
}

export function nativeClipboardImageToFile(payload: {
  filename: string
  mime: string
  dataBase64: string
}): File {
  const binary = atob(payload.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], payload.filename || 'pasted-image.png', { type: payload.mime })
}

export function revokeDraftChatImage(image: DraftChatImage): void {
  URL.revokeObjectURL(image.previewUrl)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Failed to read pasted image.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('Failed to encode pasted image.'))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  return mime.slice('image/'.length)
}
