import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalizeLegacySceneScriptSource,
  canonicalUiRuntimeSceneExport,
  migrateLegacyUiSourceCode,
  migrateUiDesignerDocument,
  UiDesignerScriptMigrationError,
} from './ui-designer-script'

test('legacy lifecycle migration is lossless deterministic and remains one-file on reopen', () => {
  const ready = 'const marker = "onUpdate(function () is data";\r\nthis.readyText = /ready\\)/.source;'
  const update = 'const marker = "onReady(function () is data";\nthis.updateText = `value:${1 + 1}`;'
  const expected = migrateLegacyUiSourceCode({ ready, update })
  assert.equal(migrateLegacyUiSourceCode({ ready, update }), expected)
  assert.ok(expected.includes(ready))
  assert.ok(expected.includes(update))

  const migrated = migrateUiDesignerDocument({
    version: '1.0.0',
    editorVersion: '1.0.0',
    code: { ready, update },
  }) as Record<string, unknown>
  assert.equal('code' in migrated, false)
  assert.deepEqual(migrated.sceneScript, { version: '1.1.0', source: expected })

  const reopened = migrateUiDesignerDocument(JSON.parse(JSON.stringify(migrated))) as Record<string, unknown>
  assert.deepEqual(reopened.sceneScript, migrated.sceneScript)
  assert.throws(
    () => migrateUiDesignerDocument({ ...migrated, code: { ready, update } }),
    (error: unknown) => error instanceof UiDesignerScriptMigrationError,
  )
})

test('canonicalizes v1.0 one-file lifecycle registration without touching string and comment data', () => {
  const source = [
    'const text = "onReady(function () is data";',
    'const matcher = /onReady|onUpdate/;',
    '// onUpdate(function () is a comment',
    'onReady(function () { context.ready += 1; });',
    'onUpdate(({ frame }) => { context.frame = frame; });',
  ].join('\n')
  const canonical = canonicalizeLegacySceneScriptSource(source)
  assert.match(canonical, /scene\.onReady\(function/)
  assert.match(canonical, /scene\.onUpdate\(\(\{ frame \}\)/)
  assert.match(canonical, /"onReady\(function \(\) is data"/)
  assert.match(canonical, /\/onReady\|onUpdate\//)
  assert.match(canonical, /\/\/ onUpdate\(function \(\) is a comment/)
  assert.equal(canonicalizeLegacySceneScriptSource(canonical), canonical)
})

test('runtime loader canonicalizes legacy 1.0 code to the 1.1 scene API', () => {
  const canonical = canonicalUiRuntimeSceneExport({
    version: '1.0.0',
    runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Sample' },
    code: { ready: 'context.ready = true;', update: 'context.frames += 1;' },
  })
  assert.equal(canonical.version, '1.1.0')
  assert.equal(canonical.runtimeVersion, '>=1.1.0')
  assert.equal(canonical.sceneScript.version, '1.1.0')
  assert.match(canonical.sceneScript.source, /scene\.onReady/)
  assert.match(canonical.sceneScript.source, /scene\.onUpdate\(function \(\{ frame, deltaMs \}\)/)
  assert.equal('code' in canonical, false)
})
