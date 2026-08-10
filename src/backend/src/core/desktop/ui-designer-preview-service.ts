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
import { normalizeUiRuntimeSceneGeometry } from '../../../../contract/ui-designer-geometry.ts'
import { inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts'
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts'
import {
  attestIsolatedPreparationResponse,
  canonicalizeIsolatedSourceProject,
} from './isolated-project-attestation.ts'
import {
  assertIsolatedNwWriteTarget,
  createIsolatedNwProfileDirectory,
  planIsolatedNwApp,
  type IsolatedNwActivePackageEvidence,
  writeIsolatedNwAppPackage,
} from './isolated-nw-app-launch.ts'
import { bundledUiDesignerRuntime } from './ui-designer-runtime-service.ts'
import { validateUiRuntimeSceneExport } from './ui-designer-validation.ts'
import { uiDesignerProjectCompatibility } from './ui-designer-compatibility.ts'

/**
 * The preview service owns the isolated copy, but the interactive playtest
 * service owns the real MV/MZ process lifecycle.  Keeping this boundary
 * explicit prevents a staged copy from being reported as a running preview.
 */
export interface UiDesignerPreviewEvidenceContract {
  paths: {
    engineEntry: string
    loadState: string
    diagnostics: string
    sceneHandshake: string
  }
  schemas: {
    engineEntry: string
    loadState: string
    diagnostics: string
    sceneHandshake: string
  }
  application: IsolatedNwActivePackageEvidence
}

export interface UiDesignerPreviewLauncher {
  start(projectRoot: string, options: {
    sessionId: string
    profileDirectory: string
    sourceProject: string
    preparation: IsolatedProjectPreparation
    evidence: UiDesignerPreviewEvidenceContract
  }): Promise<{
    run?: { runId?: string; sessionId?: string; status?: string; error?: string }
    error?: string
    confirmationRequired?: boolean
  }>
  stop(runId?: string): Promise<{ error?: string; run?: { runId?: string; sessionId?: string; status?: string; error?: string } }>
  stopSync?(runId?: string): { error?: string; run?: { runId?: string; sessionId?: string; status?: string; error?: string } }
  current(sessionId?: string): Promise<{ error?: string; run?: { runId?: string; sessionId?: string; status?: string; error?: string } }>
  captureFailureEvidence(sessionId: string, reason: 'startup-failed' | 'runner-failed' | 'handshake-failed'): Promise<void> | void
}

export interface UiDesignerPreviewPreparationFactory {
  (workflowRoot: string, project: string): Promise<IsolatedProjectPreparation> | IsolatedProjectPreparation
}

export interface UiDesignerPreviewSceneHandshake {
  status: 'ready' | 'mismatch'
  expectedScene: string
  actualScene: string
}

export interface UiDesignerPreviewSceneReadinessWaiter {
  (session: UiDesignerPreviewSession, expectedScene: string, signal?: AbortSignal): Promise<UiDesignerPreviewSceneHandshake>
}

interface UiDesignerPreviewStartAttempt {
  cancelled: boolean
  controller: AbortController
  session: UiDesignerPreviewSession | null
  launchSettled: Promise<void>
  resolveLaunchSettled: () => void
  cleanupSettled: Promise<UiPreviewResult>
  resolveCleanupSettled: (result: UiPreviewResult) => void
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
  /** Session-owned NW profile inside temporaryProject. */
  profileDirectory: string
  sceneHandshake?: UiDesignerPreviewSceneHandshake
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
export const UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION = '1.0.0' as const
const UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_RELATIVE_PATH = 'js/plugins/mzui-data/.ui-designer-engine-entry.json'
export const UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION = '1.0.0' as const
export const UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH = 'js/plugins/mzui-data/.ui-designer-scene-ready.json'
export const UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION = '1.0.0' as const
export const UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH = 'js/plugins/mzui-data/.ui-designer-load-state.json'
export const UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_TIMEOUT_MS = 15_000
const PREVIEW_DIAGNOSTICS_MAX_BYTES = 256 * 1024
const PREVIEW_DIAGNOSTICS_MAX_LINE_BYTES = 8 * 1024
const PREVIEW_DIAGNOSTICS_MAX_ENTRIES = 64
const PREVIEW_DIAGNOSTIC_FIELD_LIMIT = 1024
const UI_DESIGNER_PREVIEW_TEMPORARY_PREFIX = 'ui-designer-preview-'

export class UiDesignerPreviewService {
  private active: UiDesignerPreviewSession | null = null
  private preparing = false
  private launcher: UiDesignerPreviewLauncher | null
  private prepareIsolated: UiDesignerPreviewPreparationFactory
  private waitForSceneReady: UiDesignerPreviewSceneReadinessWaiter
  private startAttempt: UiDesignerPreviewStartAttempt | null = null

  constructor(launcher?: UiDesignerPreviewLauncher, prepareIsolated?: UiDesignerPreviewPreparationFactory, waitForSceneReady?: UiDesignerPreviewSceneReadinessWaiter) {
    this.launcher = launcher || null
    this.prepareIsolated = prepareIsolated || ((workflowRoot, project) => prepareIsolatedStagedProject(workflowRoot, project, {
      temporaryPrefix: UI_DESIGNER_PREVIEW_TEMPORARY_PREFIX,
      // UI designer scenes execute arbitrary project code, so every asset
      // directory must be physically copied rather than junctioned.
      physicalCopyAllProjectDirectories: true,
    }))
    this.waitForSceneReady = waitForSceneReady || waitForPreviewSceneReadiness
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
  ): Promise<UiPreviewResult & { session?: UiDesignerPreviewSession }> {
    if (this.active || this.preparing) throw new UiDesignerPreviewBusyError()
    if (!this.launcher) throw new UiDesignerPreviewUnavailableError()
    const report = validateUiRuntimeSceneExport(scene)
    if (!report.valid) throw new Error(`UI preview scene validation failed: ${report.errors.map((issue) => issue.message).join('; ')}`)
    scene = normalizeUiRuntimeSceneGeometry(canonicalUiRuntimeSceneExport(scene))
    if (RESERVED_ENGINE_SCENE_NAMES.has(scene.meta.sceneName)) throw new UiDesignerPreviewSceneConflictError(scene.meta.sceneName)
    const requestedSourceProject = canonicalizeIsolatedSourceProject(projectInput)
    const projectManifest = inspectRmmvProject(requestedSourceProject)
    const projectCompatibility = uiDesignerProjectCompatibility(projectManifest)
    let resolveLaunchSettled!: () => void
    let resolveCleanupSettled!: (result: UiPreviewResult) => void
    const attempt: UiDesignerPreviewStartAttempt = {
      cancelled: false,
      controller: new AbortController(),
      session: null,
      launchSettled: new Promise<void>((resolve) => { resolveLaunchSettled = resolve }),
      resolveLaunchSettled: () => resolveLaunchSettled(),
      cleanupSettled: new Promise<UiPreviewResult>((resolve) => { resolveCleanupSettled = resolve }),
      resolveCleanupSettled: (result) => resolveCleanupSettled(result),
    }
    this.startAttempt = attempt
    this.preparing = true
    let preparation: IsolatedProjectPreparation
    try {
      preparation = await this.prepareIsolated(
        workflowRootInput,
        requestedSourceProject,
      )
    } catch (error) {
      attempt.resolveLaunchSettled()
      if (attempt.cancelled) return await attempt.cleanupSettled
      if (this.startAttempt === attempt) this.startAttempt = null
      throw error
    } finally {
      this.preparing = false
    }
    const sessionId = crypto.randomUUID()
    let session: UiDesignerPreviewSession | null = null
    try {
      attestIsolatedPreparationResponse({
        sourceProject: requestedSourceProject,
        temporaryProject: preparation.temporaryProject,
        ownership: preparation.ownership,
      }, preparation)
      const staged = stagePreviewFiles(
        preparation,
        requestedSourceProject,
        scene,
        sessionId,
        projectManifest.engine === 'rpg-maker-mv' ? 'MV' : 'MZ',
      )
      session = {
        sessionId,
        workflowRoot: path.resolve(workflowRootInput),
        sourceProject: requestedSourceProject,
        temporaryProject: preparation.temporaryProject,
        stagingSummary: { affectedFiles: staged.affectedFiles, sourceDigest: preparation.sourceFingerprint },
        preparation,
        runnerId: '',
        projectCompatibility,
        diagnosticsPath: staged.diagnosticsPath,
        profileDirectory: staged.profileDirectory,
      }
      attempt.session = session
      this.active = session
      if (attempt.cancelled) {
        attempt.resolveLaunchSettled()
        return await attempt.cleanupSettled
      }
      const launch = await this.launcher.start(preparation.temporaryProject, {
        sessionId,
        profileDirectory: staged.profileDirectory,
        sourceProject: requestedSourceProject,
        preparation,
        evidence: staged.evidence,
      })
      const launchSessionMatches = !launch.run?.sessionId || launch.run.sessionId === sessionId
      const runnerId = launchSessionMatches ? String(launch.run?.runId || '') : ''
      session.runnerId = runnerId
      attempt.resolveLaunchSettled()
      if (attempt.cancelled) return await attempt.cleanupSettled
      if (!launchSessionMatches || launch.confirmationRequired || !runnerId || launch.error || launch.run?.status !== 'running') {
        const detail = launch.error || 'The MV/MZ playtest runner did not reach the running state.'
        if (this.startAttempt === attempt) this.startAttempt = null
        return this.failStart(session, detail, launch.run?.error)
      }
      session.sceneHandshake = await waitForSceneReadinessOrAbort(this.waitForSceneReady, session, scene.meta.sceneName, attempt.controller.signal)
      if (attempt.cancelled) return await attempt.cleanupSettled
      if (session.sceneHandshake.status !== 'ready' || session.sceneHandshake.actualScene !== scene.meta.sceneName) {
        if (this.startAttempt === attempt) this.startAttempt = null
        return this.failStart(session, `Expected preview scene ${scene.meta.sceneName}, but the isolated runner reported ${session.sceneHandshake.actualScene}.`)
      }
      const engineEntryReceipt = readPreviewEngineEntryReceipt(session)
      if (engineEntryReceipt?.phase !== 'engine-entry-loaded') {
        if (this.startAttempt === attempt) this.startAttempt = null
        const phase = engineEntryReceipt?.phase === 'entry-failed'
          ? `entry-failed:${engineEntryReceipt.stage}`
          : engineEntryReceipt?.phase || 'missing'
        return this.failStart(session, `The isolated engine Entry did not reach its loaded phase (${phase}).`)
      }
      const startupEvidence = verifyIsolatedSourceStateForPreview(session)
      if (!startupEvidence.sourceUnchanged || !startupEvidence.savesUnchanged || !startupEvidence.stagingUnchanged) {
        if (this.startAttempt === attempt) this.startAttempt = null
        return this.retainIsolationFailure(session, startupEvidence, 'The source project or staging changed while the isolated preview runner was starting.')
      }
      if (this.startAttempt === attempt) this.startAttempt = null
      return {
        state: 'running',
        message: 'Isolated UI designer preview is running in a temporary MV/MZ project.',
        sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        cleanup: { ok: true },
        diagnostics: readPreviewDiagnostics(session),
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    } catch (error) {
      attempt.resolveLaunchSettled()
      if (attempt.cancelled) return await attempt.cleanupSettled
      if (this.startAttempt === attempt) this.startAttempt = null
      if (session) return this.failStart(session, error instanceof Error ? error.message : String(error))
      try {
        cleanupIsolatedProject(preparation, {
          sourceProject: requestedSourceProject,
          temporaryProject: preparation.temporaryProject,
        })
      } catch { /* Preserve the preparation failure. */ }
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
      sceneHandshake: session.sceneHandshake,
      projectCompatibility: session.projectCompatibility,
      session,
    }
  }

  private async failStart(session: UiDesignerPreviewSession, detail: string, runnerError?: string): Promise<UiPreviewResult & { session?: UiDesignerPreviewSession }> {
    let diagnostics = readPreviewDiagnostics(session)
    let stopError = ''
    let stopConfirmed = !session.runnerId
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
            sceneHandshake: session.sceneHandshake,
            projectCompatibility: session.projectCompatibility,
            session,
          }
        }
        stopConfirmed = !stopped.error
          && Boolean(stopped.run?.status && ['stopped', 'exited', 'failed'].includes(stopped.run.status))
      } catch (error) {
        stopError = error instanceof Error ? error.message : String(error)
      }
    }
    if (!stopConfirmed) {
      this.active = session
      return {
        state: 'error',
        message: 'The MV/MZ preview runner stop could not be confirmed; the temporary project was kept for recovery.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        runner: { runId: session.runnerId, status: 'stop_failed', ...(stopError ? { error: stopError } : {}) },
        cleanup: { ok: false, message: 'runner-stop-unconfirmed' },
        diagnostics,
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
    const failureReason = session.sceneHandshake?.status === 'mismatch' ? 'handshake-failed' : 'startup-failed'
    const captureError = await this.captureFailureEvidence(session, failureReason)
    if (captureError) {
      this.active = session
      return {
        state: 'error',
        message: 'The MV/MZ preview runner could not start and bounded failure evidence could not be preserved; the temporary project was kept for recovery.',
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        runner: { runId: session.runnerId || undefined, status: 'failed', error: captureError },
        cleanup: { ok: false, message: 'failure-evidence-capture-failed' },
        diagnostics,
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
    const evidence = verifyIsolatedSourceStateForPreview(session)
    if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
      this.active = session
      return {
        state: 'error',
        message: `The MV/MZ preview runner could not start and isolation evidence changed; the temporary project was kept for recovery. ${detail}`,
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        runner: { runId: session.runnerId || undefined, status: 'failed', ...(runnerError || stopError ? { error: runnerError || stopError } : {}) },
        cleanup: { ok: false, message: evidence.stagingError || 'Isolation evidence changed.' },
        diagnostics,
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
    try {
      cleanupPreviewIsolation(session)
      this.active = null
      return {
        state: 'error',
        message: `The MV/MZ preview runner could not start; the temporary project was cleaned up. ${detail}`,
        sessionId: session.sessionId,
        sourceProject: session.sourceProject,
        runner: { runId: session.runnerId || undefined, status: 'failed', ...(runnerError || stopError ? { error: runnerError || stopError } : {}) },
        cleanup: { ok: true },
        diagnostics,
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
      }
    } catch (error) {
      return {
        state: 'error',
        message: `The MV/MZ preview runner could not start and temporary-project cleanup failed; manual recovery may be required. ${detail}`,
        sessionId: session.sessionId,
        temporaryPath: session.temporaryProject,
        sourceProject: session.sourceProject,
        stagingSummary: session.stagingSummary,
        runner: { runId: session.runnerId || undefined, status: 'failed', ...(runnerError || stopError ? { error: runnerError || stopError } : {}) },
        cleanup: { ok: false, message: error instanceof Error ? error.message : String(error) },
        diagnostics,
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
  }

  private async captureFailureEvidence(
    session: UiDesignerPreviewSession,
    reason: 'startup-failed' | 'runner-failed' | 'handshake-failed',
  ): Promise<string> {
    if (!this.launcher) return ''
    try {
      await this.launcher.captureFailureEvidence(session.sessionId, reason)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
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
        sceneHandshake: this.active.sceneHandshake,
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
        sceneHandshake: this.active.sceneHandshake,
        projectCompatibility: this.active.projectCompatibility,
        session: this.active,
      }
    }
    const runnerFailed = Boolean(runner.error || runner.run?.error || ['failed', 'stop_failed'].includes(String(runnerStatus || '')))
    if (runnerFailed) {
      const captureError = await this.captureFailureEvidence(session, 'runner-failed')
      if (captureError) {
        return {
          state: 'error',
          message: 'The preview runner exited, but bounded failure evidence could not be preserved; the temporary project was kept for recovery.',
          sessionId: session.sessionId,
          temporaryPath: session.temporaryProject,
          cleanup: { ok: false, message: 'failure-evidence-capture-failed' },
          diagnostics,
          sceneHandshake: session.sceneHandshake,
          projectCompatibility: session.projectCompatibility,
          session,
        }
      }
    }
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
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
    try {
      cleanupPreviewIsolation(session)
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
        sceneHandshake: session.sceneHandshake,
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
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
        session,
      }
    }
  }

  async stop(sessionId?: string): Promise<UiPreviewResult> {
    const attempt = this.startAttempt
    if (attempt) {
      attempt.cancelled = true
      attempt.controller.abort()
      await attempt.launchSettled
    }
    const result = await this.stopActive(sessionId)
    if (attempt) {
      attempt.resolveCleanupSettled(result)
      if (this.startAttempt === attempt) this.startAttempt = null
    }
    return result
  }

  private async stopActive(sessionId?: string): Promise<UiPreviewResult> {
    const session = this.active
    if (!session) return { state: 'idle', message: 'No isolated UI designer preview is running.', diagnostics: [], cleanup: { ok: true } }
    let diagnostics = readPreviewDiagnostics(session)
    if (sessionId && sessionId !== session.sessionId) return { state: 'error', message: 'The requested UI preview session is not active.', diagnostics, cleanup: { ok: false, message: 'Session mismatch.' } }
    try {
      if (!this.launcher) throw new UiDesignerPreviewUnavailableError()
      const stopped = session.runnerId
        ? await this.launcher.stop(session.runnerId)
        : { run: { status: 'stopped' } }
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
          sceneHandshake: session.sceneHandshake,
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
          sceneHandshake: session.sceneHandshake,
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
          sceneHandshake: session.sceneHandshake,
          projectCompatibility: session.projectCompatibility,
        }
      }
      const runnerFailed = Boolean(stopped.run?.error || stopped.run?.status === 'failed')
      if (runnerFailed) {
        const captureError = await this.captureFailureEvidence(session, 'runner-failed')
        if (captureError) {
          return {
            state: 'error',
            message: 'The preview runner stopped with an error, but bounded failure evidence could not be preserved; the temporary project was kept for recovery.',
            sessionId: session.sessionId,
            temporaryPath: session.temporaryProject,
            cleanup: { ok: false, message: 'failure-evidence-capture-failed' },
            diagnostics,
            sceneHandshake: session.sceneHandshake,
            projectCompatibility: session.projectCompatibility,
          }
        }
      }
      cleanupPreviewIsolation(session)
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
        sceneHandshake: session.sceneHandshake,
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
        sceneHandshake: session.sceneHandshake,
        projectCompatibility: session.projectCompatibility,
      }
    }
  }

  shutdownSync(): UiPreviewResult {
    const session = this.active
    if (!session) {
      if (this.startAttempt || this.preparing) {
        if (this.startAttempt) this.startAttempt.cancelled = true
        this.startAttempt?.controller.abort()
        return {
          state: 'error',
          message: 'UI designer preview preparation is still active; its owner was retained for recovery.',
          diagnostics: [],
          cleanup: { ok: false, message: 'preparation-still-active' },
        }
      }
      return { state: 'idle', message: 'No isolated UI designer preview is running.', diagnostics: [], cleanup: { ok: true } }
    }
    if (!this.launcher?.stopSync) return retainedTeardownResult(session, 'runner-stop-sync-unavailable')
    try {
      const stopped = this.launcher.stopSync(session.runnerId || undefined)
      const status = stopped.run?.status
      if (stopped.error || !status || !['stopped', 'exited', 'failed'].includes(status)) {
        return retainedTeardownResult(session, stopped.error || `runner-status:${status || 'unknown'}`)
      }
      const evidence = verifyIsolatedSourceStateForPreview(session)
      if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
        return retainedTeardownResult(session, evidence.stagingError || 'isolation-evidence-changed')
      }
      cleanupPreviewIsolation(session)
      this.active = null
      return {
        state: 'stopped',
        message: 'Isolated UI designer preview stopped and cleaned up during Electron teardown.',
        sessionId: session.sessionId,
        sourceProject: session.sourceProject,
        diagnostics: [],
        cleanup: { ok: true },
      }
    } catch (error) {
      return retainedTeardownResult(session, error instanceof Error ? error.message : String(error))
    }
  }
}

