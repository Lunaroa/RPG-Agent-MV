import assert from 'node:assert'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'

import {
  attestOwnedIsolatedProject,
  attestIsolatedPreparationResponse,
  cleanupOwnedIsolatedProject,
  createOwnedEmptyIsolatedProject,
  IsolatedProjectAttestationError,
} from './isolated-project-attestation.ts'

describe('canonical isolated project ownership attestation', { concurrency: false }, () => {
  const fixtureRoots: string[] = []

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('creates an exclusive marker-only root and deletes only its attested object', () => {
    const source = sourceProject('owned-cleanup')
    const before = treeDigest(source)
    const temporary = missingRolePath('owned-cleanup')
    const challenge = createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: temporary })

    const attestation = attestOwnedIsolatedProject(source, temporary, challenge.ownership, { requireMarkerOnly: true })
    assert.equal(attestation.temporaryProject, fs.realpathSync.native(temporary))
    fs.mkdirSync(path.join(temporary, 'nested'))
    fs.writeFileSync(path.join(temporary, 'nested', 'generated.txt'), 'temporary-only', 'utf8')

    cleanupOwnedIsolatedProject(challenge)

    assert.equal(fs.existsSync(temporary), false)
    assert.equal(treeDigest(source), before)
  })

  test('rejects existing, same, parent, and child temporary roles before mutation', () => {
    const source = sourceProject('relations')
    const before = treeDigest(source)
    const existing = roleRoot('existing-role')
    fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep', 'utf8')

    for (const candidate of [source, path.dirname(source), existing, path.join(source, 'child-role')]) {
      assert.throws(
        () => createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: candidate }),
        IsolatedProjectAttestationError,
      )
    }

    assert.equal(fs.existsSync(path.join(source, 'child-role')), false)
    assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(treeDigest(source), before)
  })

  test('retains marker-missing and marker-mismatched temporary roots', () => {
    const source = sourceProject('marker')
    const before = treeDigest(source)
    const challenge = createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: missingRolePath('marker') })
    const marker = path.join(challenge.temporaryProject, challenge.ownership.markerRelativePath)
    const markerBody = fs.readFileSync(marker)

    fs.unlinkSync(marker)
    assert.throws(() => cleanupOwnedIsolatedProject(challenge), IsolatedProjectAttestationError)
    assert.equal(fs.existsSync(challenge.temporaryProject), true)

    const mismatched = { ...challenge.ownership, ownershipToken: crypto.randomBytes(32).toString('hex') }
    fs.writeFileSync(marker, `${JSON.stringify(mismatched)}\n`, 'utf8')
    assert.throws(() => cleanupOwnedIsolatedProject(challenge), IsolatedProjectAttestationError)
    assert.equal(fs.existsSync(challenge.temporaryProject), true)
    assert.equal(treeDigest(source), before)

    fs.writeFileSync(marker, markerBody)
    cleanupOwnedIsolatedProject(challenge)
  })

  test('detects replacement directory identity even when the marker is copied', () => {
    const source = sourceProject('identity')
    const before = treeDigest(source)
    const challenge = createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: missingRolePath('identity') })
    const displaced = `${challenge.temporaryProject}-displaced`
    fs.renameSync(challenge.temporaryProject, displaced)
    fs.mkdirSync(challenge.temporaryProject)
    fs.copyFileSync(
      path.join(displaced, challenge.ownership.markerRelativePath),
      path.join(challenge.temporaryProject, challenge.ownership.markerRelativePath),
    )

    assert.throws(() => cleanupOwnedIsolatedProject(challenge), /temporary-identity-mismatch/)
    assert.equal(fs.existsSync(challenge.temporaryProject), true)
    assert.equal(fs.existsSync(displaced), true)
    assert.equal(treeDigest(source), before)

    fs.rmSync(challenge.temporaryProject, { recursive: true, force: true })
    fs.renameSync(displaced, challenge.temporaryProject)
    cleanupOwnedIsolatedProject(challenge)
  })

  test('rejects an ancestor junction and detaches a nested junction without following it', () => {
    const source = sourceProject('junction')
    const before = treeDigest(source)
    const external = roleRoot('junction-target')
    fs.writeFileSync(path.join(external, 'asset.txt'), 'external-asset', 'utf8')
    const carrier = roleRoot('junction-carrier')
    const junction = path.join(carrier, 'linked-parent')
    fs.symlinkSync(external, junction, 'junction')

    assert.throws(
      () => createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: path.join(junction, 'candidate') }),
      IsolatedProjectAttestationError,
    )
    assert.equal(fs.existsSync(path.join(external, 'candidate')), false)

    const challenge = createOwnedEmptyIsolatedProject(source, { temporaryProjectPath: missingRolePath('nested-junction') })
    fs.symlinkSync(external, path.join(challenge.temporaryProject, 'asset-link'), 'junction')
    cleanupOwnedIsolatedProject(challenge)

    assert.equal(fs.readFileSync(path.join(external, 'asset.txt'), 'utf8'), 'external-asset')
    assert.equal(treeDigest(source), before)
  })

  test('rejects worker source, temporary, and role-swapped responses against the host challenge', () => {
    const sourceA = sourceProject('worker-a')
    const sourceB = sourceProject('worker-b')
    const sourceABefore = treeDigest(sourceA)
    const sourceBBefore = treeDigest(sourceB)
    const expected = createOwnedEmptyIsolatedProject(sourceA, { temporaryProjectPath: missingRolePath('worker-expected') })
    const wrongTemporary = createOwnedEmptyIsolatedProject(sourceA, { temporaryProjectPath: missingRolePath('worker-temp') })
    const wrongSource = createOwnedEmptyIsolatedProject(sourceB, { temporaryProjectPath: missingRolePath('worker-source') })

    assert.throws(
      () => attestIsolatedPreparationResponse(expected, wrongTemporary),
      /worker-temporary-mismatch/,
    )
    assert.throws(
      () => attestIsolatedPreparationResponse(expected, wrongSource),
      /worker-source-mismatch/,
    )
    assert.throws(
      () => attestIsolatedPreparationResponse(expected, {
        sourceProject: expected.temporaryProject,
        temporaryProject: expected.sourceProject,
        ownership: expected.ownership,
      }),
      IsolatedProjectAttestationError,
    )

    for (const challenge of [expected, wrongTemporary, wrongSource]) cleanupOwnedIsolatedProject(challenge)
    assert.equal(treeDigest(sourceA), sourceABefore)
    assert.equal(treeDigest(sourceB), sourceBBefore)
  })

  function sourceProject(label: string): string {
    const source = roleRoot(`source-${label}`)
    fs.mkdirSync(path.join(source, 'data'))
    fs.writeFileSync(path.join(source, 'data', 'System.json'), '{"title":"sample"}', 'utf8')
    return source
  }

  function roleRoot(label: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rpg-agent-attestation-${label}-`))
    fixtureRoots.push(root)
    return root
  }

  function missingRolePath(label: string): string {
    const parent = roleRoot(`parent-${label}`)
    return path.join(parent, 'owned-role')
  }
})

function treeDigest(root: string): string {
  const hash = crypto.createHash('sha256')
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const target = path.join(directory, entry)
      const relative = path.relative(root, target).replace(/\\/g, '/')
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) {
        hash.update(`link:${relative}:${fs.readlinkSync(target)}\n`)
      } else if (stat.isDirectory()) {
        hash.update(`directory:${relative}\n`)
        visit(target)
      } else {
        hash.update(`file:${relative}:`)
        hash.update(fs.readFileSync(target))
        hash.update('\n')
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}
