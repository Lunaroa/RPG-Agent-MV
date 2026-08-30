import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildIsolatedNwLaunchCommand,
  createIsolatedNwProfileDirectory,
  isolatedNwEntryScriptName,
  planIsolatedNwApp,
  writeIsolatedNwAppPackage,
} from './isolated-nw-app-launch.ts'
import { createOwnedEmptyIsolatedProject } from './isolated-project-attestation.ts'
import type { IsolatedProjectPreparation } from './isolated-project-preparation.ts'
import type { InteractiveProjectRuntime } from './interactive-playtest-runtime.ts'

function createProject(root: string, layout: 'data' | 'www', name: string = layout): { project: string; resourceRoot: string; main: string } {
  const project = path.join(root, `project-${name}`)
  const resourceRoot = layout === 'www' ? path.join(project, 'www') : project
  fs.mkdirSync(path.join(resourceRoot, 'data'), { recursive: true })
  fs.mkdirSync(path.join(resourceRoot, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(resourceRoot, 'index.html'), '<!doctype html><script src="js/main.js"></script>', 'utf8')
  fs.writeFileSync(path.join(resourceRoot, 'js', 'main.js'), 'window.onload = function () {};', 'utf8')
  const main = layout === 'www' ? 'www/index.html' : 'index.html'
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'sample-app',
    main,
    description: 'Preserved neutral fixture',
    custom: { preserved: true },
    inject_js_start: 'project-startup.js',
    window: { title: 'Sample', toolbar: false, inject_js_start: 'project-window-startup.js' },
    'single-instance': true,
  }), 'utf8')
  return { project, resourceRoot, main }
}

function externalRuntime(root: string, engine: 'rpg-maker-mv' | 'rpg-maker-mz'): InteractiveProjectRuntime {
  const runtimeRoot = path.join(root, `runtime-${engine}`)
  fs.mkdirSync(runtimeRoot, { recursive: true })
  const executable = path.join(runtimeRoot, engine === 'rpg-maker-mv' ? 'Game.exe' : 'nw.exe')
  fs.writeFileSync(executable, 'neutral-runtime', 'utf8')
  return {
    engine,
    executable,
    runtimeRoot,
    source: 'official-install',
    launchStyle: 'external',
    evidenceExecutable: 'neutral-runtime',
  }
}

