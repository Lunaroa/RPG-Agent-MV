import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ISOLATED_PROJECT_OWNERSHIP_SCHEMA_VERSION = '1.0.0' as const
const OWNERSHIP_TOKEN_PATTERN = /^[a-f0-9]{64}$/
const OWNERSHIP_MARKER_PATTERN = /^\.rpg-agent-isolation-[a-f0-9]{20}\.json$/
const OWNERSHIP_MARKER_MAX_BYTES = 2 * 1024

export interface IsolatedProjectOwnership {
  schemaVersion: typeof ISOLATED_PROJECT_OWNERSHIP_SCHEMA_VERSION
  ownershipToken: string
  markerRelativePath: string
  sourceIdentityDigest: string
  temporaryIdentityDigest: string
}

export interface IsolatedProjectOwnershipChallenge {
  sourceProject: string
  temporaryProject: string
  ownership: IsolatedProjectOwnership
}

export interface IsolatedProjectAttestation extends IsolatedProjectOwnershipChallenge {
  markerPath: string
}

export interface CreateIsolatedProjectOwnershipOptions {
  temporaryPrefix?: string
  /** Deterministic test/backend path. It must not exist; this helper creates it exclusively. */
  temporaryProjectPath?: string
}

export class IsolatedProjectAttestationError extends Error {
  readonly code = 'ISOLATED_PROJECT_ATTESTATION_FAILED'
  readonly reason: string

  constructor(reason: string) {
    super(`Isolated project attestation failed: ${reason}.`)
    this.name = 'IsolatedProjectAttestationError'
    this.reason = reason
  }
}

export function canonicalizeIsolatedSourceProject(sourceInput: string): string {
  return canonicalOrdinaryDirectory(sourceInput, 'source-not-ordinary')
}

export function createOwnedEmptyIsolatedProject(
  sourceInput: string,
  options: CreateIsolatedProjectOwnershipOptions = {},
): IsolatedProjectOwnershipChallenge {
  const sourceProject = canonicalizeIsolatedSourceProject(sourceInput)
  const temporaryPrefix = options.temporaryPrefix || 'rmmv-agent-isolated-'
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(temporaryPrefix)) {
    throw new IsolatedProjectAttestationError('temporary-prefix-invalid')
  }
  let temporaryInput: string
  let directoryCreated = false
  if (options.temporaryProjectPath) {
    const requested = path.resolve(options.temporaryProjectPath)
    if (fs.existsSync(requested)) throw new IsolatedProjectAttestationError('temporary-already-exists')
    const parent = canonicalOrdinaryDirectory(path.dirname(requested), 'temporary-parent-not-ordinary')
    temporaryInput = path.join(parent, path.basename(requested))
    assertProjectsDisjoint(sourceProject, temporaryInput)
    fs.mkdirSync(temporaryInput)
    directoryCreated = true
  } else {
    const temporaryParent = canonicalOrdinaryDirectory(os.tmpdir(), 'temporary-parent-not-ordinary')
    if (sameCanonicalPath(sourceProject, temporaryParent) || containsPath(sourceProject, temporaryParent)) {
      throw new IsolatedProjectAttestationError('temporary-parent-inside-source')
    }
    temporaryInput = fs.mkdtempSync(path.join(temporaryParent, temporaryPrefix))
    directoryCreated = true
  }
  let temporaryProject: string
  let createdOwnership: IsolatedProjectOwnership | null = null
  try {
    temporaryProject = canonicalOrdinaryDirectory(temporaryInput, 'temporary-not-ordinary')
    assertProjectsDisjoint(sourceProject, temporaryProject)
    if (fs.readdirSync(temporaryProject).length !== 0) {
      throw new IsolatedProjectAttestationError('temporary-not-empty')
    }
    const ownershipToken = crypto.randomBytes(32).toString('hex')
    const markerRelativePath = `.rpg-agent-isolation-${ownershipToken.slice(0, 20)}.json`
    const ownership: IsolatedProjectOwnership = {
      schemaVersion: ISOLATED_PROJECT_OWNERSHIP_SCHEMA_VERSION,
      ownershipToken,
      markerRelativePath,
      sourceIdentityDigest: directoryIdentityDigest('source', sourceProject),
      temporaryIdentityDigest: directoryIdentityDigest('temporary', temporaryProject),
    }
    createdOwnership = ownership
    const markerPath = path.join(temporaryProject, markerRelativePath)
    fs.writeFileSync(markerPath, `${JSON.stringify(ownership)}\n`, { encoding: 'utf8', flag: 'wx' })
    attestOwnedIsolatedProject(sourceProject, temporaryProject, ownership, { requireMarkerOnly: true })
    return { sourceProject, temporaryProject, ownership }
  } catch (error) {
    // A directory is removable here only when this invocation created a valid
    // marker. Unknown, non-empty, overlapping, or aliased paths stay untouched.
    if (directoryCreated && createdOwnership && isChallengeOwnedByCurrentCall(sourceProject, temporaryInput, createdOwnership)) {
      try {
        cleanupOwnedIsolatedProject({
          sourceProject,
          temporaryProject: path.resolve(temporaryInput),
          ownership: createdOwnership,
        })
      } catch { /* Preserve attestation failure. */ }
    }
    throw error
  }
}

