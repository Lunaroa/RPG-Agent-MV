export type PluginDropItem = {
  name: string
  isDirectory: boolean
  absolutePath: string | null
}

export type PluginDropRejectionReason = 'directory' | 'not-js' | 'path-unresolved'

export type PluginDropPlan = {
  sourceFiles: string[]
  rejections: Array<{ name: string; reason: PluginDropRejectionReason }>
}

export function planDroppedPluginFiles(items: readonly PluginDropItem[]): PluginDropPlan {
  const sourceFiles: string[] = []
  const rejections: PluginDropPlan['rejections'] = []
  for (const item of items) {
    if (item.isDirectory) {
      rejections.push({ name: item.name, reason: 'directory' })
      continue
    }
    if (!/\.js$/i.test(item.name)) {
      rejections.push({ name: item.name, reason: 'not-js' })
      continue
    }
    const absolutePath = String(item.absolutePath || '').trim()
    if (!absolutePath) {
      rejections.push({ name: item.name, reason: 'path-unresolved' })
      continue
    }
    sourceFiles.push(absolutePath)
  }
  return { sourceFiles, rejections }
}

export function isExternalFileDrag(event: Pick<DragEvent, 'dataTransfer'>): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}
