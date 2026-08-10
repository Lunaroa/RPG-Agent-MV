import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts'
import type { IsolatedProjectPreparation } from './isolated-project-preparation.ts'
import { attestOwnedIsolatedProject } from './isolated-project-attestation.ts'
import type { InteractiveProjectRuntime } from './interactive-playtest-runtime.ts'

const PACKAGE_MAX_BYTES = 64 * 1024
const INDEX_MAX_BYTES = 8 * 1024 * 1024
const ENTRY_MAX_BYTES = 512 * 1024
const SESSION_ID_MAX_LENGTH = 256

export type IsolatedNwAppKind = 'map-preview' | 'ui-preview'
export type IsolatedNwProjectLocalRuntimeLocation = 'source-project' | 'staged-project'

export interface IsolatedNwLaunchEvidencePlan {
  readonly schemaVersion: '1.0.0'
  readonly engine: 'rpg-maker-mv' | 'rpg-maker-mz'
  readonly launchStyle: 'embedded' | 'external'
  readonly runtimeSource: 'project-local' | 'configured' | 'official-install'
  readonly projectLocalRuntimeLocation: IsolatedNwProjectLocalRuntimeLocation
  readonly executableRole: 'copied-project-runtime' | 'staged-project-runtime' | 'external-runtime'
  readonly argumentRoles: readonly ('session-profile' | 'nwapp-temporary-project' | 'test')[]
  readonly checks: {
    readonly sourceTemporaryDistinct: boolean
    readonly profileInsideTemporary: true
    readonly executableInsideTemporary: boolean
    readonly nwappExplicit: boolean
  }
  readonly digests: {
    readonly session: string
    readonly sourceProject: string
    readonly temporaryProject: string
    readonly profileDirectory: string
    readonly executable: string
  }
}

export interface IsolatedNwWindowPatch {
  width?: number
  height?: number
  frame?: boolean
  show?: boolean
  show_in_taskbar?: boolean
  resizable?: boolean
}

export interface IsolatedNwAppPlan {
  readonly kind: IsolatedNwAppKind
  readonly sessionId: string
  readonly projectRoot: string
  readonly resourceRoot: string
  readonly packagePath: string
  readonly indexPath: string
  readonly entryDirectory: string
  readonly entryPath: string
  readonly entryRelativePath: string
  readonly appName: string
  readonly activePackageMain: string
  readonly packageSource: string
}

export interface IsolatedNwActivePackageEvidence {
  readonly schemaVersion: '1.0.0'
  readonly activePackageMain: string
  readonly uniqueNameValid: true
  readonly entryRelativePath: string
  readonly digests: {
    readonly package: string
    readonly index: string
    readonly entry: string
  }
}

export interface IsolatedNwAppPackageResult {
  packagePath: string
  entryPath: string
  entryRelativePath: string
  appName: string
  evidence: IsolatedNwActivePackageEvidence
}