export async function waitForPreviewSceneReadiness(
  session: UiDesignerPreviewSession,
  expectedScene: string,
  signal?: AbortSignal,
  timeoutMs = UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_TIMEOUT_MS,
): Promise<UiDesignerPreviewSceneHandshake> {
  const deadline = Date.now() + Math.max(1, Math.min(UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_TIMEOUT_MS, Math.round(timeoutMs)))
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('UI preview startup was canceled.', 'AbortError')
    const engineEntry = readPreviewEngineEntryReceipt(session)
    const handshake = readPreviewSceneHandshake(session, expectedScene)
    if (engineEntry?.phase === 'engine-entry-loaded' && handshake) return handshake
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const loadState = readPreviewLoadState(session)
  const engineEntry = readPreviewEngineEntryReceipt(session)
  return {
    status: 'mismatch',
    expectedScene,
    actualScene: loadState
      ? `unavailable:${loadState}`
      : engineEntry?.phase === 'entry-failed'
        ? `unavailable:entry-failed:${engineEntry.stage}`
        : engineEntry
          ? `unavailable:${engineEntry.phase}`
          : 'unavailable:engine-entry-not-loaded',
  }
}

function retainedTeardownResult(session: UiDesignerPreviewSession, reason: string): UiPreviewResult {
  return {
    state: 'error',
    message: 'UI designer preview teardown could not prove a terminal runner and owned cleanup; the owner and temporary project were retained.',
    sessionId: session.sessionId,
    temporaryPath: session.temporaryProject,
    sourceProject: session.sourceProject,
    cleanup: { ok: false, message: reason },
    diagnostics: readPreviewDiagnostics(session),
    sceneHandshake: session.sceneHandshake,
    projectCompatibility: session.projectCompatibility,
  }
}