export function attestOwnedIsolatedProject(
  expectedSourceInput: string,
  expectedTemporaryInput: string,
  ownership: IsolatedProjectOwnership,
  options: { requireMarkerOnly?: boolean } = {},
): IsolatedProjectAttestation {
  const sourceProject = canonicalOrdinaryDirectory(expectedSourceInput, 'source-not-ordinary')
  const temporaryProject = canonicalOrdinaryDirectory(expectedTemporaryInput, 'temporary-not-ordinary')
  assertProjectsDisjoint(sourceProject, temporaryProject)
  assertOwnershipShape(ownership)
  if (ownership.sourceIdentityDigest !== directoryIdentityDigest('source', sourceProject)) {
    throw new IsolatedProjectAttestationError('source-identity-mismatch')
  }
  if (ownership.temporaryIdentityDigest !== directoryIdentityDigest('temporary', temporaryProject)) {
    throw new IsolatedProjectAttestationError('temporary-identity-mismatch')
  }
  const markerPath = confinedMarkerPath(temporaryProject, ownership.markerRelativePath)
  const marker = readOwnershipMarker(markerPath)
  if (!sameOwnership(marker, ownership)) {
    throw new IsolatedProjectAttestationError('marker-mismatch')
  }
  if (options.requireMarkerOnly) {
    const entries = fs.readdirSync(temporaryProject)
    if (entries.length !== 1 || entries[0] !== ownership.markerRelativePath) {
      throw new IsolatedProjectAttestationError('temporary-not-marker-only')
    }
  }
  return { sourceProject, temporaryProject, ownership: { ...ownership }, markerPath }
}

export function attestIsolatedPreparationResponse<Preparation extends IsolatedProjectOwnershipChallenge>(
  challenge: IsolatedProjectOwnershipChallenge,
  preparation: Preparation,
): Preparation {
  if (!preparation || typeof preparation !== 'object') {
    throw new IsolatedProjectAttestationError('worker-response-invalid')
  }
  const expected = attestOwnedIsolatedProject(
    challenge.sourceProject,
    challenge.temporaryProject,
    challenge.ownership,
  )
  const returned = attestOwnedIsolatedProject(
    preparation.sourceProject,
    preparation.temporaryProject,
    preparation.ownership,
  )
  if (!sameCanonicalPath(expected.sourceProject, returned.sourceProject)) {
    throw new IsolatedProjectAttestationError('worker-source-mismatch')
  }
  if (!sameCanonicalPath(expected.temporaryProject, returned.temporaryProject)) {
    throw new IsolatedProjectAttestationError('worker-temporary-mismatch')
  }
  if (!sameOwnership(expected.ownership, returned.ownership)) {
    throw new IsolatedProjectAttestationError('worker-ownership-mismatch')
  }
  return preparation
}

