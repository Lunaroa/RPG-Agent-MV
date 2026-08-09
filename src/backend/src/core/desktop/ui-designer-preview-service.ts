import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  UiDesignerProjectCompatibility,
  UiPreviewResult,
  UiRuntimeDiagnostic,
  UiRuntimeSceneExport,
} from '../../../../contract/ui-designer.ts'
import { canonicalUiRuntimeSceneExport } from '../../../../contract/ui-designer-script.ts'
import { inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts'
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts'
import { bundledUiDesignerRuntime } from './ui-designer-runtime-service.ts'
import { validateUiRuntimeSceneExport } from './ui-designer-validation.ts'
import { uiDesignerProjectCompatibility } from './ui-designer-compatibility.ts'

export interface UiDesignerPreviewStartOptions {
  temporaryPrefix?: string
}

/**
 * The preview service owns the isolated copy, but the interactive playtest
 * service owns the real MV/MZ process lifecycle.  Keeping this boundary
 * explicit prevents a staged copy from being reported as a running preview.
 */
export interface UiDesignerPreviewLauncher {
  start(projectRoot: string, options?: { sessionId?: string }): Promise<{
    run?: { runId?: string; sessionId?: string; status?: string; error?: string }
    error?: string
    confirmationRequired?: boolean
  }>
  stop(runId?: string): Promise<{ error?: string; run?: { runId?: string; sessionId?: string; status?: string; error?: string } }>
  current(sessionId?: string): Promise<{ error?: string; run?: { runId?: string; sessionId?: string; status?: string; error?: string } }>
}

export interface UiDesignerPreviewPreparationFactory {
  (workflowRoot: string, project: string, temporaryPrefix?: string): Promise<IsolatedProjectPreparation> | IsolatedProjectPreparation
}

export interface UiDesignerPreviewSession {
  sessionId: string
  workflowRoot: string
  sourceProject: string
  temporaryProject: string
  stagingSummary: { affectedFiles: string[]; sourceDigest: string }
  preparation: IsolatedProjectPreparation
  runnerId: string
  projectCompatibility: UiDesignerProjectCompatibility
  /** Canonical path inside temporaryProject; never resolved from renderer input. */
  diagnosticsPath: string
}

export class UiDesignerPreviewBusyError extends Error {
  readonly code = 'UI_DESIGNER_PREVIEW_BUSY'
  readonly recoverable = true

  constructor() {
    super('UI designer isolated preview is already running. Stop it before starting another preview.')
    this.name = 'UiDesignerPreviewBusyError'
  }
}

export class UiDesignerPreviewUnavailableError extends Error {
  readonly code = 'UI_DESIGNER_PREVIEW_LAUNCHER_UNAVAILABLE'
  readonly recoverable = true

  constructor(detail?: string) {
    super(detail || 'An MV/MZ interactive playtest runner is required before the isolated UI designer preview can start.')
    this.name = 'UiDesignerPreviewUnavailableError'
  }
}

export class UiDesignerPreviewSceneConflictError extends Error {
  readonly code = 'UI_DESIGNER_PREVIEW_SCENE_CONFLICT'
  readonly recoverable = true

  constructor(sceneName: string) {
    super(`The requested UI preview scene name is reserved by the MV/MZ engine: ${sceneName}. Choose a different Scene_* name.`)
    this.name = 'UiDesignerPreviewSceneConflictError'
  }
}

const RESERVED_ENGINE_SCENE_NAMES = new Set([
  'Scene_Base', 'Scene_Boot', 'Scene_Title', 'Scene_Map', 'Scene_MenuBase', 'Scene_Menu', 'Scene_ItemBase',
  'Scene_Item', 'Scene_Skill', 'Scene_Equip', 'Scene_Status', 'Scene_Options', 'Scene_File', 'Scene_Save',
  'Scene_Load', 'Scene_GameEnd', 'Scene_Shop', 'Scene_Name', 'Scene_Debug', 'Scene_Battle', 'Scene_Gameover',
  'Scene_Message', 'Scene_Directory',
])

export const UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION = '1.0.0' as const
export const UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH = 'js/plugins/mzui-data/.ui-designer-diagnostics.jsonl'
const PREVIEW_DIAGNOSTICS_MAX_BYTES = 256 * 1024
const PREVIEW_DIAGNOSTICS_MAX_LINE_BYTES = 8 * 1024
const PREVIEW_DIAGNOSTICS_MAX_ENTRIES = 64
const PREVIEW_DIAGNOSTIC_FIELD_LIMIT = 1024

export class UiDesignerPreviewService {
  private active: UiDesignerPreviewSession | null = null
  private preparing = false
  private launcher: UiDesignerPreviewLauncher | null
  private prepareIsolated: UiDesignerPreviewPreparationFactory

  constructor(launcher?: UiDesignerPreviewLauncher, prepareIsolated?: UiDesignerPreviewPreparationFactory) {
    this.launcher = launcher || null
    this.prepareIsolated = prepareIsolated || ((workflowRoot, project, temporaryPrefix) => prepareIsolatedStagedProject(workflowRoot, project, {
      temporaryPrefix,
      // UI designer scenes execute arbitrary project code, so every asset
      // directory must be physically copied rather than junctioned.
      physicalCopyAllProjectDirectories: true,
    }))
  }

  setLauncher(launcher: UiDesignerPreviewLauncher): void {
    this.launcher = launcher
  }

  setPreparationFactory(factory: UiDesignerPreviewPreparationFactory): void {
    this.prepareIsolated = factory
  }

  async start(
    workflowRootInput: string,
    projectInput: string,
    scene: UiRuntimeSceneExport,
    options: UiDesignerPreviewStartOptions = {},
  ): Promise<UiPreviewResult & { session?: UiDesignerPreviewSession }> {
    if (this.active || this.preparing) throw new UiDesignerPreviewBusyError()
    if (!this.launcher) throw new UiDesignerPreviewUnavailableError()
    const report = validateUiRuntimeSceneExport(scene)
    if (!report.valid) throw new Error(`UI preview scene validation failed: ${report.errors.map((issue) => issue.message).join('; ')}`)
    scene = canonicalUiRuntimeSceneExport(scene)
    if (RESERVED_ENGINE_SCENE_NAMES.has(scene.meta.sceneName)) throw new UiDesignerPreviewSceneConflictError(scene.meta.sceneName)
    const projectCompatibility = uiDesignerProjectCompatibility(inspectRmmvProject(path.resolve(projectInput)))
    this.preparing = true
    let preparation: IsolatedProjectPreparation
    try {
      preparation = await this.prepareIsolated(
        workflowRootInput,
        projectInput,
        options.temporaryPrefix || 'ui-designer-preview-',
      )
    } finally {
      this.preparing = false
    }
    const sessionId = crypto.randomUUID()
    let session: UiDesignerPreviewSession | null = null
    try {
      const staged = stagePreviewFiles(preparation.temporaryProject, scene, sessionId)
      session = {
        sessionId,
        workflowRoot: path.resolve(workflowRootInput),
        sourceProject: preparation.sourceProject,
        temporaryProject: preparation.temporaryProject,
        stagingSummary: { affectedFiles: staged.affectedFiles, sourceDigest: preparation.sourceFingerprint },
        preparation,
        runnerId: '',
        projectCompatibility,
        diagnosticsPath: staged.diagnosticsPath,
      }
      this.active = session
      const launch = await this.launcher.start(preparation.temporaryProject, { sessionId })
      const launchSessionMatches = !launch.run?.sessionId || launch.run.sessionId === sessionId
      const runnerId = launchSessionMatches ? String(launch.run?.runId || '') : ''
      if (!launchSessionMatches || launch.confirmationRequired || !runnerId || launch.error || launch.run?.status !== 'running') {
        const detail = launch.error || 'The MV/MZ playtest runner did not reach the running state.'
        session.runnerId = runnerId
        return this.failStart(session, detail, launch.run?.error)
      }
      session.runnerId = runnerId
      const startupEvidence = verifyIsolatedSourceStateForPreview(session)
      if (!startupEvidence.sourceUnchanged || !startupEvidence.savesUnchanged || !startupEvidence.stagingUnchanged) {
        return this.retainIsolationFailure(session, startupEvidence, 'The source project or staging changed while the isolated preview runner was starting.')
      }
      return {
        state: 'running',
        message: 'Isolated UI designer preview is running in a temporary MV/MZ project.',
        sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        cleanup: { ok: true },
        diagnostics: readPreviewDiagnostics(session),
        projectCompatibility: session.projectCompatibility,
        session,
      }
    } catch (error) {
      if (session) return this.failStart(session, error instanceof Error ? error.message : String(error))
      try { cleanupIsolatedProject(preparation) } catch { /* Preserve the preparation failure. */ }
      throw error
    }
  }

  private async retainIsolationFailure(
    session: UiDesignerPreviewSession,
    evidence: ReturnType<typeof verifyIsolatedSourceState>,
    message: string,
  ): Promise<UiPreviewResult & { session: UiDesignerPreviewSession }> {
    let runnerStatus = 'unknown'
    let runnerError = ''
    if (this.launcher && session.runnerId) {
      try {
        const stopped = await this.launcher.stop(session.runnerId)
        runnerStatus = stopped.run?.status || runnerStatus
        runnerError = stopped.error || stopped.run?.error || ''
      } catch (error) {
        runnerError = error instanceof Error ? error.message : String(error)
      }
    }
    this.active = session
    return {
      state: 'error',
      message: `${message} The temporary project was kept for recovery.`,
      sessionId: session.sessionId,
      temporaryPath: session.temporaryProject,
      sourceProject: session.sourceProject,
      stagingSummary: session.stagingSummary,
      runner: { runId: session.runnerId, status: runnerStatus, ...(runnerError ? { error: runnerError } : {}) },
      cleanup: { ok: false, message: evidence.stagingError || 'Isolation evidence changed.' },
      diagnostics: readPreviewDiagnostics(session),
      projectCompatibility: session.projectCompatibility,
      session,
    }
  }

  private async failStart(session: UiDesignerPreviewSession, detail: string, runnerError?: string): Promise<UiPreviewResult & { session?: UiDesignerPreviewSession }> {
    let diagnostics = readPreviewDiagnostics(session)
    let stopError = ''
    if (this.launcher && session.runnerId) {
      try {
        const stopped = await this.launcher.stop(session.runnerId)
        diagnostics = readPreviewDiagnostics(session)
        stopError = stopped.error || stopped.run?.error || ''
        if (stopped.run?.status && !['stopped', 'exited', 'failed'].includes(stopped.run.status)) {
          return {
            state: 'error',
            message: 'The MV/MZ preview runner did not start and is still active; the temporary project was kept for recovery.',
            sessionId: session.sessionId,
            temporaryPath: session.temporaryProject,
            sourceProject: session.sourceProject,
            stagingSummary: session.stagingSummary,
            runner: { runId: session.runnerId, status: stopped.run.status, ...(stopError ? { error: stopError } : {}) },
            cleanup: { ok: false, message: 'runner-still-active' },
            diagnostics,
            projectCompatibility: session.projectCompatibility,
            session,
          }
        }
      } catch (error) {
        stopError = error instanceof Error ? error.message : String(error)
      }
    }
    try {
      cleanupIsolatedProject(session.preparation)
      this.active = null
      return {
        state: 'error',
        message: 'The MV/MZ preview runner could not start; the temporary project was cleaned up.',
        sessionId: session.sessionId,
        sourceProject: session.sourceProject,
        runner: { runId: session.runnerId || undefined, status: 'failed', ...(runnerError || stopError ? { error: runnerError || stopError } : {}) },
        cleanup: { ok: true },
        diagnostics,
        projectCompatibility: session.projectCompatibility,
      }
    } catch (error) {
      return {
        state: 'error',
        message: 'The MV/MZ preview runner could not start and temporary-project cleanup failed; manual recovery may be required.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        runner: { runId: session.runnerId || undefined, status: 'failed', ...(runnerError || stopError ? { error: runnerError || stopError } : {}) },
        cleanup: { ok: false, message: error instanceof Error ? error.message : String(error) },
        diagnostics,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
  }

  async current(): Promise<UiPreviewResult & { session?: UiDesignerPreviewSession }> {
    if (!this.active) return { state: 'idle', message: 'No isolated UI designer preview is running.', diagnostics: [] }
    if (!this.launcher) {
      const diagnostics = readPreviewDiagnostics(this.active)
      return {
        state: 'error',
        message: 'The MV/MZ preview runner is unavailable; the temporary project was kept for recovery.',
        sessionId: this.active.sessionId,
        temporaryPath: this.active.temporaryProject,
        sourceProject: this.active.sourceProject,
        stagingSummary: this.active.stagingSummary,
        cleanup: { ok: false, message: 'UI_DESIGNER_PREVIEW_LAUNCHER_UNAVAILABLE' },
        diagnostics,
        projectCompatibility: this.active.projectCompatibility,
        session: this.active,
      }
    }
    const session = this.active
    const runner = await this.launcher.current(session.sessionId)
    let diagnostics = readPreviewDiagnostics(session)
    const runnerStatus = runner.run?.status
    if (!runner.error && runnerStatus && ['starting', 'running', 'stopping'].includes(runnerStatus)) {
      return {
        state: 'running',
        message: 'Isolated UI designer preview is running in a temporary MV/MZ project.',
        sessionId: this.active.sessionId,
        temporaryPath: this.active.temporaryProject,
        sourceProject: this.active.sourceProject,
        stagingSummary: this.active.stagingSummary,
        cleanup: { ok: true },
        diagnostics,
        projectCompatibility: this.active.projectCompatibility,
        session: this.active,
      }
    }
    const runnerFailed = Boolean(runner.error || runner.run?.error || ['failed', 'stop_failed'].includes(String(runnerStatus || '')))
    const evidence = verifyIsolatedSourceStateForPreview(session)
    if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
      return {
        state: 'error',
        message: 'The preview runner exited, but source/staging evidence changed; the temporary project was kept for recovery.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        cleanup: { ok: false, message: evidence.stagingError || 'Isolation evidence changed.' },
        diagnostics,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
    try {
      cleanupIsolatedProject(session.preparation)
      this.active = null
      return {
        state: runnerFailed ? 'error' : 'stopped',
        message: runnerFailed
          ? 'The MV/MZ preview runner exited with an error; its temporary project was cleaned up.'
          : 'The MV/MZ preview runner exited and its temporary project was cleaned up.',
        sessionId: session.sessionId,
        sourceProject: session.sourceProject,
        cleanup: { ok: !fs.existsSync(session.temporaryProject) },
        diagnostics,
        runner: {
          runId: runner.run?.runId || session.runnerId,
          status: runnerStatus,
          ...(runner.error || runner.run?.error ? { error: runner.error || runner.run?.error } : {}),
        },
        projectCompatibility: session.projectCompatibility,
      }
    } catch (error) {
      return {
        state: 'error',
        message: 'The preview runner exited, but temporary-project cleanup failed; manual recovery may be required.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        cleanup: { ok: false, message: error instanceof Error ? error.message : String(error) },
        diagnostics,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
  }

  async stop(sessionId?: string): Promise<UiPreviewResult> {
    const session = this.active
    if (!session) return { state: 'idle', message: 'No isolated UI designer preview is running.', diagnostics: [], cleanup: { ok: true } }
    let diagnostics = readPreviewDiagnostics(session)
    if (sessionId && sessionId !== session.sessionId) return { state: 'error', message: 'The requested UI preview session is not active.', diagnostics, cleanup: { ok: false, message: 'Session mismatch.' } }
    try {
      if (!this.launcher) throw new UiDesignerPreviewUnavailableError()
      const stopped = await this.launcher.stop(session.runnerId)
      diagnostics = readPreviewDiagnostics(session)
      if (stopped.error) {
        return {
          state: 'error',
          message: 'The MV/MZ preview runner could not be stopped; the temporary project was kept for recovery.',
          sessionId: session.sessionId,
          temporaryPath: session.temporaryProject,
          runner: { runId: session.runnerId, ...(stopped.error ? { error: stopped.error } : {}) },
          cleanup: { ok: false, message: stopped.error },
          diagnostics,
          projectCompatibility: session.projectCompatibility,
        }
      }
      if (stopped.run?.status && !['stopped', 'exited', 'failed'].includes(stopped.run.status)) {
        return {
          state: 'error',
          message: 'The MV/MZ preview runner is still active; the temporary project was kept until it exits.',
          sessionId: session.sessionId,
          temporaryPath: session.temporaryProject,
          diagnostics,
          cleanup: { ok: false, message: `runner-status:${stopped.run.status}` },
          projectCompatibility: session.projectCompatibility,
        }
      }
      const evidence = verifyIsolatedSourceStateForPreview(session)
      if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
        return {
          state: 'error',
          message: 'The source project or staging changed while the preview was running; the temporary project was kept for recovery.',
          sessionId: session.sessionId,
          temporaryPath: session.temporaryProject,
          sourceProject: session.sourceProject,
          stagingSummary: session.stagingSummary,
          cleanup: { ok: false, message: evidence.stagingError || 'Isolation evidence changed.' },
          diagnostics,
          projectCompatibility: session.projectCompatibility,
        }
      }
      const runnerFailed = Boolean(stopped.run?.error || stopped.run?.status === 'failed')
      cleanupIsolatedProject(session.preparation)
      this.active = null
      return {
        state: runnerFailed ? 'error' : 'stopped',
        message: runnerFailed
          ? 'The MV/MZ preview runner stopped with an error; the temporary project was cleaned up.'
          : 'Isolated UI designer preview stopped and cleaned up.',
        sessionId: session.sessionId,
        sourceProject: session.sourceProject,
        cleanup: { ok: !fs.existsSync(session.temporaryProject) },
        diagnostics,
        projectCompatibility: session.projectCompatibility,
        runner: {
          runId: session.runnerId,
          status: stopped.run?.status,
          ...(stopped.run?.error ? { error: stopped.run.error } : {}),
        },
      }
    } catch (error) {
      return {
        state: 'error',
        message: 'UI designer preview cleanup failed; manual recovery may be required.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        diagnostics,
        cleanup: { ok: false, message: error instanceof Error ? error.message : String(error) },
        projectCompatibility: session.projectCompatibility,
      }
    }
  }
}

function verifyIsolatedSourceStateForPreview(session: UiDesignerPreviewSession): ReturnType<typeof verifyIsolatedSourceState> {
  return verifyIsolatedSourceState(session.workflowRoot, session.preparation)
}

function readPreviewDiagnostics(session: UiDesignerPreviewSession): UiRuntimeDiagnostic[] {
  const diagnosticsPath = path.resolve(session.diagnosticsPath)
  const temporaryProject = path.resolve(session.temporaryProject)
  if (!isPathWithin(temporaryProject, diagnosticsPath)) return []
  try {
    const temporaryReal = fs.realpathSync.native(temporaryProject)
    const diagnosticsReal = fs.realpathSync.native(diagnosticsPath)
    if (!isPathWithin(temporaryReal, diagnosticsReal)) return []
    const stat = fs.lstatSync(diagnosticsReal)
    if (!stat.isFile() || stat.isSymbolicLink()) return []
    const bytes = fs.readFileSync(diagnosticsReal)
    const content = bytes.subarray(0, PREVIEW_DIAGNOSTICS_MAX_BYTES).toString('utf8')
    const seen = new Set<string>()
    const diagnostics: UiRuntimeDiagnostic[] = []
    for (const line of content.split(/\r?\n/)) {
      if (!line || Buffer.byteLength(line, 'utf8') > PREVIEW_DIAGNOSTICS_MAX_LINE_BYTES) continue
      let value: unknown
      try { value = JSON.parse(line) } catch { continue }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      if (record.schemaVersion !== UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION || record.sessionId !== session.sessionId) continue
      const code = boundedDiagnosticString(record.code)
      const severity = record.severity === 'warning' || record.severity === 'error' ? record.severity : null
      const label = boundedDiagnosticString(record.label)
      const message = boundedDiagnosticString(record.message)
      const count = boundedDiagnosticCount(record.count)
      if (!code || !severity || !label || !message || count === null) continue
      const diagnostic: UiRuntimeDiagnostic = {
        schemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
        sessionId: session.sessionId,
        scene: nullableDiagnosticString(record.scene),
        file: nullableDiagnosticString(record.file),
        node: nullableDiagnosticString(record.node),
        type: nullableDiagnosticString(record.type),
        phase: nullableDiagnosticString(record.phase),
        event: nullableDiagnosticString(record.event),
        code,
        severity,
        label,
        message,
        count,
      }
      const key = JSON.stringify({ ...diagnostic, count: undefined })
      const previousIndex = diagnostics.findIndex((existing) => JSON.stringify({ ...existing, count: undefined }) === key)
      if (previousIndex >= 0) {
        diagnostics[previousIndex] = { ...diagnostics[previousIndex], count: Math.min(1_000_000, diagnostics[previousIndex].count + count) }
      } else {
        if (seen.has(key)) continue
        seen.add(key)
        diagnostics.push(diagnostic)
      }
      if (diagnostics.length >= PREVIEW_DIAGNOSTICS_MAX_ENTRIES) break
    }
    return diagnostics
  } catch {
    return []
  }
}

function boundedDiagnosticString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.slice(0, PREVIEW_DIAGNOSTIC_FIELD_LIMIT) : ''
}

function nullableDiagnosticString(value: unknown): string | null {
  const result = boundedDiagnosticString(value)
  return result || null
}

function boundedDiagnosticCount(value: unknown): number | null {
  if (!Number.isInteger(value) || (value as number) < 1) return null
  return Math.min(1_000_000, value as number)
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

interface PreviewStageFilesResult {
  affectedFiles: string[]
  diagnosticsPath: string
}

function stagePreviewFiles(temporaryProject: string, scene: UiRuntimeSceneExport, sessionId: string): PreviewStageFilesResult {
  const layout = resolveRmmvLayout(temporaryProject)
  const runtime = bundledUiDesignerRuntime()
  const sceneDirectory = path.join(layout.resourceRoot, 'js', 'plugins', 'mzui-data')
  const runtimeDirectory = path.join(layout.resourceRoot, 'js', 'plugins')
  fs.mkdirSync(sceneDirectory, { recursive: true })
  fs.mkdirSync(runtimeDirectory, { recursive: true })
  const scenePath = path.join(sceneDirectory, `${scene.meta.sceneName}.json`)
  const runtimePath = path.join(runtimeDirectory, 'MZUIRuntime.js')
  const bootstrapPath = path.join(runtimeDirectory, 'MZUIDesignerPreviewBoot.js')
  fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8')
  fs.writeFileSync(runtimePath, runtime.source, 'utf8')
  fs.writeFileSync(bootstrapPath, previewBootstrapSource(), 'utf8')
  const pluginsPath = path.join(runtimeDirectory, 'plugins.js')
  const pluginsSource = fs.existsSync(pluginsPath) ? fs.readFileSync(pluginsPath, 'utf8') : 'var $plugins = [];\n'
  const start = pluginsSource.indexOf('[')
  const end = pluginsSource.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('Isolated preview plugins.js is invalid.')
  const parsed = JSON.parse(pluginsSource.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('Isolated preview plugins.js must contain an array.')
  const entry = { name: 'MZUIRuntime', status: true, description: 'UI designer isolated preview', parameters: {} }
  const index = parsed.findIndex((item) => item && item.name === entry.name)
  if (index >= 0) parsed[index] = entry
  else parsed.push(entry)
  const bootstrapEntry = {
    name: 'MZUIDesignerPreviewBoot',
    status: true,
    description: 'UI designer isolated preview scene bootstrap',
    parameters: { SceneName: scene.meta.sceneName },
  }
  const bootstrapIndex = parsed.findIndex((item) => item && item.name === bootstrapEntry.name)
  if (bootstrapIndex >= 0) parsed[bootstrapIndex] = bootstrapEntry
  else parsed.push(bootstrapEntry)
  fs.writeFileSync(pluginsPath, `var $plugins =\n${JSON.stringify(parsed, null, 2)};\n`, 'utf8')
  const marker = path.join(layout.resourceRoot, 'js', 'plugins', 'mzui-data', '.ui-designer-preview.json')
  const diagnosticsPath = path.join(layout.resourceRoot, ...UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH.split('/'))
  fs.writeFileSync(diagnosticsPath, '', 'utf8')
  fs.writeFileSync(marker, `${JSON.stringify({
    scene: scene.meta.sceneName,
    runtimeVersion: runtime.version,
    sessionId,
    schemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
    diagnosticsPath: UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
  }, null, 2)}\n`, 'utf8')
  return {
    diagnosticsPath,
    affectedFiles: [
    path.relative(temporaryProject, scenePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, runtimePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, bootstrapPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, pluginsPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, marker).replace(/\\/g, '/'),
    path.relative(temporaryProject, diagnosticsPath).replace(/\\/g, '/'),
    ],
  }
}

function previewBootstrapSource(): string {
  return `/*:
 * @target MV MZ
 * @plugindesc Luna RPG Agent isolated UI designer preview bootstrap
 * @author Luna RPG Agent
 * @help This file is generated only inside a temporary preview copy.
 */
(function () {
  'use strict';
  var markerPath = 'js/plugins/mzui-data/.ui-designer-preview.json';
  var expectedDiagnosticsPath = '${UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH}';
  var marker = null;
  var markerRoot = '';
  var fs = null;
  var path = null;
  var sceneName = '';
  try {
    if (typeof require === 'function') {
      fs = require('fs');
      path = require('path');
      var root = typeof process !== 'undefined' && process.cwd ? process.cwd() : '';
      var roots = [root, path.join(root, 'www')];
      for (var i = 0; i < roots.length && !sceneName; i += 1) {
        var file = path.join(roots[i], markerPath);
        if (fs.existsSync(file)) {
          marker = JSON.parse(fs.readFileSync(file, 'utf8'));
          markerRoot = roots[i];
          sceneName = String(marker.scene || '');
        }
      }
    }
  } catch (_) {
    marker = null;
    sceneName = '';
  }
  function writeRuntimeDiagnostic(entry) {
    try {
      if (!marker || !fs || !path || !marker.sessionId || marker.diagnosticsPath !== expectedDiagnosticsPath) return;
      var target = path.join(markerRoot, expectedDiagnosticsPath);
      var envelope = {
        schemaVersion: String(marker.schemaVersion || '${UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION}'),
        sessionId: String(marker.sessionId),
        scene: entry && entry.scene ? String(entry.scene) : (sceneName || null),
        file: entry && entry.file ? String(entry.file) : null,
        node: entry && entry.node ? String(entry.node) : null,
        type: entry && entry.type ? String(entry.type) : null,
        phase: entry && entry.phase ? String(entry.phase) : null,
        event: entry && entry.event ? String(entry.event) : null,
        code: entry && entry.code ? String(entry.code) : 'UI_RUNTIME_HANDLER_ERROR',
        severity: entry && entry.severity === 'warning' ? 'warning' : 'error',
        label: entry && entry.label ? String(entry.label) : 'runtime',
        message: entry && entry.message ? String(entry.message) : 'Unknown runtime error',
        count: entry && Number.isInteger(entry.count) && entry.count > 0 ? Math.min(1000000, entry.count) : 1
      };
      var serialized = JSON.stringify(envelope);
      if (serialized.length > 8192) {
        envelope.message = envelope.message.slice(0, 2048);
        serialized = JSON.stringify(envelope);
      }
      if (serialized.length > 8192) return;
      fs.appendFileSync(target, serialized + '\\n', 'utf8');
    } catch (error) {
      if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
        console.error('[MZUIRuntime] diagnostics write failed', error && error.message ? error.message : String(error));
      }
    }
  }
  if (!marker || !sceneName) return;
  if (window.MZUIRuntime && typeof window.MZUIRuntime.configure === 'function') {
    window.MZUIRuntime.configure({ onError: writeRuntimeDiagnostic });
  }
  var pushed = false;
  function pushTarget() {
    if (pushed || !window.SceneManager) return;
    if (!window.MZUIRuntime || typeof window.MZUIRuntime.isRegistered !== 'function' || !window.MZUIRuntime.isRegistered(sceneName)) return;
    var target = window[sceneName];
    if (typeof target !== 'function') return;
    pushed = true;
    if (typeof window.SceneManager.goto === 'function') window.SceneManager.goto(target);
    else if (typeof window.SceneManager.push === 'function') window.SceneManager.push(target);
  }
  if (window.Scene_Boot && window.Scene_Boot.prototype) {
    var originalStart = window.Scene_Boot.prototype.start;
    window.Scene_Boot.prototype.start = function () {
      if (typeof originalStart === 'function') originalStart.apply(this, arguments);
      pushTarget();
    };
  }
}());
`;
}

export function defaultUiDesignerPreviewTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-preview-'))
}
