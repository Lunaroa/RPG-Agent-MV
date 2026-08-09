import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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
  assert.deepEqual(migrated.sceneScript, { version: '1.0.0', source: expected })

  const reopened = migrateUiDesignerDocument(JSON.parse(JSON.stringify(migrated))) as Record<string, unknown>
  assert.deepEqual(reopened.sceneScript, migrated.sceneScript)
  assert.throws(
    () => migrateUiDesignerDocument({ ...migrated, code: { ready, update } }),
    (error: unknown) => error instanceof UiDesignerScriptMigrationError,
  )
})
