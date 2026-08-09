import type {
  UiCodeEditorAdapter,
  UiDesignerAdapterBundle,
  UiDesignerDocument,
  UiDesignerSaveResult,
  UiDesignerExportOptions,
  UiDesignerPersistenceAdapter,
  UiDesignerPreviewAdapter,
  UiDesignerProjectAdapter,
  UiDesignerProjectProfileResult,
  UiDesignerResourceAdapter,
  UiDesignerRuntimeAdapter,
  UiDesignerRuntimeStageResult,
  UiDesignerSceneDataReadResult,
  UiDesignerSceneDataReadRequest,
  UiDesignerResourceRequest,
  UiDesignerProjectCompatibility,
  UiFileResult,
  UiPreviewResult,
  UiProjectResourceCatalog,
  UiResourceEntry,
  UiRuntimeSceneExport,
  UiRuntimeDiagnostic,
  UiRuntimeStatus,
} from '@contract/ui-designer'
import { api } from '../../api/client'
import CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/addon/dialog/dialog.css'
import 'codemirror/addon/dialog/dialog'
import 'codemirror/addon/search/search'
import 'codemirror/addon/search/searchcursor'
import 'codemirror/addon/hint/show-hint'
import 'codemirror/addon/hint/show-hint.css'
import 'codemirror/addon/hint/javascript-hint'
import 'codemirror/addon/lint/lint'
import 'codemirror/addon/lint/lint.css'
import 'codemirror/addon/fold/foldcode'
import 'codemirror/addon/fold/foldgutter'
import 'codemirror/addon/fold/foldgutter.css'
import 'codemirror/addon/fold/brace-fold'
import 'codemirror/mode/javascript/javascript'

const unavailable = (message: string): UiFileResult<never> => ({ status: 'unavailable', message })

export const unavailableFileAdapter: UiDesignerPersistenceAdapter = {
  async open() {
    return unavailable('File adapter is not connected; editing remains in memory.')
  },
  async save() {
    return unavailable('File adapter is not connected; no source file was written.')
  },
  async saveAs() {
    return unavailable('File adapter is not connected; no source file was written.')
  },
  async revealSource() {
    return unavailable('File manager reveal is not connected.')
  },
  async listRecentFiles() {
    return unavailable('Recent-file adapter is not connected.')
  },
  async removeRecentFile() {
    return unavailable('Recent-file adapter is not connected.')
  },
  async listRecovery() {
    return unavailable('Recovery adapter is not connected.')
  },
  async readRecovery() {
    return unavailable('Recovery adapter is not connected.')
  },
  async clearRecovery() {
    return unavailable('Recovery adapter is not connected.')
  },
  async readPreferences() {
    return unavailable('Designer preferences adapter is not connected.')
  },
  async writePreferences() {
    return unavailable('Designer preferences adapter is not connected.')
  },
  async writeRecovery() {
    return unavailable('Recovery adapter is not connected.')
  },
  async exportRuntime() {
    return unavailable('Runtime export adapter is not connected; no file was written.')
  },
}

export const unavailableResourceAdapter: UiDesignerResourceAdapter = {
  async loadProject() {
    return unavailable('Resource adapter is not connected; no project catalog was loaded.')
  },
  async loadReferenced() {
    return unavailable('Resource adapter is not connected; referenced resources could not be resolved.')
  },
  async selectFrameFolder() {
    return unavailable('Resource adapter is not connected; no frame folder was selected.')
  },
  async readSceneData() {
    return unavailable('Scene data adapter is not connected; no Runtime scene was imported.')
  },
}

export const unavailableProjectAdapter: UiDesignerProjectAdapter = {
  async getProfile() {
    return unavailable('Project profile adapter is not connected; no project dimensions were loaded.')
  },
}

