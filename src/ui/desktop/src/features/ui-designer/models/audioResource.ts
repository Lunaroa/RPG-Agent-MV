import { normalizeUiDesignerProjectRelativeResourcePath } from '../../../../../../contract/ui-designer-resources.ts'

const SE_EXTENSION = /\.(?:ogg|m4a)$/i

/** Converts a managed project resource into the extensionless name expected by AudioManager.playSe. */
export function uiDesignerSeNameFromResourcePath(value: string): string {
  const normalized = normalizeUiDesignerProjectRelativeResourcePath(value).replace(/^www\//i, '')
  if (!normalized.toLowerCase().startsWith('audio/se/') || !SE_EXTENSION.test(normalized)) {
    throw new Error('UI Designer play sound actions require an .ogg or .m4a resource below audio/se/.')
  }
  const name = normalized.slice('audio/se/'.length).replace(SE_EXTENSION, '')
  if (!name) throw new Error('UI Designer play sound actions require a named SE resource.')
  return name
}
