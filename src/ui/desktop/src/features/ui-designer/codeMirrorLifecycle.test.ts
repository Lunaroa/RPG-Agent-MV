import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createUiDesignerCodeMirrorBlurHandler,
  createUiDesignerCodeMirrorChangeHandler,
  formatUiDesignerCodeMirrorDocument,
  refreshUiDesignerCodeMirrorViewport,
} from './codeMirrorLifecycle'

test('CodeMirror blur reads the current auto-format preference without remounting', () => {
  let enabled = false
  let formatCalls = 0
  const handleBlur = createUiDesignerCodeMirrorBlurHandler(() => enabled, () => { formatCalls += 1 })
  handleBlur()
  enabled = true
  handleBlur()
  enabled = false
  handleBlur()
  assert.equal(formatCalls, 1)
})

test('CodeMirror refreshes lint but does not emit a user draft for setValue', () => {
  let value = 'initial'
  const emitted: string[] = []
  let lintCalls = 0
  const handleChange = createUiDesignerCodeMirrorChangeHandler(
    () => value,
    (next) => emitted.push(next),
    () => { lintCalls += 1 },
  )

  value = 'programmatic replacement'
  handleChange(undefined, { origin: 'setValue' })
  assert.equal(lintCalls, 1)
  assert.deepEqual(emitted, [])

  value = 'user edit'
  handleChange(undefined, { origin: '+input' })
  assert.equal(lintCalls, 2)
  assert.deepEqual(emitted, ['user edit'])
})

test('CodeMirror formatting covers the complete document in one operation', () => {
  const formattedLines: Array<[number, string | undefined]> = []
  let operationCalls = 0
  formatUiDesignerCodeMirrorDocument({
    lineCount: () => 4,
    indentLine: (line, direction) => formattedLines.push([line, direction]),
    operation: (format) => { operationCalls += 1; format() },
  })

  assert.equal(operationCalls, 1)
  assert.deepEqual(formattedLines, [[0, 'smart'], [1, 'smart'], [2, 'smart'], [3, 'smart']])
})

test('CodeMirror layout refresh restores the line start without losing vertical reading position', () => {
  const calls: string[] = []
  refreshUiDesignerCodeMirrorViewport({
    refresh: () => calls.push('refresh'),
    getScrollInfo: () => ({ top: 128 }),
    scrollTo: (left, top) => calls.push(`scroll:${left}:${top}`),
  })

  assert.deepEqual(calls, ['refresh', 'scroll:0:128'])
})
