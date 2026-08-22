import assert from 'node:assert/strict'
import test from 'node:test'

import { uiDesignerOperationError } from './ui-designer-ipc-bindings.ts'

test('first-save collision is returned as an actionable file conflict', () => {
  const actual = {
    path: 'project/.luna_rpg/ui-designer/scenes/Scene_Sample.mzui',
    digest: 'existing-digest',
    mtimeMs: 12,
    size: 34,
  }

  const result = uiDesignerOperationError('save', {
    code: 'UI_DESIGNER_OVERWRITE_REQUIRED',
    actual,
  }) as {
    status: string
    code: string
    recoverable: boolean
    conflict?: { code: string; actual: typeof actual; recoverable: boolean }
  }

  assert.equal(result.status, 'error')
  assert.equal(result.code, 'UI_DESIGNER_OVERWRITE_REQUIRED')
  assert.equal(result.recoverable, true)
  assert.deepEqual(result.conflict, {
    code: 'UI_DESIGNER_CONFLICT',
    expected: undefined,
    actual,
    recoverable: true,
  })
})