export function planIsolatedNwApp(
  projectRootInput: string,
  sessionIdInput: string,
  kind: IsolatedNwAppKind,
  expectedResourceRootInput?: string,
): IsolatedNwAppPlan {
  const sessionId = normalizedSessionId(sessionIdInput)
  const projectRoot = ordinaryDirectoryRealpath(path.resolve(projectRootInput), 'Isolated NW project root')
  const layout = resolveRmmvLayout(projectRoot)
  const resourceRoot = ordinaryDirectoryRealpath(layout.resourceRoot, 'Isolated NW resource root', projectRoot)
  ordinaryDirectoryRealpath(layout.dataDir, 'Isolated NW data directory', projectRoot)
  if (expectedResourceRootInput) {
    const expected = ordinaryDirectoryRealpath(path.resolve(expectedResourceRootInput), 'Expected isolated NW resource root', projectRoot)
    if (expected !== resourceRoot) throw new Error('The isolated NW resource root does not match the resolved RPG Maker layout.')
  }

  const packagePath = path.join(projectRoot, 'package.json')
  const packageSource = boundedOrdinaryFileSource(packagePath, 'Isolated NW package.json', PACKAGE_MAX_BYTES, projectRoot)
  const packageValue = parsedObject(packageSource, 'Isolated NW package.json')
  const main = safeProjectRelativePath(packageValue.main, 'Isolated NW package.json main')
  const indexPath = path.join(resourceRoot, 'index.html')
  boundedOrdinaryFileSource(indexPath, 'Isolated NW index.html', INDEX_MAX_BYTES, projectRoot)
  const mainReal = ordinaryFileRealpath(path.resolve(projectRoot, ...main.split('/')), 'Isolated NW package.json main', projectRoot)
  const indexReal = ordinaryFileRealpath(indexPath, 'Isolated NW index.html', projectRoot)
  if (mainReal !== indexReal) {
    throw new Error('Isolated NW package.json main must resolve exactly to the RPG Maker resource-root index.html.')
  }
  if (packageValue.window !== undefined && !isRecord(packageValue.window)) {
    throw new Error('Isolated NW package.json window must be an object when present.')
  }

  const scriptsDirectory = ordinaryDirectoryRealpath(path.join(resourceRoot, 'js'), 'Isolated NW script directory', projectRoot)
  let entryDirectory = scriptsDirectory
  if (kind === 'ui-preview') {
    const pluginsDirectory = ordinaryDirectoryRealpath(path.join(scriptsDirectory, 'plugins'), 'Isolated NW plugin directory', projectRoot)
    entryDirectory = pluginsDirectory
  }
  const entryPath = path.join(entryDirectory, isolatedNwEntryScriptName(kind, sessionId))
  assertConfinedMissingTarget(projectRoot, entryPath, 'Isolated NW entry script')
  const entryRelativePath = path.relative(path.dirname(packagePath), entryPath).split(path.sep).join('/')
  if (safeProjectRelativePath(entryRelativePath, 'Isolated NW entry script') !== entryRelativePath) {
    throw new Error('Isolated NW entry script must be a canonical project-relative path.')
  }
  return Object.freeze({
    kind,
    sessionId,
    projectRoot,
    resourceRoot,
    packagePath,
    indexPath,
    entryDirectory,
    entryPath,
    entryRelativePath,
    appName: isolatedNwAppName(kind, sessionId),
    activePackageMain: main,
    packageSource,
  })
}

