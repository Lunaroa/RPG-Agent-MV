import { File } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  ChatImageValidationError,
  revokeDraftChatImage,
  validatePastedImageBatch,
} from './chatImageAttachments'

function file(name: string, mime: string, bytes: number[]): globalThis.File {
  return new File([Uint8Array.from(bytes)], name, { type: mime }) as unknown as globalThis.File
}

const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('chat image paste validation', () => {
  it('keeps valid pasted image order and creates previews', async () => {
    const drafts = await validatePastedImageBatch([
      file('one.png', 'image/png', pngBytes),
      file('two.gif', 'image/gif', [...Buffer.from('GIF89a')]),
    ], [])
    expect(drafts.map((item) => item.filename)).toEqual(['one.png', 'two.gif'])
    expect(drafts.every((item) => item.previewUrl.startsWith('blob:'))).toBe(true)
    drafts.forEach(revokeDraftChatImage)
  })

  it('rejects a forged MIME as one atomic batch', async () => {
    await expect(validatePastedImageBatch([
      file('valid.png', 'image/png', pngBytes),
      file('forged.jpg', 'image/jpeg', pngBytes),
    ], [])).rejects.toMatchObject<Partial<ChatImageValidationError>>({ code: 'format' })
  })

  it('rejects the fifth image without truncating the batch', async () => {
    const existing = await validatePastedImageBatch([
      file('one.png', 'image/png', pngBytes),
      file('two.png', 'image/png', pngBytes),
      file('three.png', 'image/png', pngBytes),
      file('four.png', 'image/png', pngBytes),
    ], [])
    await expect(validatePastedImageBatch([
      file('five.png', 'image/png', pngBytes),
    ], existing)).rejects.toMatchObject<Partial<ChatImageValidationError>>({ code: 'count' })
    existing.forEach(revokeDraftChatImage)
  })
})