async function waitForSceneReadinessOrAbort(
  waiter: UiDesignerPreviewSceneReadinessWaiter,
  session: UiDesignerPreviewSession,
  expectedScene: string,
  signal: AbortSignal,
): Promise<UiDesignerPreviewSceneHandshake> {
  if (signal.aborted) throw new DOMException('UI preview startup was canceled.', 'AbortError')
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(new DOMException('UI preview startup was canceled.', 'AbortError'))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([waiter(session, expectedScene, signal), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function readPreviewSceneHandshake(session: UiDesignerPreviewSession, expectedScene: string): UiDesignerPreviewSceneHandshake | null {
  const resourceRoot = resolveRmmvLayout(session.temporaryProject).resourceRoot
  const handshakePath = path.resolve(resourceRoot, ...UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH.split('/'))
  if (!isPathWithin(path.resolve(session.temporaryProject), handshakePath) || !fs.existsSync(handshakePath)) return null
  try {
    const stat = fs.lstatSync(handshakePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024) return null
    const value = JSON.parse(fs.readFileSync(handshakePath, 'utf8')) as Record<string, unknown>
    const keys = Object.keys(value).sort().join(',')
    if (keys !== 'actualScene,expectedScene,schemaVersion,sessionId,status') return null
    if (value.schemaVersion !== UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION || value.sessionId !== session.sessionId || value.expectedScene !== expectedScene) return null
    if (value.status !== 'ready' && value.status !== 'mismatch') return null
    if (typeof value.actualScene !== 'string' || value.actualScene.length < 1 || value.actualScene.length > 128) return null
    return { status: value.status, expectedScene, actualScene: value.actualScene }
  } catch {
    return null
  }
}

type PreviewEngineEntryFailureStage = 'node-api' | 'document-url' | 'document-root' | 'targets' | 'session-marker' | 'session-boundary'

type PreviewEngineEntryReceipt =
  | { phase: 'entry-invoked' | 'engine-entry-loaded' }
  | { phase: 'entry-failed'; stage: PreviewEngineEntryFailureStage }

function readPreviewEngineEntryReceipt(session: UiDesignerPreviewSession): PreviewEngineEntryReceipt | null {
  const resourceRoot = resolveRmmvLayout(session.temporaryProject).resourceRoot
  const receiptPath = path.resolve(resourceRoot, ...UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_RELATIVE_PATH.split('/'))
  if (!isPathWithin(path.resolve(session.temporaryProject), receiptPath) || !fs.existsSync(receiptPath)) return null
  try {
    const stat = fs.lstatSync(receiptPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024) return null
    const value = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>
    if (value.schemaVersion !== UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION || value.sessionId !== session.sessionId) return null
    if (value.phase === 'entry-invoked' || value.phase === 'engine-entry-loaded') {
      return Object.keys(value).sort().join(',') === 'phase,schemaVersion,sessionId' ? { phase: value.phase } : null
    }
    if (value.phase !== 'entry-failed' || Object.keys(value).sort().join(',') !== 'phase,schemaVersion,sessionId,stage') return null
    if (!['node-api', 'document-url', 'document-root', 'targets', 'session-marker', 'session-boundary'].includes(String(value.stage))) return null
    return { phase: 'entry-failed', stage: value.stage as PreviewEngineEntryFailureStage }
  } catch {
    return null
  }
}

function readPreviewLoadState(session: UiDesignerPreviewSession): string | null {
  const resourceRoot = resolveRmmvLayout(session.temporaryProject).resourceRoot
  const statePath = path.resolve(resourceRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/'))
  if (!isPathWithin(path.resolve(session.temporaryProject), statePath) || !fs.existsSync(statePath)) return null
  try {
    const stat = fs.lstatSync(statePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024) return null
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>
    if (Object.keys(value).sort().join(',') !== 'phase,schemaVersion,sessionId') return null
    if (value.schemaVersion !== UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION || value.sessionId !== session.sessionId) return null
    if (!['engine-entry-loaded', 'bootstrap-loaded', 'runtime-configured', 'target-scheduled', 'scene-ready'].includes(String(value.phase))) return null
    return String(value.phase)
  } catch {
    return null
  }
}

function verifyIsolatedSourceStateForPreview(session: UiDesignerPreviewSession): ReturnType<typeof verifyIsolatedSourceState> {
  return verifyIsolatedSourceState(session.workflowRoot, session.preparation, {
    sourceProject: session.sourceProject,
    temporaryProject: session.temporaryProject,
  })
}

function cleanupPreviewIsolation(session: UiDesignerPreviewSession): void {
  try {
    cleanupIsolatedProject(session.preparation, {
      sourceProject: session.sourceProject,
      temporaryProject: session.temporaryProject,
    })
  } finally {
    session.temporaryProject = session.preparation.temporaryProject
  }
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
  profileDirectory: string
  evidence: UiDesignerPreviewEvidenceContract
}

function stagePreviewFiles(
  preparation: IsolatedProjectPreparation,
  expectedSourceProject: string,
  scene: UiRuntimeSceneExport,
  sessionId: string,
  engine: 'MV' | 'MZ',
): PreviewStageFilesResult {
  const temporaryProject = preparation.temporaryProject
  const assertStageOwnership = () => attestIsolatedPreparationResponse({
    sourceProject: expectedSourceProject,
    temporaryProject,
    ownership: preparation.ownership,
  }, preparation)
  const ownedWrite = <T>(write: () => T): T => {
    assertStageOwnership()
    const result = write()
    assertStageOwnership()
    return result
  }
  assertStageOwnership()
  const layout = resolveRmmvLayout(temporaryProject)
  const nwPlan = planIsolatedNwApp(layout.projectRoot, sessionId, 'ui-preview', layout.resourceRoot)
  const runtime = bundledUiDesignerRuntime()
  const runtimeDirectory = path.join(layout.resourceRoot, 'js', 'plugins')
  const sceneDirectory = path.join(runtimeDirectory, 'mzui-data')
  ownedWrite(() => fs.mkdirSync(runtimeDirectory, { recursive: true }))
  ownedWrite(() => fs.mkdirSync(sceneDirectory, { recursive: true }))
  const scenePath = path.join(sceneDirectory, `${scene.meta.sceneName}.json`)
  const runtimePath = path.join(runtimeDirectory, 'MZUIRuntime.js')
  const bootstrapPath = path.join(runtimeDirectory, 'MZUIDesignerPreviewBoot.js')
  const pluginsPath = path.join(layout.resourceRoot, 'js', 'plugins.js')
  const marker = path.join(sceneDirectory, '.ui-designer-preview.json')
  const diagnosticsPath = path.join(layout.resourceRoot, ...UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH.split('/'))
  const sceneHandshakePath = path.join(layout.resourceRoot, ...UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH.split('/'))
  const loadStatePath = path.join(layout.resourceRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/'))
  const engineEntryReceiptPath = path.join(sceneDirectory, '.ui-designer-engine-entry.json')
  const engineEntryPath = engine === 'MZ'
    ? path.join(layout.resourceRoot, 'js', 'main.js')
    : path.join(layout.resourceRoot, 'index.html')
  assertIsolatedNwWriteTarget(layout.projectRoot, scenePath, 'Isolated UI preview scene file')
  assertIsolatedNwWriteTarget(layout.projectRoot, runtimePath, 'Isolated UI preview runtime file')
  assertIsolatedNwWriteTarget(layout.projectRoot, bootstrapPath, 'Isolated UI preview Boot file')
  assertIsolatedNwWriteTarget(layout.projectRoot, pluginsPath, 'Isolated UI preview plugins.js', { required: true, maximumBytes: 2 * 1024 * 1024 })
  assertIsolatedNwWriteTarget(layout.projectRoot, marker, 'Isolated UI preview marker')
  assertIsolatedNwWriteTarget(layout.projectRoot, diagnosticsPath, 'Isolated UI preview diagnostics')
  assertIsolatedNwWriteTarget(layout.projectRoot, sceneHandshakePath, 'Isolated UI preview scene handshake')
  assertIsolatedNwWriteTarget(layout.projectRoot, loadStatePath, 'Isolated UI preview load state')
  assertIsolatedNwWriteTarget(layout.projectRoot, engineEntryReceiptPath, 'Isolated UI preview engine entry receipt')
  assertIsolatedNwWriteTarget(layout.projectRoot, engineEntryPath, 'Isolated UI preview engine entry', { required: true, maximumBytes: 8 * 1024 * 1024 })
  ownedWrite(() => fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8'))
  ownedWrite(() => fs.writeFileSync(runtimePath, runtime.source, 'utf8'))
  ownedWrite(() => fs.writeFileSync(bootstrapPath, previewBootstrapSource(
    sessionId,
    scene.meta.sceneName,
    runtime.version,
    path.relative(layout.resourceRoot, engineEntryReceiptPath).replace(/\\/g, '/'),
  ), 'utf8'))
  const pluginsSource = fs.existsSync(pluginsPath) ? fs.readFileSync(pluginsPath, 'utf8') : 'var $plugins = [];\n'
  const start = pluginsSource.indexOf('[')
  const end = pluginsSource.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('Isolated preview plugins.js is invalid.')
  const parsed = JSON.parse(pluginsSource.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('Isolated preview plugins.js must contain an array.')
  const projectPlugins = parsed.filter((item) => (
    item?.name !== 'MZUIDesignerPreviewEntry'
    && item?.name !== 'MZUIRuntime'
    && item?.name !== 'MZUIDesignerPreviewBoot'
  ))
  ownedWrite(() => fs.writeFileSync(pluginsPath, `var $plugins =\n${JSON.stringify(projectPlugins, null, 2)};\n`, 'utf8'))
  ownedWrite(() => wirePreviewRuntimeIntoEngineEntry(
    layout.resourceRoot,
    engine,
    path.relative(layout.resourceRoot, nwPlan.entryPath).replace(/\\/g, '/'),
  ))
  ownedWrite(() => fs.writeFileSync(diagnosticsPath, '', 'utf8'))
  if (fs.existsSync(sceneHandshakePath)) ownedWrite(() => fs.rmSync(sceneHandshakePath, { force: true }))
  if (fs.existsSync(loadStatePath)) ownedWrite(() => fs.rmSync(loadStatePath, { force: true }))
  if (fs.existsSync(engineEntryReceiptPath)) ownedWrite(() => fs.rmSync(engineEntryReceiptPath, { force: true }))
  ownedWrite(() => fs.writeFileSync(marker, `${JSON.stringify({
    scene: scene.meta.sceneName,
    runtimeVersion: runtime.version,
    sessionId,
    schemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
    diagnosticsPath: UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
    sceneHandshakeSchemaVersion: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION,
    sceneHandshakePath: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH,
    loadStateSchemaVersion: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
    loadStatePath: UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH,
    engineEntryReceiptSchemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
    engineEntryReceiptPath: path.relative(layout.resourceRoot, engineEntryReceiptPath).replace(/\\/g, '/'),
  }, null, 2)}\n`, 'utf8'))
  const nwPackage = ownedWrite(() => writeIsolatedNwAppPackage(
    nwPlan,
    previewEngineEntrySource(
      sessionId,
      scene.meta.sceneName,
      runtime.version,
      nwPlan.projectRoot,
      nwPlan.resourceRoot,
      path.join(fs.realpathSync.native(path.dirname(engineEntryReceiptPath)), path.basename(engineEntryReceiptPath)),
      path.join(fs.realpathSync.native(path.dirname(loadStatePath)), path.basename(loadStatePath)),
    ),
  ))
  assertIsolatedNwWriteTarget(layout.projectRoot, engineEntryReceiptPath, 'Isolated UI preview engine entry receipt')
  const profileDirectory = ownedWrite(() => createIsolatedNwProfileDirectory(layout.projectRoot, sessionId))
  assertStageOwnership()
  return {
    diagnosticsPath,
    profileDirectory,
    evidence: {
      paths: {
        engineEntry: path.relative(layout.projectRoot, engineEntryReceiptPath).replace(/\\/g, '/'),
        loadState: path.relative(layout.projectRoot, loadStatePath).replace(/\\/g, '/'),
        diagnostics: path.relative(layout.projectRoot, diagnosticsPath).replace(/\\/g, '/'),
        sceneHandshake: path.relative(layout.projectRoot, sceneHandshakePath).replace(/\\/g, '/'),
      },
      schemas: {
        engineEntry: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
        loadState: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
        diagnostics: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
        sceneHandshake: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION,
      },
      application: nwPackage.evidence,
    },
    affectedFiles: [
    path.relative(temporaryProject, scenePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, runtimePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, bootstrapPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, pluginsPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, engineEntryPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, nwPackage.packagePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, nwPackage.entryPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, engineEntryReceiptPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, marker).replace(/\\/g, '/'),
    path.relative(temporaryProject, diagnosticsPath).replace(/\\/g, '/'),
    path.relative(temporaryProject, sceneHandshakePath).replace(/\\/g, '/'),
    path.relative(temporaryProject, loadStatePath).replace(/\\/g, '/'),
    ],
  }
}

function previewEngineEntrySource(
  sessionId: string,
  sceneName: string,
  runtimeVersion: string,
  temporaryRoot: string,
  resourceRoot: string,
  engineEntryReceiptTarget: string,
  loadStateTarget: string,
): string {
  const receiptConfig = JSON.stringify({
    sessionId,
    sceneName,
    runtimeVersion,
    markerPath: 'js/plugins/mzui-data/.ui-designer-preview.json',
    diagnosticsPath: UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
    diagnosticsSchemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
    sceneHandshakePath: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH,
    sceneHandshakeSchemaVersion: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION,
    loadStatePath: UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH,
    loadStateSchemaVersion: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
    engineEntryReceiptPath: path.relative(resourceRoot, engineEntryReceiptTarget).replace(/\\/g, '/'),
    engineEntryReceiptSchemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
    temporaryRoot,
    resourceRoot,
    engineEntryReceiptTarget,
    loadStateTarget,
  }).replace(/</g, '\\u003c')
  return `(function () {
  'use strict';
  var config = ${receiptConfig};
  var receiptStage = 'node-api';
  var fs = null;
  var path = null;
  var writeEngineEntryReceipt = null;
  var receiptWritable = false;
  try {
    if (typeof require !== 'function') throw new Error('Node fs is unavailable at the isolated engine entry.');
    fs = require('fs');
    path = require('path');
    if (!fs || typeof fs.writeFileSync !== 'function' || typeof fs.renameSync !== 'function' || !path || typeof path.resolve !== 'function') throw new Error('The isolated engine entry requires the Node file APIs.');
    var realpath = fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync;
    var preparedRoot = realpath(config.temporaryRoot);
    if (preparedRoot !== config.temporaryRoot) throw new Error('The isolated engine entry prepared root changed after staging.');
    function isWithinRoot(candidate) {
      var relative = path.relative(preparedRoot, candidate);
      return relative === '' || (relative !== '..' && relative.slice(0, 3) !== '..' + path.sep && !path.isAbsolute(relative));
    }
    function boundAbsoluteReceiptTarget() {
      if (typeof config.engineEntryReceiptTarget !== 'string' || !config.engineEntryReceiptTarget || !path.isAbsolute(config.engineEntryReceiptTarget) || config.engineEntryReceiptTarget.indexOf('\\0') >= 0) throw new Error('The isolated engine entry receipt target is invalid.');
      var target = path.resolve(config.engineEntryReceiptTarget);
      if (target !== config.engineEntryReceiptTarget || !isWithinRoot(target)) throw new Error('The isolated engine entry receipt target escaped the prepared root.');
      var parentPath = path.dirname(target);
      var parentStat = fs.lstatSync(parentPath);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('The isolated engine entry receipt parent is invalid.');
      var parent = realpath(parentPath);
      if (parent !== parentPath || !isWithinRoot(parent)) throw new Error('The isolated engine entry receipt parent escaped the prepared root.');
      if (fs.existsSync(target)) {
        var targetStat = fs.lstatSync(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size > 8192) throw new Error('The isolated engine entry receipt is not an ordinary bounded file.');
      }
      return target;
    }
    function atomicWriteEngineEntryReceipt(phase, failedStage) {
      var target = boundAbsoluteReceiptTarget();
      var envelope = { schemaVersion: config.engineEntryReceiptSchemaVersion, sessionId: config.sessionId, phase: phase };
      if (phase === 'entry-failed') envelope.stage = failedStage;
      var serialized = JSON.stringify(envelope) + '\\n';
      if (serialized.length > 1024) throw new Error('The isolated engine entry receipt exceeded its bounded size.');
      var temporaryTarget = target + '.tmp';
      if (fs.existsSync(temporaryTarget)) throw new Error('The isolated engine entry receipt temporary target already exists.');
      fs.writeFileSync(temporaryTarget, serialized, { encoding: 'utf8', flag: 'wx' });
      try {
        fs.renameSync(temporaryTarget, target);
      } catch (error) {
        try {
          if (fs.existsSync(temporaryTarget)) {
            var temporaryStat = fs.lstatSync(temporaryTarget);
            if (temporaryStat.isFile() && !temporaryStat.isSymbolicLink()) fs.unlinkSync(temporaryTarget);
          }
        } catch (_) { /* Preserve the receipt failure. */ }
        throw error;
      }
      if (boundAbsoluteReceiptTarget() !== target || fs.readFileSync(target, 'utf8') !== serialized) throw new Error('The isolated engine entry receipt changed after its atomic update.');
    }
    receiptStage = 'targets';
    writeEngineEntryReceipt = atomicWriteEngineEntryReceipt;
    writeEngineEntryReceipt('entry-invoked');
    receiptWritable = true;
    receiptStage = 'node-api';
    if (typeof fs.appendFileSync !== 'function' || typeof fs.readFileSync !== 'function' || typeof fs.lstatSync !== 'function' || typeof path.basename !== 'function' || typeof path.relative !== 'function') throw new Error('The isolated engine entry Node APIs are incomplete.');
    receiptStage = 'document-url';
    var location = window.document && window.document.location;
    if (!location || location.protocol !== 'file:' || !location.pathname) throw new Error('The isolated engine entry does not expose a file document URL.');
    var decoded = decodeURIComponent(String(location.pathname));
    if (decoded.length > 3 && decoded.charAt(0) === '/' && decoded.charAt(2) === ':') decoded = decoded.slice(1);
    decoded = decoded.split('/').join(path.sep);
    receiptStage = 'document-root';
    var root = realpath(path.dirname(path.resolve(decoded)));
    if (root !== config.resourceRoot) throw new Error('The isolated engine entry document root does not match the prepared resource root.');
    if (!fs.existsSync(path.join(root, 'js', 'plugins')) || !fs.existsSync(path.join(root, 'data'))) throw new Error('The isolated engine entry document root is invalid.');
    if (!isWithinRoot(root)) throw new Error('The isolated engine entry resource root escaped the prepared temporary root.');
    receiptStage = 'targets';
    function boundTarget(relativePath, maximumBytes, expectedTarget) {
      if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.indexOf('\\0') >= 0) throw new Error('The isolated receipt target is invalid.');
      var segments = relativePath.split('/');
      if (segments.some(function (segment) { return !segment || segment === '.' || segment === '..'; })) throw new Error('The isolated receipt target is invalid.');
      var target = path.resolve(root, relativePath.split('/').join(path.sep));
      if (!isWithinRoot(target) || (expectedTarget && target !== expectedTarget)) throw new Error('The isolated receipt target escaped the prepared root.');
      var parentPath = path.dirname(target);
      var parentStat = fs.lstatSync(parentPath);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('The isolated receipt target parent is invalid.');
      var parent = realpath(parentPath);
      if (parent !== parentPath || !isWithinRoot(parent)) throw new Error('The isolated receipt target parent escaped the prepared root.');
      if (fs.existsSync(target)) {
        var targetStat = fs.lstatSync(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size > maximumBytes) throw new Error('The isolated receipt target is not an ordinary bounded file.');
      }
      return target;
    }
    boundTarget(config.engineEntryReceiptPath, 8192, config.engineEntryReceiptTarget);
    var loadStateTarget = boundTarget(config.loadStatePath, 8192, config.loadStateTarget);
    var diagnosticsTarget = boundTarget(config.diagnosticsPath, 524288, null);
    receiptStage = 'session-marker';
    var markerPath = boundTarget(config.markerPath, 8192, null);
    var stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('The isolated engine entry marker is invalid.');
    var marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    var keys = Object.keys(marker).sort().join(',');
    if (keys !== 'diagnosticsPath,engineEntryReceiptPath,engineEntryReceiptSchemaVersion,loadStatePath,loadStateSchemaVersion,runtimeVersion,scene,sceneHandshakePath,sceneHandshakeSchemaVersion,schemaVersion,sessionId') throw new Error('The isolated engine entry marker shape is invalid.');
    receiptStage = 'session-boundary';
    if (marker.sessionId !== config.sessionId || marker.scene !== config.sceneName || marker.runtimeVersion !== config.runtimeVersion || marker.schemaVersion !== config.diagnosticsSchemaVersion || marker.diagnosticsPath !== config.diagnosticsPath || marker.sceneHandshakeSchemaVersion !== config.sceneHandshakeSchemaVersion || marker.sceneHandshakePath !== config.sceneHandshakePath || marker.loadStateSchemaVersion !== config.loadStateSchemaVersion || marker.loadStatePath !== config.loadStatePath || marker.engineEntryReceiptSchemaVersion !== config.engineEntryReceiptSchemaVersion || marker.engineEntryReceiptPath !== config.engineEntryReceiptPath) throw new Error('The isolated engine entry marker does not match this session.');
    function writeLoadState(phase) {
      loadStateTarget = boundTarget(config.loadStatePath, 8192, config.loadStateTarget);
      fs.writeFileSync(loadStateTarget, JSON.stringify({ schemaVersion: config.loadStateSchemaVersion, sessionId: config.sessionId, phase: phase }) + '\\n', 'utf8');
    }
    function writeDiagnostic(code, file, message) {
      var envelope = {
        schemaVersion: config.diagnosticsSchemaVersion,
        sessionId: config.sessionId,
        scene: config.sceneName,
        file: file || null,
        node: null,
        type: null,
        phase: 'engine-entry',
        event: null,
        code: code,
        severity: 'error',
        label: 'engine-entry',
        message: String(message || 'The isolated engine entry failed.').slice(0, 1024),
        count: 1
      };
      var serialized = JSON.stringify(envelope);
      if (serialized.length <= 8192) {
        diagnosticsTarget = boundTarget(config.diagnosticsPath, 524288, null);
        fs.appendFileSync(diagnosticsTarget, serialized + '\\n', 'utf8');
      }
    }
    receiptStage = 'targets';
    writeEngineEntryReceipt('engine-entry-loaded');
    writeLoadState('engine-entry-loaded');
    var receipt = Object.freeze({ sessionId: config.sessionId, writeLoadState: writeLoadState, writeDiagnostic: writeDiagnostic });
    Object.defineProperty(window, '__mzuiPreviewEngineEntryReceipt', { value: receipt, configurable: false, enumerable: false, writable: false });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('error', function (event) {
        var target = event && event.target;
        var file = event && event.filename || target && target.src;
        writeDiagnostic(target && String(target.tagName || '').toLowerCase() === 'script' ? 'UI_PREVIEW_SCRIPT_LOAD_ERROR' : 'UI_PREVIEW_GLOBAL_ERROR', file ? path.basename(String(file)).slice(0, 256) : null, 'A script failed while the isolated preview engine entry was loading.');
      }, true);
      window.addEventListener('unhandledrejection', function () {
        writeDiagnostic('UI_PREVIEW_UNHANDLED_REJECTION', null, 'A promise was rejected while the isolated preview engine entry was loading.');
      });
    }
  } catch (error) {
    if (receiptWritable && typeof writeEngineEntryReceipt === 'function') {
      try { writeEngineEntryReceipt('entry-failed', receiptStage); } catch (_) { /* Preserve the earliest safe receipt. */ }
    }
  }
}());`
}

function previewBootstrapSource(
  sessionId: string,
  sceneName: string,
  runtimeVersion: string,
  engineEntryReceiptPath: string,
): string {
  const bootstrapConfig = JSON.stringify({
    sessionId,
    sceneName,
    runtimeVersion,
    markerPath: 'js/plugins/mzui-data/.ui-designer-preview.json',
    diagnosticsPath: UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
    diagnosticsSchemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
    sceneHandshakePath: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH,
    sceneHandshakeSchemaVersion: UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_SCHEMA_VERSION,
    loadStatePath: UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH,
    loadStateSchemaVersion: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
    engineEntryReceiptPath,
    engineEntryReceiptSchemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
  }).replace(/</g, '\\u003c')
  return `/*:
 * @target MV MZ
 * @plugindesc Luna RPG Agent isolated UI designer preview bootstrap
 * @author Luna RPG Agent
 * @help This file is generated only inside a temporary preview copy.
 */
(function () {
  'use strict';
  var config = ${bootstrapConfig};
  var marker = null;
  var markerRoot = '';
  var fs = null;
  var path = null;
  var sceneName = config.sceneName;
  var sceneHandshakeWritten = false;
  var sceneHandshakeTimer = null;
  function reportBootstrapFailure(code, message) {
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error('[MZUIRuntime:' + code + '] ' + String(message || 'UI preview bootstrap failed.').slice(0, 1024));
    }
  }
  function realpath(value) {
    return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  }
  function readSessionMarker(engineRoot) {
    var root = realpath(path.resolve(engineRoot));
    if (!fs.existsSync(path.join(root, 'js', 'plugins')) || !fs.existsSync(path.join(root, 'data'))) throw new Error('Resolved app root is not an RPG Maker resource root.');
    var file = path.join(root, config.markerPath);
    if (!fs.existsSync(file)) throw new Error('The isolated preview session marker is unavailable.');
    var stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('The isolated preview session marker is invalid.');
    var value = JSON.parse(fs.readFileSync(file, 'utf8'));
    var keys = Object.keys(value).sort().join(',');
    if (keys !== 'diagnosticsPath,engineEntryReceiptPath,engineEntryReceiptSchemaVersion,loadStatePath,loadStateSchemaVersion,runtimeVersion,scene,sceneHandshakePath,sceneHandshakeSchemaVersion,schemaVersion,sessionId') throw new Error('The isolated preview session marker shape is invalid.');
    if (value.sessionId !== config.sessionId || value.scene !== config.sceneName || value.runtimeVersion !== config.runtimeVersion || value.schemaVersion !== config.diagnosticsSchemaVersion || value.diagnosticsPath !== config.diagnosticsPath || value.sceneHandshakeSchemaVersion !== config.sceneHandshakeSchemaVersion || value.sceneHandshakePath !== config.sceneHandshakePath || value.loadStateSchemaVersion !== config.loadStateSchemaVersion || value.loadStatePath !== config.loadStatePath || value.engineEntryReceiptSchemaVersion !== config.engineEntryReceiptSchemaVersion || value.engineEntryReceiptPath !== config.engineEntryReceiptPath) throw new Error('The isolated preview session marker does not match this bootstrap.');
    marker = value;
    markerRoot = root;
  }
  try {
    if (typeof require !== 'function') throw new Error('Node fs is unavailable in the RPG Maker preview renderer.');
    fs = require('fs');
    path = require('path');
    if (!window.MZUIRuntime || typeof window.MZUIRuntime.resolveEngineRoot !== 'function') throw new Error('The shared Runtime cannot resolve the RPG Maker app document root.');
    readSessionMarker(window.MZUIRuntime.resolveEngineRoot());
  } catch (error) {
    marker = null;
    markerRoot = '';
    reportBootstrapFailure('UI_PREVIEW_MARKER_UNAVAILABLE', error && error.message ? error.message : String(error));
    var entryReceipt = window && window.__mzuiPreviewEngineEntryReceipt;
    if (entryReceipt && entryReceipt.sessionId === config.sessionId && typeof entryReceipt.writeDiagnostic === 'function') {
      entryReceipt.writeDiagnostic('UI_PREVIEW_BOOT_MARKER_UNAVAILABLE', null, 'The preview Boot script could not validate the isolated session marker.');
    }
  }
  function writeRuntimeDiagnostic(entry) {
    try {
      if (!marker || !fs || !path || marker.sessionId !== config.sessionId || marker.diagnosticsPath !== config.diagnosticsPath) return;
      var target = path.join(markerRoot, config.diagnosticsPath);
      var envelope = {
        schemaVersion: config.diagnosticsSchemaVersion,
        sessionId: config.sessionId,
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
  function writeLoadState(phase) {
    try {
      if (!marker || !fs || !path || marker.sessionId !== config.sessionId || marker.loadStatePath !== config.loadStatePath || marker.loadStateSchemaVersion !== config.loadStateSchemaVersion) return;
      var envelope = { schemaVersion: config.loadStateSchemaVersion, sessionId: config.sessionId, phase: phase };
      fs.writeFileSync(path.join(markerRoot, config.loadStatePath), JSON.stringify(envelope) + '\\n', 'utf8');
    } catch (error) {
      writeRuntimeDiagnostic({ code: 'UI_PREVIEW_LOAD_STATE_WRITE_FAILED', phase: 'bootstrap', label: 'load-state', message: error && error.message ? error.message : String(error) });
    }
  }
  function safeScriptFile(value) {
    var pieces = String(value || '').split(/[\\\\/]/);
    return pieces.length ? pieces[pieces.length - 1].slice(0, 256) : null;
  }
  if (marker && window && !window.__mzuiPreviewEngineEntryReceipt && typeof window.addEventListener === 'function') {
    window.addEventListener('error', function (event) {
      var target = event && event.target;
      var scriptFile = safeScriptFile(event && event.filename || target && target.src);
      writeRuntimeDiagnostic({
        code: target && String(target.tagName || '').toLowerCase() === 'script' ? 'UI_PREVIEW_SCRIPT_LOAD_ERROR' : 'UI_PREVIEW_GLOBAL_ERROR',
        phase: 'engine-load',
        label: 'global-error',
        file: scriptFile,
        message: event && event.message ? String(event.message) : 'A script failed while the isolated preview was loading.'
      });
    }, true);
    window.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      writeRuntimeDiagnostic({
        code: 'UI_PREVIEW_UNHANDLED_REJECTION',
        phase: 'engine-load',
        label: 'unhandled-rejection',
        message: reason && reason.message ? String(reason.message) : 'A promise was rejected while the isolated preview was loading.'
      });
    });
  }
  if (marker) writeLoadState('bootstrap-loaded');
  function writeSceneHandshake(status, actualScene) {
    try {
      if (sceneHandshakeWritten || !marker || !fs || !path || marker.sessionId !== config.sessionId || marker.sceneHandshakePath !== config.sceneHandshakePath || marker.sceneHandshakeSchemaVersion !== config.sceneHandshakeSchemaVersion) return;
      var envelope = {
        schemaVersion: config.sceneHandshakeSchemaVersion,
        sessionId: config.sessionId,
        status: status === 'ready' ? 'ready' : 'mismatch',
        expectedScene: sceneName,
        actualScene: String(actualScene || 'unavailable')
      };
      fs.writeFileSync(path.join(markerRoot, config.sceneHandshakePath), JSON.stringify(envelope) + '\\n', 'utf8');
      sceneHandshakeWritten = true;
      if (sceneHandshakeTimer !== null && typeof clearInterval === 'function') clearInterval(sceneHandshakeTimer);
      sceneHandshakeTimer = null;
    } catch (error) {
      writeRuntimeDiagnostic({ code: 'UI_PREVIEW_SCENE_HANDSHAKE_WRITE_FAILED', phase: 'bootstrap', label: 'scene-handshake', message: error && error.message ? error.message : String(error) });
    }
  }
  function actualSceneName() {
    var current = window.SceneManager && window.SceneManager._scene;
    if (!current) return 'unavailable';
    if (typeof window.Scene_Title === 'function' && current instanceof window.Scene_Title) return 'Scene_Title';
    if (typeof window[sceneName] === 'function' && current instanceof window[sceneName]) return sceneName;
    return current.constructor && current.constructor.name ? String(current.constructor.name) : 'unknown';
  }
  if (!marker || !sceneName) return;
  function failBootstrap(code, message) {
    writeRuntimeDiagnostic({ code: code, phase: 'bootstrap', label: 'preview-bootstrap', message: message });
    reportBootstrapFailure(code, message);
  }
  if (!window.MZUIRuntime || typeof window.MZUIRuntime.configure !== 'function' || typeof window.MZUIRuntime.isRegistered !== 'function') {
    failBootstrap('UI_PREVIEW_RUNTIME_UNAVAILABLE', 'The shared MZUIRuntime API is unavailable in the isolated preview.');
    return;
  }
  window.MZUIRuntime.configure({ onError: writeRuntimeDiagnostic });
  writeLoadState('runtime-configured');
  if (!window.MZUIRuntime.isRegistered(sceneName) && typeof window.MZUIRuntime.scanScenes === 'function') window.MZUIRuntime.scanScenes();
  var pushed = false;
  function pushTarget() {
    if (pushed) return;
    if (!window.SceneManager) { failBootstrap('UI_PREVIEW_SCENE_MANAGER_UNAVAILABLE', 'SceneManager is unavailable in the isolated preview.'); return; }
    if (!window.MZUIRuntime.isRegistered(sceneName)) { failBootstrap('UI_PREVIEW_SCENE_NOT_REGISTERED', 'The expected UI scene was not registered from the isolated project.'); return; }
    var target = window[sceneName];
    if (typeof target !== 'function') { failBootstrap('UI_PREVIEW_SCENE_CLASS_UNAVAILABLE', 'The expected UI scene class is unavailable after Runtime registration.'); return; }
    if (target.prototype && !target.prototype.__mzuiPreviewSceneHandshake) {
      var originalCreate = target.prototype.create;
      target.prototype.create = function () {
        if (typeof originalCreate === 'function') originalCreate.apply(this, arguments);
        writeLoadState('scene-ready');
        writeSceneHandshake('ready', sceneName);
      };
      Object.defineProperty(target.prototype, '__mzuiPreviewSceneHandshake', { value: true, configurable: false, enumerable: false, writable: false });
    }
    pushed = true;
    writeLoadState('target-scheduled');
    if (typeof window.SceneManager.goto === 'function') window.SceneManager.goto(target);
    else if (typeof window.SceneManager.push === 'function') window.SceneManager.push(target);
    if (typeof setInterval === 'function') {
      var checks = 0;
      sceneHandshakeTimer = setInterval(function () {
        checks += 1;
        var actual = actualSceneName();
        if (checks >= 60 && actual === 'Scene_Title') writeSceneHandshake('mismatch', actual);
        else if (checks >= 300) writeSceneHandshake('mismatch', actual);
      }, 50);
    }
  }
  function installBootStartBoundary() {
    var prototype = window.Scene_Boot && window.Scene_Boot.prototype;
    if (!prototype || typeof prototype.start !== 'function') { failBootstrap('UI_PREVIEW_BOOT_SCENE_UNAVAILABLE', 'Scene_Boot is unavailable in the isolated preview.'); return false; }
    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'start');
    if (descriptor && (!descriptor.configurable || typeof descriptor.value !== 'function')) { failBootstrap('UI_PREVIEW_BOOT_BOUNDARY_UNAVAILABLE', 'Scene_Boot.start cannot be guarded by the isolated preview.'); return false; }
    var delegate = prototype.start;
    var enumerable = descriptor ? descriptor.enumerable : true;
    function restore() {
      Object.defineProperty(prototype, 'start', { value: delegate, configurable: true, enumerable: enumerable, writable: true });
    }
    function boundary() {
      restore();
      var result = delegate.apply(this, arguments);
      pushTarget();
      return result;
    }
    Object.defineProperty(prototype, 'start', {
      configurable: true,
      enumerable: enumerable,
      get: function () { return boundary; },
      set: function (value) {
        if (typeof value === 'function') delegate = value;
        else failBootstrap('UI_PREVIEW_BOOT_BOUNDARY_INVALID', 'A project plugin replaced Scene_Boot.start with a non-function value.');
      }
    });
    return true;
  }
  function installSceneRunBoundary() {
    if (!window.SceneManager || typeof window.SceneManager.run !== 'function') { failBootstrap('UI_PREVIEW_SCENE_MANAGER_UNAVAILABLE', 'SceneManager.run is unavailable in the isolated preview.'); return; }
    var descriptor = Object.getOwnPropertyDescriptor(window.SceneManager, 'run');
    if (descriptor && (!descriptor.configurable || typeof descriptor.value !== 'function')) { failBootstrap('UI_PREVIEW_RUN_BOUNDARY_UNAVAILABLE', 'SceneManager.run cannot be guarded by the isolated preview.'); return; }
    var delegate = window.SceneManager.run;
    var enumerable = descriptor ? descriptor.enumerable : true;
    function restore() {
      Object.defineProperty(window.SceneManager, 'run', { value: delegate, configurable: true, enumerable: enumerable, writable: true });
    }
    function boundary() {
      restore();
      installBootStartBoundary();
      return delegate.apply(this, arguments);
    }
    Object.defineProperty(window.SceneManager, 'run', {
      configurable: true,
      enumerable: enumerable,
      get: function () { return boundary; },
      set: function (value) {
        if (typeof value === 'function') delegate = value;
        else failBootstrap('UI_PREVIEW_RUN_BOUNDARY_INVALID', 'A project plugin replaced SceneManager.run with a non-function value.');
      }
    });
  }
  installSceneRunBoundary();
}());
`;
}

function wirePreviewRuntimeIntoEngineEntry(
  resourceRoot: string,
  engine: 'MV' | 'MZ',
  entryRelativePath: string,
): string {
  if (entryRelativePath !== 'js/plugins/MZUIDesignerPreviewEntry.js') {
    throw new Error('Isolated UI preview requires the canonical external Entry script path.')
  }
  if (engine === 'MZ') {
    const mainPath = path.join(resourceRoot, 'js', 'main.js')
    if (!fs.existsSync(mainPath) || !fs.statSync(mainPath).isFile()) throw new Error('Isolated MZ preview requires the standard js/main.js engine entry.')
    const source = fs.readFileSync(mainPath, 'utf8')
    if (source.includes('__mzuiPreviewEngineEntryReceipt') || source.includes(entryRelativePath) || source.includes('js/plugins/MZUIRuntime.js') || source.includes('js/plugins/MZUIDesignerPreviewBoot.js')) {
      throw new Error('Isolated MZ preview engine entry already contains a UI designer runtime script.')
    }
    const declarationStart = source.indexOf('const scriptUrls')
    const arrayStart = declarationStart >= 0 ? source.indexOf('[', declarationStart) : -1
    const arrayEnd = arrayStart >= 0 ? source.indexOf('];', arrayStart) : -1
    if (declarationStart < 0 || arrayStart < 0 || arrayEnd < 0) throw new Error('Isolated MZ preview requires the standard scriptUrls engine entry.')
    const loaderSource = source.slice(arrayEnd + 2)
    if (!/\bthis\.loadCount\s*=\s*0\b/.test(loaderSource)
      || !/\+\+this\.loadCount\s*===\s*this\.numScripts\b/.test(loaderSource)
      || !/\bthis\.numScripts\s*=\s*scriptUrls\.length\b/.test(loaderSource)
      || !/\bscript\.async\s*=\s*false\b/.test(loaderSource)
      || !/\bscript\.onload\s*=/.test(loaderSource)
      || !/document\.body\.appendChild\(script\)/.test(loaderSource)) {
      throw new Error('Isolated MZ preview requires the supported scriptUrls load-count barrier.')
    }
    const arraySource = source.slice(arrayStart, arrayEnd)
    const matches = [...arraySource.matchAll(/(["'])js\/plugins\.js\1/g)]
    if (matches.length !== 1 || matches[0].index === undefined) throw new Error('Isolated MZ preview requires exactly one js/plugins.js engine entry.')
    const insertion = arrayStart + matches[0].index
    const injected = `"${entryRelativePath}",\n    "js/plugins/MZUIRuntime.js",\n    "js/plugins/MZUIDesignerPreviewBoot.js",\n    `
    const wiredSource = `${source.slice(0, insertion)}${injected}${source.slice(insertion)}`
    fs.writeFileSync(mainPath, wiredSource, 'utf8')
    return mainPath
  }

  const indexPath = path.join(resourceRoot, 'index.html')
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) throw new Error('Isolated MV preview requires the standard index.html engine entry.')
  const source = fs.readFileSync(indexPath, 'utf8')
  if (source.includes('__mzuiPreviewEngineEntryReceipt') || source.includes(entryRelativePath) || source.includes('js/plugins/MZUIRuntime.js') || source.includes('js/plugins/MZUIDesignerPreviewBoot.js')) {
    throw new Error('Isolated MV preview engine entry already contains a UI designer runtime script.')
  }
  const matches = [...source.matchAll(/<script\b[^>]*\bsrc=(["'])js\/plugins\.js\1[^>]*><\/script\s*>/gi)]
  if (matches.length !== 1 || matches[0].index === undefined) throw new Error('Isolated MV preview requires exactly one js/plugins.js script entry.')
  const mainMatches = [...source.matchAll(/<script\b[^>]*\bsrc=(["'])js\/main\.js\1[^>]*><\/script\s*>/gi)]
  if (mainMatches.length !== 1 || mainMatches[0].index === undefined || mainMatches[0].index <= matches[0].index) {
    throw new Error('Isolated MV preview requires the standard synchronous plugins.js then main.js script order.')
  }
  const mainPath = path.join(resourceRoot, 'js', 'main.js')
  if (!fs.existsSync(mainPath) || !fs.statSync(mainPath).isFile()) throw new Error('Isolated MV preview requires the standard js/main.js engine entry.')
  const mainSource = fs.readFileSync(mainPath, 'utf8')
  if (!/PluginManager\.setup\(\$plugins\)/.test(mainSource) || !/SceneManager\.run\(Scene_Boot\)/.test(mainSource)) {
    throw new Error('Isolated MV preview requires the supported synchronous plugin setup and Scene_Boot entry.')
  }
  const runtimeScripts = [
    `<script type="text/javascript" src="${entryRelativePath}"></script>`,
    '<script type="text/javascript" src="js/plugins/MZUIRuntime.js"></script>',
    '<script type="text/javascript" src="js/plugins/MZUIDesignerPreviewBoot.js"></script>',
    '',
  ].join('\n')
  const insertion = matches[0].index + matches[0][0].length
  const wiredSource = `${source.slice(0, insertion)}\n${runtimeScripts}${source.slice(insertion)}`
  fs.writeFileSync(indexPath, wiredSource, 'utf8')
  return indexPath
}

export function defaultUiDesignerPreviewTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-preview-'))
}