export function writeIsolatedNwAppPackage(
  plan: IsolatedNwAppPlan,
  entrySource: string,
  options: { window?: IsolatedNwWindowPatch; disableRafThrottling?: boolean } = {},
): IsolatedNwAppPackageResult {
  const sourceBytes = Buffer.byteLength(entrySource, 'utf8')
  if (sourceBytes < 1 || sourceBytes > ENTRY_MAX_BYTES) {
    throw new Error('Isolated NW entry source exceeded the bounded size.')
  }
  ordinaryDirectoryRealpath(plan.projectRoot, 'Isolated NW project root')
  ordinaryDirectoryRealpath(plan.resourceRoot, 'Isolated NW resource root', plan.projectRoot)
  ordinaryDirectoryRealpath(plan.entryDirectory, 'Isolated NW entry directory', plan.projectRoot)
  const activeIndexSource = boundedOrdinaryFileSource(plan.indexPath, 'Isolated NW index.html', INDEX_MAX_BYTES, plan.projectRoot)
  const currentPackageSource = boundedOrdinaryFileSource(plan.packagePath, 'Isolated NW package.json', PACKAGE_MAX_BYTES, plan.projectRoot)
  if (currentPackageSource !== plan.packageSource) throw new Error('Isolated NW package.json changed after validation.')
  assertConfinedMissingTarget(plan.projectRoot, plan.entryPath, 'Isolated NW entry script')

  const manifest = parsedObject(currentPackageSource, 'Isolated NW package.json')
  const currentWindow = manifest.window === undefined ? {} : parsedRecord(manifest.window, 'Isolated NW package.json window')
  const preservedWindow = { ...currentWindow }
  if (manifest.inject_js_start === plan.entryRelativePath) delete manifest.inject_js_start
  if (preservedWindow.inject_js_start === plan.entryRelativePath) delete preservedWindow.inject_js_start
  const windowPatch = normalizedWindowPatch(options.window)
  manifest.name = plan.appName
  manifest['single-instance'] = false
  manifest.window = { ...preservedWindow, ...windowPatch }
  if (options.disableRafThrottling) {
    if (manifest['chromium-args'] !== undefined && typeof manifest['chromium-args'] !== 'string') {
      throw new Error('Isolated NW package.json chromium-args must be a string when present.')
    }
    const args = String(manifest['chromium-args'] || '').split(/\s+/).filter(Boolean)
    if (!args.includes('--disable-raf-throttling')) args.push('--disable-raf-throttling')
    manifest['chromium-args'] = args.join(' ')
  }

  const writtenPackageSource = `${JSON.stringify(manifest, null, 2)}\n`
  let entryWritten = false
  try {
    fs.writeFileSync(plan.entryPath, entrySource, { encoding: 'utf8', flag: 'wx' })
    entryWritten = true
    fs.writeFileSync(plan.packagePath, writtenPackageSource, 'utf8')
  } catch (error) {
    if (entryWritten) {
      try { fs.rmSync(plan.entryPath, { force: true }) } catch { /* Preserve the package staging failure. */ }
    }
    throw error
  }
  if (!/^rpg-agent-(?:map-preview|ui-preview)-[a-f0-9]{20}$/.test(plan.appName) || plan.appName.length > 63) {
    throw new Error('Isolated NW package name is not a bounded unique session name.')
  }
  const persistedPackageSource = boundedOrdinaryFileSource(plan.packagePath, 'Isolated NW package.json', PACKAGE_MAX_BYTES, plan.projectRoot)
  const persistedEntrySource = boundedOrdinaryFileSource(plan.entryPath, 'Isolated NW entry script', ENTRY_MAX_BYTES, plan.projectRoot)
  if (persistedPackageSource !== writtenPackageSource || persistedEntrySource !== entrySource) {
    throw new Error('Isolated NW active package changed after staging.')
  }
  return {
    packagePath: plan.packagePath,
    entryPath: plan.entryPath,
    entryRelativePath: plan.entryRelativePath,
    appName: plan.appName,
    evidence: Object.freeze({
      schemaVersion: '1.0.0',
      activePackageMain: plan.activePackageMain,
      uniqueNameValid: true,
      entryRelativePath: plan.entryRelativePath,
      digests: Object.freeze({
        package: sha256(persistedPackageSource),
        index: sha256(activeIndexSource),
        entry: sha256(persistedEntrySource),
      }),
    }),
  }
}

export function createIsolatedNwProfileDirectory(projectRootInput: string, sessionIdInput: string): string {
  const projectRoot = ordinaryDirectoryRealpath(path.resolve(projectRootInput), 'Isolated NW project root')
  const profilePath = path.join(projectRoot, isolatedNwProfileDirectoryName(sessionIdInput))
  assertConfinedMissingTarget(projectRoot, profilePath, 'Isolated NW session profile')
  fs.mkdirSync(profilePath)
  return ordinaryDirectoryRealpath(profilePath, 'Isolated NW session profile', projectRoot)
}

export function assertIsolatedNwWriteTarget(
  projectRootInput: string,
  targetInput: string,
  label: string,
  options: { required?: boolean; maximumBytes?: number } = {},
): string {
  const projectRoot = ordinaryDirectoryRealpath(path.resolve(projectRootInput), 'Isolated NW project root')
  const target = path.resolve(targetInput)
  if (!isInside(projectRoot, target)) throw new Error(`${label} escaped the isolated project.`)
  ordinaryDirectoryRealpath(path.dirname(target), `${label} parent`, projectRoot)
  if (!fs.existsSync(target)) {
    if (options.required) throw new Error(`${label} does not exist.`)
    return target
  }
  const real = ordinaryFileRealpath(target, label, projectRoot)
  const maximumBytes = options.maximumBytes
  if (maximumBytes !== undefined && fs.lstatSync(real).size > maximumBytes) {
    throw new Error(`${label} exceeded the bounded size.`)
  }
  return real
}