export const unavailableRuntimeAdapter: UiDesignerRuntimeAdapter = {
  async checkRuntime(): Promise<UiRuntimeStatus> {
    return { state: 'unknown', message: 'Runtime inspection adapter is not connected.' }
  },
  async installRuntime() {
    return unavailable('Runtime install adapter is not connected; no plugin files changed.')
  },
  async stageScene() {
    return unavailable('Runtime staging adapter is not connected; no project files changed.')
  },
}

function asResult<T>(value: unknown, fallbackMessage: string): UiFileResult<T> {
  if (value && typeof value === 'object') {
    const result = value as Record<string, unknown>
    const status = typeof result.status === 'string' ? result.status : 'error'
    return {
      status: ['idle', 'ready', 'busy', 'unavailable', 'success', 'error'].includes(status) ? status as UiFileResult<T>['status'] : 'error',
      value: result.value as T | undefined,
      path: typeof result.path === 'string' ? result.path : undefined,
      message: typeof result.message === 'string' ? result.message : fallbackMessage,
      operation: typeof result.operation === 'string' ? result.operation : undefined,
      code: typeof result.code === 'string' ? result.code : typeof (result.error as Record<string, unknown> | undefined)?.code === 'string' ? String((result.error as Record<string, unknown>).code) : undefined,
      recoverable: typeof result.recoverable === 'boolean' ? result.recoverable : typeof (result.error as Record<string, unknown> | undefined)?.recoverable === 'boolean' ? Boolean((result.error as Record<string, unknown>).recoverable) : undefined,
      choices: Array.isArray(result.choices) ? result.choices.filter((item): item is string => typeof item === 'string') : Array.isArray((result.error as Record<string, unknown> | undefined)?.choices) ? ((result.error as Record<string, unknown>).choices as unknown[]).filter((item): item is string => typeof item === 'string') : undefined,
      error: result.error as UiFileResult<T>['error'],
      affectedFiles: Array.isArray(result.affectedFiles) ? result.affectedFiles.filter((item): item is string => typeof item === 'string') : undefined,
      digest: typeof result.digest === 'string' ? result.digest : undefined,
      mtimeMs: typeof result.mtimeMs === 'number' ? result.mtimeMs : undefined,
    }
  }
  return { status: 'error', message: fallbackMessage }
}

function asSaveResult<T>(value: unknown, fallbackMessage: string): UiDesignerSaveResult<T> {
  const result = asResult<T>(value, fallbackMessage) as UiDesignerSaveResult<T>
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    result.metadata = raw.metadata as UiDesignerSaveResult<T>['metadata']
    result.conflict = raw.conflict as UiDesignerSaveResult<T>['conflict']
    result.recoveryId = typeof raw.recoveryId === 'string' ? raw.recoveryId : undefined
    result.sourcePath = typeof raw.sourcePath === 'string' ? raw.sourcePath : result.path
  }
  return result
}

function asPreviewResult(value: unknown, fallbackMessage: string): UiPreviewResult {
  if (value && typeof value === 'object') {
    const result = value as Record<string, unknown>
    const state = typeof result.state === 'string' && ['idle', 'unavailable', 'preparing', 'running', 'stopped', 'error'].includes(result.state) ? result.state as UiPreviewResult['state'] : 'error'
    return {
      state,
      message: typeof result.message === 'string' ? result.message : fallbackMessage,
      sessionId: typeof result.sessionId === 'string' ? result.sessionId : undefined,
      temporaryPath: typeof result.temporaryPath === 'string' ? result.temporaryPath : undefined,
      sourceProject: typeof result.sourceProject === 'string' ? result.sourceProject : undefined,
      stagingSummary: result.stagingSummary && typeof result.stagingSummary === 'object' ? result.stagingSummary as UiPreviewResult['stagingSummary'] : undefined,
      cleanup: result.cleanup && typeof result.cleanup === 'object' ? result.cleanup as UiPreviewResult['cleanup'] : undefined,
      runner: result.runner && typeof result.runner === 'object' ? result.runner as UiPreviewResult['runner'] : undefined,
      diagnostics: normalizePreviewDiagnostics(result.diagnostics),
      projectCompatibility: result.projectCompatibility && typeof result.projectCompatibility === 'object' ? result.projectCompatibility as UiDesignerProjectCompatibility : undefined,
    }
  }
  return { state: 'error', message: fallbackMessage }
}