export function cleanupOwnedIsolatedProject(
  challenge: IsolatedProjectOwnershipChallenge,
  expected: { sourceProject?: string; temporaryProject?: string } = {},
): void {
  const attestation = attestOwnedIsolatedProject(
    expected.sourceProject || challenge.sourceProject,
    expected.temporaryProject || challenge.temporaryProject,
    challenge.ownership,
  )
  if (!sameCanonicalPath(attestation.sourceProject, canonicalizeIsolatedSourceProject(challenge.sourceProject))) {
    throw new IsolatedProjectAttestationError('cleanup-source-mismatch')
  }
  if (!sameCanonicalPath(attestation.temporaryProject, canonicalOrdinaryDirectory(challenge.temporaryProject, 'temporary-not-ordinary'))) {
    throw new IsolatedProjectAttestationError('cleanup-temporary-mismatch')
  }
  // Move the exact attested inode to a session-owned quarantine name before
  // traversal. A replacement root cannot be traversed under the original path.
  const deletionAttestation = attestOwnedIsolatedProject(
    attestation.sourceProject,
    attestation.temporaryProject,
    attestation.ownership,
  )
  const quarantine = path.join(
    path.dirname(deletionAttestation.temporaryProject),
    `.rpg-agent-cleanup-${deletionAttestation.ownership.ownershipToken.slice(0, 12)}-${crypto.randomBytes(12).toString('hex')}`,
  )
  if (fs.existsSync(quarantine)) throw new IsolatedProjectAttestationError('cleanup-quarantine-exists')
  fs.renameSync(deletionAttestation.temporaryProject, quarantine)
  try {
    const quarantined = attestOwnedIsolatedProject(
      deletionAttestation.sourceProject,
      quarantine,
      deletionAttestation.ownership,
    )
    removeAttestedTreeWithoutFollowingLinks(quarantined)
  } catch (error) {
    if (!fs.existsSync(deletionAttestation.temporaryProject) && fs.existsSync(quarantine)) {
      try { fs.renameSync(quarantine, deletionAttestation.temporaryProject) }
      catch { challenge.temporaryProject = quarantine }
    }
    throw error
  }
  if (fs.existsSync(attestation.temporaryProject)) {
    throw new IsolatedProjectAttestationError('cleanup-incomplete')
  }
}

function removeAttestedTreeWithoutFollowingLinks(attestation: IsolatedProjectAttestation): void {
  const root = attestation.temporaryProject
  const rechecked = attestOwnedIsolatedProject(
    attestation.sourceProject,
    root,
    attestation.ownership,
  )
  const counter = { value: 0 }
  for (const entry of fs.readdirSync(root)) {
    if (entry === rechecked.ownership.markerRelativePath) continue
    removeDirectoryEntryWithoutFollowingLinks(
      root,
      path.join(root, entry),
      rechecked.ownership.ownershipToken,
      counter,
    )
  }
  // The marker is the last file removed. Revalidate the root inode and token
  // after all untrusted copied content has been detached.
  const final = attestOwnedIsolatedProject(rechecked.sourceProject, root, rechecked.ownership)
  const remaining = fs.readdirSync(root)
  if (remaining.length !== 1 || remaining[0] !== final.ownership.markerRelativePath) {
    throw new IsolatedProjectAttestationError('cleanup-late-entry-detected')
  }
  const markerBackup = path.join(
    path.dirname(root),
    `.rpg-agent-marker-${final.ownership.ownershipToken.slice(0, 12)}-${crypto.randomBytes(12).toString('hex')}`,
  )
  if (fs.existsSync(markerBackup)) throw new IsolatedProjectAttestationError('cleanup-marker-backup-exists')
  fs.renameSync(final.markerPath, markerBackup)
  try {
    fs.rmdirSync(root)
  } catch (error) {
    if (!fs.existsSync(final.markerPath) && fs.existsSync(markerBackup)) {
      try { fs.renameSync(markerBackup, final.markerPath) } catch { /* Retain backup marker evidence. */ }
    }
    throw error
  }
  const backupStats = fs.lstatSync(markerBackup)
  if (backupStats.isSymbolicLink() || !backupStats.isFile() || backupStats.size > OWNERSHIP_MARKER_MAX_BYTES) {
    throw new IsolatedProjectAttestationError('cleanup-marker-backup-invalid')
  }
  if (!sameOwnership(readOwnershipMarker(markerBackup), final.ownership)) {
    throw new IsolatedProjectAttestationError('cleanup-marker-backup-mismatch')
  }
  fs.unlinkSync(markerBackup)
}

