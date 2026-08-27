import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_EDITOR_VERSION,
  UI_DESIGNER_RUNTIME_VERSION,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiDesignerDocument,
  type UiRuntimeSceneExport,
  type UiSceneScript,
} from './ui-designer.ts'

export const UI_DESIGNER_LEGACY_DOCUMENT_VERSION = '1.0.0' as const
export const UI_DESIGNER_LEGACY_EDITOR_VERSION = '1.0.0' as const
export const UI_DESIGNER_LEGACY_SCENE_SCRIPT_VERSION = '1.0.0' as const

export const UI_DESIGNER_SCRIPT_ARGUMENTS = [
  'runtime',
  'context',
  'node',
  'props',
  'event',
  'self',
  'scene',
  '$sw',
  '$var',
  '$setSw',
  '$setVar',
  '$global',
] as const

export const UI_DESIGNER_NODE_SCRIPT_COMPLETIONS = [
  ...UI_DESIGNER_SCRIPT_ARGUMENTS,
  'nodes',
  'getNode',
  'showNode',
  'hideNode',
  'setNodeProp',
  'tween',
  'focusNode',
  'blurNode',
] as const

export const UI_DESIGNER_SCENE_SCRIPT_COMPLETIONS = [
  ...UI_DESIGNER_NODE_SCRIPT_COMPLETIONS,
  'scene.onReady',
  'scene.onUpdate',
] as const

export interface UiLegacySourceCode {
  ready: string
  update: string
}

export class UiDesignerScriptMigrationError extends Error {
  readonly code = 'UI_DESIGNER_SCRIPT_MIGRATION'

  constructor(message: string) {
    super(message)
    this.name = 'UiDesignerScriptMigrationError'
  }
}

/**
 * Convert the legacy two-body contract into one executable scene script.
 * The callbacks retain the legacy invocation arguments, `this`, `arguments`,
 * and `return` behavior when the runtime invokes them with `Function#apply`.
 */
export function migrateLegacyUiSourceCode(code: UiLegacySourceCode): string {
  return [
    'scene.onReady(function () {',
    code.ready,
    '});',
    '',
    'scene.onUpdate(function ({ frame, deltaMs }) {',
    code.update,
    '});',
    '',
  ].join('\n')
}