export function buildIsolatedNwLaunchCommand(
  runtime: InteractiveProjectRuntime,
  preparation: IsolatedProjectPreparation,
  sessionIdInput: string,
  profileDirectoryInput: string,
  projectLocalRuntimeLocation: IsolatedNwProjectLocalRuntimeLocation,
): { executable: string; args: string[]; evidence: IsolatedNwLaunchEvidencePlan } {
  const sessionId = normalizedSessionId(sessionIdInput)
  const attestation = attestOwnedIsolatedProject(
    preparation.sourceProject,
    preparation.temporaryProject,
    preparation.ownership,
  )
  const sourceProject = attestation.sourceProject
  const temporaryProject = attestation.temporaryProject
  const profileDirectory = ordinaryDirectoryRealpath(path.resolve(profileDirectoryInput), 'Isolated NW session profile', temporaryProject)
  const expectedProfile = path.join(temporaryProject, isolatedNwProfileDirectoryName(sessionId))
  if (!fs.existsSync(expectedProfile)
    || profileDirectory !== ordinaryDirectoryRealpath(expectedProfile, 'Expected isolated NW session profile', temporaryProject)) {
    throw new Error('Isolated NW session profile does not belong to the requested session.')
  }
  const profileArgument = `--user-data-dir=${profileDirectory}`
  const executable = isolatedNwExecutable(runtime, sourceProject, temporaryProject, projectLocalRuntimeLocation)
  const externalArguments = runtime.engine === 'rpg-maker-mv'
    ? [profileArgument, `--nwapp=${temporaryProject}`, 'test']
    : [profileArgument, `--nwapp=${temporaryProject}`]
  const argumentRoles: IsolatedNwLaunchEvidencePlan['argumentRoles'] = runtime.launchStyle === 'embedded'
    ? ['session-profile']
    : runtime.engine === 'rpg-maker-mv'
      ? ['session-profile', 'nwapp-temporary-project', 'test']
      : ['session-profile', 'nwapp-temporary-project']
  return {
    executable: executable.path,
    args: runtime.launchStyle === 'embedded' ? [profileArgument] : externalArguments,
    evidence: Object.freeze({
      schemaVersion: '1.0.0',
      engine: runtime.engine,
      launchStyle: runtime.launchStyle,
      runtimeSource: runtime.source,
      projectLocalRuntimeLocation,
      executableRole: executable.role,
      argumentRoles,
      checks: Object.freeze({
        sourceTemporaryDistinct: attestation.sourceProject !== attestation.temporaryProject,
        profileInsideTemporary: true,
        executableInsideTemporary: isInside(temporaryProject, executable.path),
        nwappExplicit: runtime.launchStyle === 'external',
      }),
      digests: Object.freeze({
        session: evidenceDigest('session', sessionId),
        sourceProject: evidenceDigest('source-project', sourceProject),
        temporaryProject: evidenceDigest('temporary-project', temporaryProject),
        profileDirectory: evidenceDigest('session-profile', profileDirectory),
        executable: evidenceDigest('runtime-executable', executable.path),
      }),
    }),
  }
}

export function isolatedNwEntryScriptName(kind: IsolatedNwAppKind, sessionIdInput: string): string {
  return kind === 'ui-preview'
    ? 'MZUIDesignerPreviewEntry.js'
    : `rpg-agent-${kind}-entry-${sessionDigest(sessionIdInput)}.js`
}

function isolatedNwAppName(kind: IsolatedNwAppKind, sessionId: string): string {
  return `rpg-agent-${kind}-${sessionDigest(sessionId)}`
}

function isolatedNwProfileDirectoryName(sessionId: string): string {
  return `.rpg-agent-preview-profile-${sessionDigest(sessionId)}`
}

function sessionDigest(sessionIdInput: string): string {
  return crypto.createHash('sha256').update(normalizedSessionId(sessionIdInput)).digest('hex').slice(0, 20)
}

function normalizedSessionId(value: string): string {
  const sessionId = typeof value === 'string' ? value.trim() : ''
  if (!sessionId || sessionId.length > SESSION_ID_MAX_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(sessionId)) {
    throw new Error('Isolated NW session id is invalid.')
  }
  return sessionId
}