function normalizePreviewDiagnostics(value: unknown): UiRuntimeDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const nullableString = (candidate: unknown) => candidate === null || typeof candidate === 'string' ? candidate : undefined
    const scene = nullableString(raw.scene)
    const file = nullableString(raw.file)
    const node = nullableString(raw.node)
    const type = nullableString(raw.type)
    const phase = nullableString(raw.phase)
    const event = nullableString(raw.event)
    if (raw.schemaVersion !== '1.0.0' || typeof raw.sessionId !== 'string' || scene === undefined || file === undefined || node === undefined || type === undefined || phase === undefined || event === undefined || typeof raw.code !== 'string' || (raw.severity !== 'error' && raw.severity !== 'warning') || typeof raw.label !== 'string' || typeof raw.message !== 'string' || !Number.isInteger(raw.count) || Number(raw.count) < 1) return []
    return [{ schemaVersion: '1.0.0', sessionId: raw.sessionId, scene, file, node, type, phase, event, code: raw.code, severity: raw.severity, label: raw.label, message: raw.message, count: Number(raw.count) } satisfies UiRuntimeDiagnostic]
  })
}

function unwrapRuntimeResult(result: UiFileResult<unknown>): UiFileResult<UiDesignerRuntimeStageResult> {
  const value = result.value
  if (value && typeof value === 'object' && 'runtime' in value) {
    const stage = value as Partial<UiDesignerRuntimeStageResult> & { runtime?: UiRuntimeStatus }
    if (!stage.runtime || typeof stage.digest !== 'string' || !Array.isArray(stage.affectedFiles)) return { ...result, status: 'error', value: undefined, message: 'Runtime staging result is incomplete.' }
    return {
      ...result,
      value: {
        status: stage.status === 'staged' ? 'staged' : 'staged',
        affectedFiles: stage.affectedFiles.filter((item): item is string => typeof item === 'string'),
        runtime: stage.runtime,
        sceneRelativePath: typeof stage.sceneRelativePath === 'string' ? stage.sceneRelativePath : undefined,
        digest: stage.digest,
        transaction: stage.transaction,
      },
      affectedFiles: result.affectedFiles ?? stage.affectedFiles,
      digest: result.digest ?? stage.digest,
    }
  }
  return { ...result, status: result.status === 'success' ? 'error' : result.status, value: undefined, message: result.message || 'Runtime staging result is incomplete.' }
}