test('configures one strict active package for root-data and root-www isolated NW apps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-nw-package-'))
  try {
    const names = new Set<string>()
    for (const layout of ['data', 'www'] as const) {
      const fixture = createProject(root, layout)
      const inactivePackage = path.join(fixture.resourceRoot, 'package.json')
      const inactiveSource = JSON.stringify({ name: 'inactive-resource-package', main: 'index.html' })
      if (inactivePackage !== path.join(fixture.project, 'package.json')) fs.writeFileSync(inactivePackage, inactiveSource, 'utf8')
      const sessionId = `session-${layout}`
      const originalIndex = fs.readFileSync(path.join(fixture.resourceRoot, 'index.html'), 'utf8')
      const plan = planIsolatedNwApp(fixture.project, sessionId, 'map-preview', fixture.resourceRoot)
      const result = writeIsolatedNwAppPackage(
        plan,
        `(function(){ window.__receipt = ${JSON.stringify(sessionId)}; }());`,
      )
      const manifest = JSON.parse(fs.readFileSync(path.join(fixture.project, 'package.json'), 'utf8')) as Record<string, any>
      assert.equal(manifest.main, fixture.main)
      assert.equal(manifest.description, 'Preserved neutral fixture')
      assert.deepEqual(manifest.custom, { preserved: true })
      assert.equal(manifest.window.title, 'Sample')
      assert.equal(manifest.window.toolbar, false)
      assert.equal(manifest.inject_js_start, 'project-startup.js')
      assert.equal(manifest.window.inject_js_start, 'project-window-startup.js')
      assert.equal(manifest['single-instance'], false)
      assert.match(String(manifest.name), /^rpg-agent-map-preview-[a-f0-9]{20}$/)
      assert.ok(String(manifest.name).length <= 63)
      names.add(String(manifest.name))
      assert.equal(fs.readFileSync(result.entryPath, 'utf8').includes(sessionId), true)
      assert.equal(result.evidence.schemaVersion, '1.1.0')
      assert.equal(result.evidence.activePackageMain, fixture.main)
      assert.equal(result.evidence.uniqueNameValid, true)
      assert.equal(result.evidence.entryRelativePath, result.entryRelativePath)
      assert.equal(result.evidence.indexRelativePath, fixture.main)
      assert.equal(Object.values(result.evidence.digests).every((value) => /^[a-f0-9]{64}$/.test(value)), true)
      assert.equal(result.evidence.digests.package, sha256(fs.readFileSync(result.packagePath, 'utf8')))
      assert.equal(result.evidence.digests.index, sha256(originalIndex))
      assert.equal(result.evidence.digests.entry, sha256(fs.readFileSync(result.entryPath, 'utf8')))
      assert.equal(fs.readFileSync(path.join(fixture.resourceRoot, 'index.html'), 'utf8'), originalIndex)
      assert.equal(path.relative(fixture.resourceRoot, result.entryPath).startsWith('..'), false)
      if (inactivePackage !== path.join(fixture.project, 'package.json')) {
        assert.equal(fs.readFileSync(inactivePackage, 'utf8'), inactiveSource)
      }
    }
    assert.equal(names.size, 2)

    const generatedReference = createProject(root, 'data', 'generated-reference')
    const generatedPackagePath = path.join(generatedReference.project, 'package.json')
    const generatedPackage = JSON.parse(fs.readFileSync(generatedPackagePath, 'utf8')) as Record<string, any>
    const generatedEntry = path.posix.join('js', isolatedNwEntryScriptName('map-preview', 'generated-reference-session'))
    generatedPackage.inject_js_start = generatedEntry
    generatedPackage.window.inject_js_start = generatedEntry
    fs.writeFileSync(generatedPackagePath, JSON.stringify(generatedPackage), 'utf8')
    const generatedPlan = planIsolatedNwApp(
      generatedReference.project,
      'generated-reference-session',
      'map-preview',
      generatedReference.resourceRoot,
    )
    writeIsolatedNwAppPackage(generatedPlan, '(function () {})();')
    const cleanedPackage = JSON.parse(fs.readFileSync(generatedPackagePath, 'utf8')) as Record<string, any>
    assert.equal(Object.hasOwn(cleanedPackage, 'inject_js_start'), false)
    assert.equal(Object.hasOwn(cleanedPackage.window, 'inject_js_start'), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

test('keeps session profiles confined and preserves embedded and external launch argument order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-nw-launch-'))
  const source = path.join(root, 'source project')
  const isolated = path.join(root, 'isolated project')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'Game.exe'), 'source-runtime', 'utf8')
  const snapshot = isolatedPreparation(source, isolated)
  fs.writeFileSync(path.join(isolated, 'Game.exe'), 'isolated-runtime', 'utf8')
  try {
    const sessionId = 'isolated-launch-session'
    const profile = createIsolatedNwProfileDirectory(isolated, sessionId)
    const profileArgument = `--user-data-dir=${profile}`
    const mv = buildIsolatedNwLaunchCommand(externalRuntime(root, 'rpg-maker-mv'), snapshot, sessionId, profile, 'source-project')
    const mz = buildIsolatedNwLaunchCommand(externalRuntime(root, 'rpg-maker-mz'), snapshot, sessionId, profile, 'source-project')
    const embedded = buildIsolatedNwLaunchCommand({
      engine: 'rpg-maker-mv',
      executable: path.join(source, 'Game.exe'),
      runtimeRoot: source,
      source: 'project-local',
      launchStyle: 'embedded',
      evidenceExecutable: 'neutral-runtime',
    }, snapshot, sessionId, profile, 'source-project')
    const stagedEmbedded = buildIsolatedNwLaunchCommand({
      engine: 'rpg-maker-mv',
      executable: path.join(isolated, 'Game.exe'),
      runtimeRoot: isolated,
      source: 'project-local',
      launchStyle: 'embedded',
      evidenceExecutable: 'neutral-runtime',
    }, snapshot, sessionId, profile, 'staged-project')
    assert.deepEqual(mv.args, [profileArgument, `--nwapp=${isolated}`, 'test'])
    assert.deepEqual(mz.args, [profileArgument, `--nwapp=${isolated}`])
    assert.deepEqual(mv.evidence.argumentRoles, ['session-profile', 'nwapp-temporary-project', 'test'])
    assert.deepEqual(mz.evidence.argumentRoles, ['session-profile', 'nwapp-temporary-project'])
    assert.equal(mv.evidence.checks.nwappExplicit, true)
    assert.equal(mv.evidence.digests.temporaryProject.includes(isolated), false)
    assert.deepEqual(embedded.args, [profileArgument])
    assert.equal(embedded.evidence.checks.nwappExplicit, false)
    assert.equal(embedded.executable, path.join(isolated, 'Game.exe'))
    assert.deepEqual(stagedEmbedded.args, [profileArgument])
    assert.equal(stagedEmbedded.executable, path.join(isolated, 'Game.exe'))
    assert.equal(path.dirname(profile), isolated)
    assert.equal(fs.realpathSync.native(profile).startsWith(`${fs.realpathSync.native(isolated)}${path.sep}`), true)
    assert.equal(fs.lstatSync(profile).isDirectory(), true)
    assert.equal(fs.lstatSync(profile).isSymbolicLink(), false)
    assert.throws(
      () => buildIsolatedNwLaunchCommand({
        engine: 'rpg-maker-mv',
        executable: path.join(isolated, 'Game.exe'),
        runtimeRoot: isolated,
        source: 'project-local',
        launchStyle: 'embedded',
        evidenceExecutable: 'neutral-runtime',
      }, { ...snapshot, temporaryProject: source }, sessionId, profile, 'source-project'),
      /attestation failed/,
    )
    assert.throws(
      () => buildIsolatedNwLaunchCommand(externalRuntime(root, 'rpg-maker-mv'), snapshot, 'other-session', profile, 'source-project'),
      /does not belong/,
    )
    const escapedExecutable = path.join(root, 'escaped-Game.exe')
    fs.writeFileSync(escapedExecutable, 'escaped-runtime', 'utf8')
    assert.throws(
      () => buildIsolatedNwLaunchCommand({
        engine: 'rpg-maker-mv',
        executable: escapedExecutable,
        runtimeRoot: root,
        source: 'project-local',
        launchStyle: 'embedded',
        evidenceExecutable: 'neutral-runtime',
      }, snapshot, sessionId, profile, 'source-project'),
      /escaped the isolated project/,
    )
    assert.throws(
      () => buildIsolatedNwLaunchCommand({
        engine: 'rpg-maker-mv',
        executable: escapedExecutable,
        runtimeRoot: root,
        source: 'project-local',
        launchStyle: 'embedded',
        evidenceExecutable: 'neutral-runtime',
      }, snapshot, sessionId, profile, 'staged-project'),
      /escaped the isolated project/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    assert.equal(fs.existsSync(isolated), false)
  }
})