function isolatedNwExecutable(
  runtime: InteractiveProjectRuntime,
  sourceProject: string,
  temporaryProject: string,
  projectLocalRuntimeLocation: IsolatedNwProjectLocalRuntimeLocation,
): { path: string; role: IsolatedNwLaunchEvidencePlan['executableRole'] } {
  if (runtime.source === 'project-local') {
    if (projectLocalRuntimeLocation === 'staged-project') {
      return {
        path: ordinaryFileRealpath(runtime.executable, 'Staged project-local NW executable', temporaryProject),
        role: 'staged-project-runtime',
      }
    }
    const runtimeExecutable = ordinaryFileRealpath(runtime.executable, 'Source project-local NW executable', sourceProject)
    const relative = path.relative(sourceProject, runtimeExecutable)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Source project-local NW executable escaped the source project.')
    }
    return {
      path: ordinaryFileRealpath(path.join(temporaryProject, relative), 'Copied isolated NW executable', temporaryProject),
      role: 'copied-project-runtime',
    }
  }
  if (runtime.launchStyle === 'embedded') {
    throw new Error('Embedded NW runtimes must be copied into the isolated project.')
  }
  return { path: ordinaryFileRealpath(runtime.executable, 'External NW executable'), role: 'external-runtime' }
}

function evidenceDigest(role: string, value: string): string {
  return crypto.createHash('sha256').update(`${role}\0${value}`).digest('hex')
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function boundedOrdinaryFileSource(filePath: string, label: string, maximumBytes: number, root?: string): string {
  const resolved = ordinaryFileRealpath(filePath, label, root)
  const stat = fs.lstatSync(resolved)
  if (stat.size < 1 || stat.size > maximumBytes) throw new Error(`${label} exceeded the bounded size.`)
  return fs.readFileSync(resolved, 'utf8')
}

function ordinaryFileRealpath(filePath: string, label: string, root?: string): string {
  const resolved = path.resolve(filePath)
  if (root && !isInside(path.resolve(root), resolved)) throw new Error(`${label} escaped the isolated project.`)
  if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist.`)
  const stat = fs.lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary non-symlink file.`)
  const real = fs.realpathSync.native(resolved)
  if (root && !isInside(path.resolve(root), real)) throw new Error(`${label} escaped the isolated project.`)
  return real
}

function ordinaryDirectoryRealpath(directoryPath: string, label: string, root?: string): string {
  const resolved = path.resolve(directoryPath)
  if (root && !isInside(path.resolve(root), resolved)) throw new Error(`${label} escaped the isolated project.`)
  if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist.`)
  const stat = fs.lstatSync(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary non-symlink directory.`)
  const real = fs.realpathSync.native(resolved)
  if (root && !isInside(path.resolve(root), real)) throw new Error(`${label} escaped the isolated project.`)
  return real
}

function assertConfinedMissingTarget(rootInput: string, targetInput: string, label: string): void {
  const root = path.resolve(rootInput)
  const target = path.resolve(targetInput)
  if (!isInside(root, target)) throw new Error(`${label} escaped the isolated project.`)
  ordinaryDirectoryRealpath(path.dirname(target), `${label} parent`, root)
  if (fs.existsSync(target)) throw new Error(`${label} already exists in the isolated project.`)
}

function safeProjectRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:\//.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a safe project-relative path.`)
  }
  return value
}

function parsedObject(source: string, label: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error(`${label} must contain valid JSON.`) }
  return parsedRecord(value, label)
}

function parsedRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must contain an object.`)
  return { ...value }
}

function normalizedWindowPatch(value: IsolatedNwWindowPatch | undefined): IsolatedNwWindowPatch {
  if (!value) return {}
  const result: IsolatedNwWindowPatch = {}
  for (const key of ['width', 'height'] as const) {
    const current = value[key]
    if (current === undefined) continue
    if (!Number.isSafeInteger(current) || current < 1 || current > 16_384) throw new Error(`Isolated NW window ${key} is invalid.`)
    result[key] = current
  }
  for (const key of ['frame', 'show', 'show_in_taskbar', 'resizable'] as const) {
    const current = value[key]
    if (current === undefined) continue
    if (typeof current !== 'boolean') throw new Error(`Isolated NW window ${key} is invalid.`)
    result[key] = current
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