function removeDirectoryEntryWithoutFollowingLinks(
  attestedRoot: string,
  target: string,
  ownershipToken: string,
  counter: { value: number },
): void {
  const parentReal = fs.realpathSync.native(path.dirname(target))
  if (!containsPath(attestedRoot, parentReal) && !sameCanonicalPath(attestedRoot, parentReal)) {
    throw new IsolatedProjectAttestationError('cleanup-entry-parent-escaped')
  }
  const before = directoryEntryIdentity(target)
  const quarantine = path.join(
    path.dirname(target),
    `.rpg-agent-entry-${ownershipToken.slice(0, 8)}-${counter.value++}-${crypto.randomBytes(8).toString('hex')}`,
  )
  if (fs.existsSync(quarantine)) throw new IsolatedProjectAttestationError('cleanup-entry-quarantine-exists')
  fs.renameSync(target, quarantine)
  const after = directoryEntryIdentity(quarantine)
  if (before !== after) {
    try { fs.renameSync(quarantine, target) } catch { /* Retain the moved entry. */ }
    throw new IsolatedProjectAttestationError('cleanup-entry-identity-changed')
  }
  const stats = fs.lstatSync(quarantine)
  if (stats.isSymbolicLink()) {
    try { fs.rmdirSync(quarantine) } catch { fs.unlinkSync(quarantine) }
    return
  }
  if (!stats.isDirectory()) {
    fs.unlinkSync(quarantine)
    return
  }
  const directoryIdentity = ordinaryDirectoryIdentity(quarantine)
  for (const entry of fs.readdirSync(quarantine)) {
    if (ordinaryDirectoryIdentity(quarantine) !== directoryIdentity) {
      throw new IsolatedProjectAttestationError('cleanup-directory-identity-changed')
    }
    removeDirectoryEntryWithoutFollowingLinks(
      attestedRoot,
      path.join(quarantine, entry),
      ownershipToken,
      counter,
    )
  }
  if (ordinaryDirectoryIdentity(quarantine) !== directoryIdentity) {
    throw new IsolatedProjectAttestationError('cleanup-directory-identity-changed')
  }
  fs.rmdirSync(quarantine)
}

function canonicalOrdinaryDirectory(input: string, reason: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new IsolatedProjectAttestationError(reason)
  const resolved = path.resolve(input)
  assertOrdinaryDirectoryChain(resolved, reason)
  let canonical: string
  try {
    canonical = fs.realpathSync.native(resolved)
  } catch {
    throw new IsolatedProjectAttestationError(reason)
  }
  assertOrdinaryDirectoryChain(canonical, reason)
  return canonical
}

function assertOrdinaryDirectoryChain(absolutePath: string, reason: string): void {
  const parsed = path.parse(absolutePath)
  const relative = absolutePath.slice(parsed.root.length)
  const segments = relative.split(path.sep).filter(Boolean)
  let current = parsed.root
  for (const segment of segments) {
    current = path.join(current, segment)
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(current)
    } catch {
      throw new IsolatedProjectAttestationError(reason)
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new IsolatedProjectAttestationError(reason)
    }
  }
}

function assertProjectsDisjoint(sourceProject: string, temporaryProject: string): void {
  if (sameCanonicalPath(sourceProject, temporaryProject)) {
    throw new IsolatedProjectAttestationError('source-temporary-same')
  }
  if (containsPath(sourceProject, temporaryProject)) {
    throw new IsolatedProjectAttestationError('temporary-inside-source')
  }
  if (containsPath(temporaryProject, sourceProject)) {
    throw new IsolatedProjectAttestationError('source-inside-temporary')
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const relation = path.relative(parent, candidate)
  return Boolean(relation) && !relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation)
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
    : path.normalize(left) === path.normalize(right)
}