export function createDesktopUiDesignerAdapters(projectPath?: string, lifecycle?: UiDesignerAdapterBundle['lifecycle']): UiDesignerAdapterBundle {
  const file: UiDesignerPersistenceAdapter = {
    async open(request) { return asSaveResult(await api.uiDesigner.open(request), 'The UI designer source file could not be opened.') },
    async save(document, request) { return asSaveResult(await api.uiDesigner.save(request ?? {}, document), 'The UI designer source file could not be saved.') },
    async saveAs(document, request) { return asSaveResult(await api.uiDesigner.saveAs(request ?? {}, document), 'The UI designer source file could not be saved as.') },
    async revealSource(sourcePath) { return asResult(await api.uiDesigner.revealSource(sourcePath), 'The source file could not be revealed.') },
    async listRecentFiles() { return asResult(await api.uiDesigner.listRecentFiles(), 'Recent UI designer files are unavailable.') },
    async removeRecentFile(path) { return asResult(await api.uiDesigner.removeRecentFile(path), 'The recent UI designer file record could not be removed.') },
    async writeRecovery(document, request) { return asResult(await api.uiDesigner.writeRecovery({ document, ...request }), 'The recovery snapshot could not be written.') },
    async listRecovery() { return asResult(await api.uiDesigner.listRecovery(), 'Recovery snapshots are unavailable.') },
    async readRecovery(id) { return asResult(await api.uiDesigner.readRecovery(id), 'The recovery snapshot could not be read.') },
    async clearRecovery(id) { return asResult(await api.uiDesigner.clearRecovery(id), 'The recovery snapshot could not be cleared.') },
    async readPreferences() { return asResult(await api.uiDesigner.readPreferences(), 'Designer preferences are unavailable.') },
    async writePreferences(value) { return asResult(await api.uiDesigner.writePreferences(value), 'Designer preferences could not be saved.') },
    async exportRuntime(scene, request) { return asResult(await api.uiDesigner.exportRuntime({ scene, ...request }), 'The runtime JSON could not be exported.') },
  }
  const resource: UiDesignerResourceAdapter = {
    async loadProject(request?: UiDesignerResourceRequest) { return asResult(await api.uiDesigner.listResources({ ...request, project: projectPath }), 'Project resources are unavailable.') as UiFileResult<UiProjectResourceCatalog> },
    async loadReferenced(request) { return asResult(await api.uiDesigner.listResourceReferences({ ...request, project: projectPath }), 'Referenced project resources are unavailable.') as UiFileResult<UiProjectResourceCatalog> },
    async selectFrameFolder() { return asResult<UiResourceEntry[]>(await api.uiDesigner.selectFrameFolder({ project: projectPath }), 'Frame folder selection failed.') },
    async readSceneData(request: UiDesignerSceneDataReadRequest) { return asResult<UiDesignerSceneDataReadResult>(await api.uiDesigner.readSceneData({ project: projectPath, path: request.path }), 'Scene data import failed.') },
  }
  const project: UiDesignerProjectAdapter = {
    async getProfile(request) {
      const profileRequest = projectPath ? { ...request, project: projectPath } : request
      return asResult<UiDesignerProjectProfileResult>(await api.uiDesigner.getProjectProfile(profileRequest), 'Project profile inspection failed.')
    },
  }
  const runtime: UiDesignerRuntimeAdapter = {
    async checkRuntime() { const result = asResult<UiRuntimeStatus>(await api.uiDesigner.checkRuntime({ project: projectPath }), 'Runtime inspection failed.'); return result.value ?? { state: 'error', message: result.message } },
    async installRuntime(_project, options) { return unwrapRuntimeResult(asResult(await api.uiDesigner.installRuntime({ project: projectPath, ...options }), 'Runtime installation could not be staged.')) },
    async stageScene(_project, scene, options) { return unwrapRuntimeResult(asResult(await api.uiDesigner.stageScene({ project: projectPath, scene, ...options }), 'Runtime scene staging failed.')) },
  }
  const preview: UiDesignerPreviewAdapter = {
    async start(scene, project) { return asPreviewResult(await api.uiDesigner.startPreview({ project, scene }), 'The isolated game preview could not be started.') },
    async current() { return asPreviewResult(await api.uiDesigner.currentPreview(), 'The isolated game preview status is unavailable.') },
    async stop(sessionId) { return asPreviewResult(await api.uiDesigner.stopPreview(sessionId), 'The isolated game preview could not be stopped.') },
  }
  return { file, project, resource, runtime, preview, code: codeMirrorAdapter, lifecycle }
}

export const unavailablePreviewAdapter: UiDesignerPreviewAdapter = {
  async start(): Promise<UiPreviewResult> {
    return { state: 'unavailable', message: 'Game preview adapter is not connected; the game was not started.' }
  },
  async current(): Promise<UiPreviewResult> {
    return { state: 'unavailable', message: 'Game preview adapter is not connected.' }
  },
  async stop(): Promise<UiPreviewResult> {
    return { state: 'unavailable', message: 'Game preview adapter is not connected.' }
  },
}