function isolatedPreparation(sourceProject: string, temporaryProjectPath: string): IsolatedProjectPreparation {
  const challenge = createOwnedEmptyIsolatedProject(sourceProject, { temporaryProjectPath })
  return {
    ...challenge,
    sourceFingerprint: 'source',
    saveFingerprint: 'save',
    staging: { files: [], digest: 'staging' },
    savesExcluded: true,
  }
}

test('rejects symlinked package, index, and entry targets before any isolated app write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-nw-file-links-'))
  try {
    const packageLinked = createProject(root, 'data', 'package-link')
    const externalPackage = path.join(root, 'external-package-target')
    const packageSource = fs.readFileSync(path.join(packageLinked.project, 'package.json'), 'utf8')
    fs.mkdirSync(externalPackage)
    fs.writeFileSync(path.join(externalPackage, 'sentinel.txt'), packageSource, 'utf8')
    fs.rmSync(path.join(packageLinked.project, 'package.json'))
    fs.symlinkSync(externalPackage, path.join(packageLinked.project, 'package.json'), 'junction')
    const packageIndex = fs.readFileSync(path.join(packageLinked.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(packageLinked.project, 'package-link-session', 'map-preview', packageLinked.resourceRoot),
      /package\.json must be an ordinary non-symlink file/,
    )
    assert.equal(fs.readFileSync(path.join(externalPackage, 'sentinel.txt'), 'utf8'), packageSource)
    assert.equal(fs.readFileSync(path.join(packageLinked.resourceRoot, 'index.html'), 'utf8'), packageIndex)

    const indexLinked = createProject(root, 'data', 'index-link')
    const externalIndex = path.join(root, 'external-index-target')
    const indexSource = fs.readFileSync(path.join(indexLinked.resourceRoot, 'index.html'), 'utf8')
    fs.mkdirSync(externalIndex)
    fs.writeFileSync(path.join(externalIndex, 'sentinel.txt'), indexSource, 'utf8')
    fs.rmSync(path.join(indexLinked.resourceRoot, 'index.html'))
    fs.symlinkSync(externalIndex, path.join(indexLinked.resourceRoot, 'index.html'), 'junction')
    const indexPackage = fs.readFileSync(path.join(indexLinked.project, 'package.json'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(indexLinked.project, 'index-link-session', 'map-preview', indexLinked.resourceRoot),
      /index\.html must be an ordinary non-symlink file/,
    )
    assert.equal(fs.readFileSync(path.join(externalIndex, 'sentinel.txt'), 'utf8'), indexSource)
    assert.equal(fs.readFileSync(path.join(indexLinked.project, 'package.json'), 'utf8'), indexPackage)

    const injectLinked = createProject(root, 'data', 'inject-link')
    const externalInject = path.join(root, 'external-inject-target')
    fs.mkdirSync(externalInject)
    fs.writeFileSync(path.join(externalInject, 'sentinel.txt'), 'external-sentinel', 'utf8')
    const injectSession = 'inject-link-session'
    const injectTarget = path.join(injectLinked.resourceRoot, 'js', isolatedNwEntryScriptName('map-preview', injectSession))
    fs.symlinkSync(externalInject, injectTarget, 'junction')
    const injectPackage = fs.readFileSync(path.join(injectLinked.project, 'package.json'), 'utf8')
    const injectIndex = fs.readFileSync(path.join(injectLinked.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(injectLinked.project, injectSession, 'map-preview', injectLinked.resourceRoot),
      /entry script already exists/,
    )
    assert.equal(fs.readFileSync(path.join(externalInject, 'sentinel.txt'), 'utf8'), 'external-sentinel')
    assert.equal(fs.readFileSync(path.join(injectLinked.project, 'package.json'), 'utf8'), injectPackage)
    assert.equal(fs.readFileSync(path.join(injectLinked.resourceRoot, 'index.html'), 'utf8'), injectIndex)

  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects inactive-only packages, traversal, and symlinked script parents before writing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-nw-reject-'))
  try {
    const inactiveOnly = createProject(root, 'www', 'inactive-only')
    fs.rmSync(path.join(inactiveOnly.project, 'package.json'))
    fs.writeFileSync(path.join(inactiveOnly.resourceRoot, 'package.json'), JSON.stringify({ main: 'index.html' }), 'utf8')
    const inactiveIndex = fs.readFileSync(path.join(inactiveOnly.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(inactiveOnly.project, 'inactive-only-session', 'map-preview', inactiveOnly.resourceRoot),
      /package\.json does not exist/,
    )
    assert.equal(fs.readFileSync(path.join(inactiveOnly.resourceRoot, 'index.html'), 'utf8'), inactiveIndex)

    const traversal = createProject(root, 'data', 'traversal')
    const traversalPackage = JSON.stringify({ main: '../index.html' })
    fs.writeFileSync(path.join(traversal.project, 'package.json'), traversalPackage, 'utf8')
    const traversalIndex = fs.readFileSync(path.join(traversal.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(traversal.project, 'traversal-session', 'map-preview', traversal.resourceRoot),
      /safe project-relative path/,
    )
    assert.equal(fs.readFileSync(path.join(traversal.project, 'package.json'), 'utf8'), traversalPackage)
    assert.equal(fs.readFileSync(path.join(traversal.resourceRoot, 'index.html'), 'utf8'), traversalIndex)

    const linked = createProject(root, 'www', 'linked')
    const externalScripts = path.join(root, 'external-scripts')
    fs.mkdirSync(externalScripts)
    const sentinel = path.join(externalScripts, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'unchanged', 'utf8')
    fs.rmSync(path.join(linked.resourceRoot, 'js'), { recursive: true })
    try {
      fs.symlinkSync(externalScripts, path.join(linked.resourceRoot, 'js'), 'junction')
    } catch (error) {
      t.skip(`Directory symlink creation is unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const linkedPackage = fs.readFileSync(path.join(linked.project, 'package.json'), 'utf8')
    const linkedIndex = fs.readFileSync(path.join(linked.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(linked.project, 'linked-session', 'map-preview', linked.resourceRoot),
      /non-symlink directory/,
    )
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged')
    assert.equal(fs.readFileSync(path.join(linked.project, 'package.json'), 'utf8'), linkedPackage)
    assert.equal(fs.readFileSync(path.join(linked.resourceRoot, 'index.html'), 'utf8'), linkedIndex)

    const linkedData = createProject(root, 'data', 'linked-data')
    const externalData = path.join(root, 'external-data')
    fs.mkdirSync(externalData)
    const dataSentinel = path.join(externalData, 'Map001.json')
    fs.writeFileSync(dataSentinel, '{"unchanged":true}', 'utf8')
    fs.rmSync(path.join(linkedData.project, 'data'), { recursive: true })
    fs.symlinkSync(externalData, path.join(linkedData.project, 'data'), 'junction')
    const linkedDataPackage = fs.readFileSync(path.join(linkedData.project, 'package.json'), 'utf8')
    const linkedDataIndex = fs.readFileSync(path.join(linkedData.resourceRoot, 'index.html'), 'utf8')
    assert.throws(
      () => planIsolatedNwApp(linkedData.project, 'linked-data-session', 'map-preview', linkedData.resourceRoot),
      /data directory must be an ordinary non-symlink directory/,
    )
    assert.equal(fs.readFileSync(dataSentinel, 'utf8'), '{"unchanged":true}')
    assert.equal(fs.readFileSync(path.join(linkedData.project, 'package.json'), 'utf8'), linkedDataPackage)
    assert.equal(fs.readFileSync(path.join(linkedData.resourceRoot, 'index.html'), 'utf8'), linkedDataIndex)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