function directoryIdentityDigest(role: 'source' | 'temporary', directory: string): string {
  const stats = fs.statSync(directory)
  const identity = [
    role,
    String(stats.dev),
    String(stats.ino),
    String(stats.birthtimeMs),
  ].join('\0')
  return crypto.createHash('sha256').update(identity).digest('hex')
}

function ordinaryDirectoryIdentity(directory: string): string {
  const stats = fs.lstatSync(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new IsolatedProjectAttestationError('cleanup-directory-became-reparse')
  }
  return [String(stats.dev), String(stats.ino), String(stats.birthtimeMs)].join(':')
}

function directoryEntryIdentity(target: string): string {
  const stats = fs.lstatSync(target)
  const type = stats.isSymbolicLink() ? 'link' : stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other'
  return [type, String(stats.dev), String(stats.ino), String(stats.birthtimeMs), String(stats.size)].join(':')
}

function confinedMarkerPath(temporaryProject: string, markerRelativePath: string): string {
  if (!OWNERSHIP_MARKER_PATTERN.test(markerRelativePath) || path.basename(markerRelativePath) !== markerRelativePath) {
    throw new IsolatedProjectAttestationError('marker-path-invalid')
  }
  const markerPath = path.resolve(temporaryProject, markerRelativePath)
  if (!containsPath(temporaryProject, markerPath)) {
    throw new IsolatedProjectAttestationError('marker-path-escaped')
  }
  return markerPath
}

function readOwnershipMarker(markerPath: string): IsolatedProjectOwnership {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(markerPath)
  } catch {
    throw new IsolatedProjectAttestationError('marker-missing')
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > OWNERSHIP_MARKER_MAX_BYTES) {
    throw new IsolatedProjectAttestationError('marker-not-bounded-ordinary-file')
  }
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as IsolatedProjectOwnership
    assertOwnershipShape(marker)
    return marker
  } catch (error) {
    if (error instanceof IsolatedProjectAttestationError) throw error
    throw new IsolatedProjectAttestationError('marker-invalid')
  }
}

function assertOwnershipShape(value: IsolatedProjectOwnership): void {
  if (!value || typeof value !== 'object'
    || value.schemaVersion !== ISOLATED_PROJECT_OWNERSHIP_SCHEMA_VERSION
    || !OWNERSHIP_TOKEN_PATTERN.test(value.ownershipToken)
    || !OWNERSHIP_MARKER_PATTERN.test(value.markerRelativePath)
    || !/^[a-f0-9]{64}$/.test(value.sourceIdentityDigest)
    || !/^[a-f0-9]{64}$/.test(value.temporaryIdentityDigest)) {
    throw new IsolatedProjectAttestationError('ownership-shape-invalid')
  }
}

function sameOwnership(left: IsolatedProjectOwnership, right: IsolatedProjectOwnership): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.ownershipToken === right.ownershipToken
    && left.markerRelativePath === right.markerRelativePath
    && left.sourceIdentityDigest === right.sourceIdentityDigest
    && left.temporaryIdentityDigest === right.temporaryIdentityDigest
}

function isChallengeOwnedByCurrentCall(
  sourceProject: string,
  temporaryInput: string,
  createdOwnership: IsolatedProjectOwnership,
): boolean {
  try {
    const temporaryProject = canonicalOrdinaryDirectory(temporaryInput, 'temporary-not-ordinary')
    assertProjectsDisjoint(sourceProject, temporaryProject)
    const entries = fs.readdirSync(temporaryProject)
    if (entries.length !== 1 || !OWNERSHIP_MARKER_PATTERN.test(entries[0])) return false
    const marker = readOwnershipMarker(path.join(temporaryProject, entries[0]))
    return sameOwnership(marker, createdOwnership)
      && marker.sourceIdentityDigest === directoryIdentityDigest('source', sourceProject)
      && marker.temporaryIdentityDigest === directoryIdentityDigest('temporary', temporaryProject)
  } catch {
    return false
  }
}