export const codeMirrorAdapter: UiCodeEditorAdapter = {
  available: true,
  label: 'CodeMirror 5 JavaScript editor',
  mount(element, options) {
    const textarea = document.createElement('textarea')
    textarea.value = options.value
    element.appendChild(textarea)
    const vocabulary = ['$gameVariables', '$gameSwitches', '$gameParty', '$gameActors', '$gamePlayer', 'SceneManager', 'Graphics', 'Input', 'AudioManager', ...(options.completionItems ?? [])]
    const hint = (instance: CodeMirror.Editor) => {
      const cursor = instance.getCursor()
      const line = instance.getLine(cursor.line)
      const start = cursor.ch
      const match = line.slice(0, start).match(/[A-Za-z_$][\w$]*$/)
      const from = CodeMirror.Pos(cursor.line, match ? start - match[0].length : start)
      const token = match?.[0].toLowerCase() ?? ''
      return { list: vocabulary.filter((item) => item.toLowerCase().startsWith(token)), from, to: CodeMirror.Pos(cursor.line, start) }
    }
    const marker = (message: string) => {
      const mark = document.createElement('span')
      mark.className = 'ui-designer-code-error'
      mark.textContent = '●'
      mark.title = message
      return mark
    }
    const editor = CodeMirror.fromTextArea(textarea, {
      value: options.value,
      mode: options.mode,
      lineNumbers: options.lineNumbers,
      foldGutter: options.foldGutter,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      extraKeys: {
        'Ctrl-F': 'findPersistent',
        'Cmd-F': 'findPersistent',
        'Ctrl-H': 'replace',
        'Cmd-H': 'replace',
        'Ctrl-Space': (instance) => instance.showHint({ hint }),
        'Cmd-Space': (instance) => instance.showHint({ hint }),
        'Ctrl-Shift-F': (instance) => instance.execCommand('selectAll'),
      },
      gutters: options.foldGutter ? ['CodeMirror-linenumbers', 'CodeMirror-lint-markers', 'CodeMirror-foldgutter'] : ['CodeMirror-linenumbers', 'CodeMirror-lint-markers'],
    })
    const lint = () => {
      editor.clearGutter('CodeMirror-lint-markers')
      try { Function(editor.getValue()) } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const lineMatch = message.match(/line\s+(\d+)/i)
        const line = Math.max(0, (lineMatch ? Number(lineMatch[1]) : 1) - 1)
        editor.setGutterMarker(Math.min(line, Math.max(0, editor.lineCount() - 1)), 'CodeMirror-lint-markers', marker(message))
      }
    }
    const onChange = () => { options.onChange(editor.getValue()); lint() }
    editor.on('change', onChange)
    lint()
    return {
      getValue: () => editor.getValue(),
      setValue: (value: string) => editor.setValue(value),
      focus: () => editor.focus(),
      format: () => editor.execCommand('indentAuto'),
      dispose: () => {
        editor.off('change', onChange)
        editor.toTextArea()
        element.innerHTML = ''
      },
    }
  },
}

export function createUiDesignerAdapters(overrides: UiDesignerAdapterBundle = {}): Required<Pick<UiDesignerAdapterBundle, 'file' | 'project' | 'resource' | 'runtime' | 'preview' | 'code'>> & Pick<UiDesignerAdapterBundle, 'lifecycle'> {
  return {
    file: overrides.file ?? unavailableFileAdapter,
    project: overrides.project ?? unavailableProjectAdapter,
    resource: overrides.resource ?? unavailableResourceAdapter,
    runtime: overrides.runtime ?? unavailableRuntimeAdapter,
    preview: overrides.preview ?? unavailablePreviewAdapter,
    code: overrides.code ?? codeMirrorAdapter,
    lifecycle: overrides.lifecycle,
  }
}

export interface UiDesignerAdapterContext {
  projectPath?: string
  document: UiDesignerDocument
  runtimeExport?: UiRuntimeSceneExport
  options?: UiDesignerExportOptions
}

export type UiDesignerResourceLoadResult = UiFileResult<UiProjectResourceCatalog> | null
