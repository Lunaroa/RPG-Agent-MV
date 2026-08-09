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

const LEGACY_LIFECYCLE_ARGUMENTS = 'runtime, context, node, props, event, self, scene, $sw, $var, $setSw, $setVar'

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
    `onReady(function (${LEGACY_LIFECYCLE_ARGUMENTS}) {`,
    code.ready,
    '});',
    '',
    `onUpdate(function (${LEGACY_LIFECYCLE_ARGUMENTS}) {`,
    code.update,
    '});',
    '',
  ].join('\n')
}

/** Compile the one-file registration program without executing user code. */
export function uiSceneScriptSyntaxError(source: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    Function('onReady', 'onUpdate', source)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalSceneScript(value: unknown): UiSceneScript {
  if (!isRecord(value) || value.version !== UI_DESIGNER_SCENE_SCRIPT_VERSION || typeof value.source !== 'string') {
    throw new UiDesignerScriptMigrationError(`sceneScript must contain version ${UI_DESIGNER_SCENE_SCRIPT_VERSION} and a string source.`)
  }
  return { version: UI_DESIGNER_SCENE_SCRIPT_VERSION, source: value.source }
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
