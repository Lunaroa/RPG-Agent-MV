import assert from 'node:assert/strict'
import test from 'node:test'

import { uiDesignerOperationError } from './ui-designer-ipc-bindings.ts'

test('save-as collision is returned as an actionable file conflict', () => {
  const actual = {
    path: 'project/data/ui-scenes/Scene_Sample.mzui',
    digest: 'existing-digest',
    mtimeMs: 12,
    size: 34,
  }

  const result = uiDesignerOperationError('saveAs', {
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

test('save-as overwrite errors retain their actionable reason and target path', () => {
  const error = Object.assign(new Error('A scene with this name already exists; confirm overwrite.'), {
    code: 'UI_DESIGNER_OVERWRITE_REQUIRED',
    recoverable: true,
    relativePath: 'data/ui-scenes/Scene_Sample.mzui',
    digest: 'existing-digest',
    mtimeMs: 12,
    affectedFiles: ['data/ui-scenes/Scene_Sample.mzui'],
  })

  const result = uiDesignerOperationError('saveAs', error)
  assert.equal(result.message, error.message)
  assert.equal(result.path, error.relativePath)
  assert.equal(result.code, error.code)
  assert.equal(result.recoverable, true)
})