/** Compile the one-file registration program without executing user code. */
export function uiSceneScriptSyntaxError(source: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    Function(...UI_DESIGNER_SCRIPT_ARGUMENTS, source)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Rewrite the reserved v1.0 lifecycle identifiers without touching strings or
 * comments. v1.0 reserved these two names for Runtime registration, so a
 * successful compile after rewriting is the compatibility boundary for old
 * one-file scripts.
 */
export function canonicalizeLegacySceneScriptSource(source: string): string {
  let output = ''
  let index = 0
  let state: 'code' | 'single' | 'double' | 'template' | 'regex' | 'line-comment' | 'block-comment' = 'code'
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      output += current
      index += 1
      if (current === '\n') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      output += current
      index += 1
      if (current === '*' && next === '/') { output += next; index += 1; state = 'code' }
      continue
    }
    if (state !== 'code') {
      output += current
      index += 1
      if (current === '\\' && index < source.length) { output += source[index]; index += 1; continue }
      if ((state === 'single' && current === "'") || (state === 'double' && current === '"') || (state === 'template' && current === '`') || (state === 'regex' && current === '/')) state = 'code'
      continue
    }
    if (current === '/' && next === '/') { output += '//'; index += 2; state = 'line-comment'; continue }
    if (current === '/' && next === '*') { output += '/*'; index += 2; state = 'block-comment'; continue }
    if (current === '/') {
      const previous = source.slice(0, index).match(/\S(?=\s*$)/)?.[0]
      if (!previous || /[({\[=,:;!&|?+\-*%^~<>]/.test(previous)) { output += current; index += 1; state = 'regex'; continue }
    }
    if (current === "'") { output += current; index += 1; state = 'single'; continue }
    if (current === '"') { output += current; index += 1; state = 'double'; continue }
    if (current === '`') { output += current; index += 1; state = 'template'; continue }
    const lifecycle = source.startsWith('onReady', index) ? 'onReady' : source.startsWith('onUpdate', index) ? 'onUpdate' : undefined
    if (lifecycle) {
      const before = source[index - 1] ?? ''
      const after = source[index + lifecycle.length] ?? ''
      if (!/[\w$]/.test(before) && before !== '.' && !/[\w$]/.test(after)) {
        output += `scene.${lifecycle}`
        index += lifecycle.length
        continue
      }
    }
    output += current
    index += 1
  }
  const error = uiSceneScriptSyntaxError(output)
  if (error) throw new UiDesignerScriptMigrationError(`Legacy sceneScript could not be canonicalized: ${error}`)
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalSceneScript(value: unknown): UiSceneScript {
  if (!isRecord(value) || typeof value.source !== 'string') {
    throw new UiDesignerScriptMigrationError('sceneScript must contain a supported version and a string source.')
  }
  if (value.version === UI_DESIGNER_SCENE_SCRIPT_VERSION) return { version: UI_DESIGNER_SCENE_SCRIPT_VERSION, source: value.source }
  if (value.version === UI_DESIGNER_LEGACY_SCENE_SCRIPT_VERSION) {
    return { version: UI_DESIGNER_SCENE_SCRIPT_VERSION, source: canonicalizeLegacySceneScriptSource(value.source) }
  }
  throw new UiDesignerScriptMigrationError(`Unsupported sceneScript version: ${String(value.version)}.`)
}

function legacySourceCode(value: unknown): UiLegacySourceCode {
  if (!isRecord(value) || typeof value.ready !== 'string' || typeof value.update !== 'string') {
    throw new UiDesignerScriptMigrationError('Legacy code must contain string ready and update bodies.')
  }
  return { ready: value.ready, update: value.update }
}

function migrateRecord<T extends Record<string, unknown>>(value: T, editorDocument: boolean): T {
  const hasSceneScript = Object.prototype.hasOwnProperty.call(value, 'sceneScript')
  const hasLegacyCode = Object.prototype.hasOwnProperty.call(value, 'code')
  if (hasSceneScript && hasLegacyCode) {
    throw new UiDesignerScriptMigrationError('A UI designer record cannot contain both sceneScript and legacy code.')
  }

  const next = { ...value } as T & {
    version?: unknown
    editorVersion?: unknown
    sceneScript?: UiSceneScript
    code?: unknown
  }

  if (value.version === UI_DESIGNER_DOCUMENT_VERSION) {
    if (editorDocument && value.editorVersion !== UI_DESIGNER_EDITOR_VERSION) {
      throw new UiDesignerScriptMigrationError(`Unsupported UI designer editor version: ${String(value.editorVersion)}.`)
    }
    if (!hasSceneScript || hasLegacyCode) {
      throw new UiDesignerScriptMigrationError(`UI designer ${UI_DESIGNER_DOCUMENT_VERSION} records require sceneScript and cannot contain legacy code.`)
    }
    next.sceneScript = canonicalSceneScript(value.sceneScript)
    delete next.code
    return next
  }

  if (value.version !== UI_DESIGNER_LEGACY_DOCUMENT_VERSION) {
    throw new UiDesignerScriptMigrationError(`Unsupported UI designer document version: ${String(value.version)}.`)
  }
  if (editorDocument && value.editorVersion !== UI_DESIGNER_LEGACY_EDITOR_VERSION) {
    throw new UiDesignerScriptMigrationError(`Unsupported legacy UI designer editor version: ${String(value.editorVersion)}.`)
  }
  if (!hasLegacyCode || hasSceneScript) {
    throw new UiDesignerScriptMigrationError(`Legacy UI designer ${UI_DESIGNER_LEGACY_DOCUMENT_VERSION} records require code.ready and code.update.`)
  }

  next.version = UI_DESIGNER_DOCUMENT_VERSION
  if (editorDocument) next.editorVersion = UI_DESIGNER_EDITOR_VERSION
  next.sceneScript = {
    version: UI_DESIGNER_SCENE_SCRIPT_VERSION,
    source: migrateLegacyUiSourceCode(legacySourceCode(value.code)),
  }
  delete next.code
  return next
}

/** Canonicalize a persisted editor document without mutating the input. */
export function migrateUiDesignerDocument(value: unknown): unknown {
  if (!isRecord(value)) return value
  return migrateRecord(value, true)
}

/** Canonicalize a runtime scene export without mutating the input. */
export function migrateUiRuntimeSceneExport(value: unknown): unknown {
  if (!isRecord(value)) return value
  const legacy = value.version === UI_DESIGNER_LEGACY_DOCUMENT_VERSION
  const migrated = migrateRecord(value, false) as Record<string, unknown>
  delete migrated.editorVersion
  delete migrated.canvas
  delete migrated.guides
  if (!legacy) return migrated
  if (value.runtimeVersion !== '>=1.0.0') {
    throw new UiDesignerScriptMigrationError(`Unsupported legacy UI designer runtime version: ${String(value.runtimeVersion)}.`)
  }
  return { ...migrated, runtimeVersion: UI_DESIGNER_RUNTIME_VERSION }
}

export function canonicalUiDesignerDocument(value: unknown): UiDesignerDocument {
  return migrateUiDesignerDocument(value) as UiDesignerDocument
}

export function canonicalUiRuntimeSceneExport(value: unknown): UiRuntimeSceneExport {
  return migrateUiRuntimeSceneExport(value) as UiRuntimeSceneExport
}
