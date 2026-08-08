import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import {
  UiDesignerNodeTemplateError,
  assertUiDesignerNodeTemplate,
  listUiDesignerNodeTemplates,
  nodeTemplateFilePath,
  readUiDesignerNodeTemplate,
  removeUiDesignerNodeTemplate,
  writeUiDesignerNodeTemplate,
} from './ui-designer-node-template-service.ts'

let root = ''

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-template-')) })
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = '' })

test('round-trips a mztemplate node group without touching a project', () => {
  const group = sampleGroup()
  const target = nodeTemplateFilePath(root, group.name)
  writeUiDesignerNodeTemplate(target, group)
  assert.equal(path.extname(target), '.mztemplate')
  assert.equal(readUiDesignerNodeTemplate(target).name, 'SampleGroup')
  assert.deepEqual(listUiDesignerNodeTemplates(root), [{ name: 'SampleGroup', modifiedAt: listUiDesignerNodeTemplates(root)[0]!.modifiedAt }])
  removeUiDesignerNodeTemplate(root, group.name)
  assert.deepEqual(listUiDesignerNodeTemplates(root), [])
})

test('rejects malformed node groups and path traversal', () => {
  assert.throws(() => assertUiDesignerNodeTemplate({ format: 'mztemplate', version: '1.0.0', name: 'bad', roots: ['missing'], nodes: [], origin: { x: 0, y: 0, width: 0, height: 0 } }), (error: unknown) => error instanceof UiDesignerNodeTemplateError)
  assert.throws(() => nodeTemplateFilePath(root, '../outside'), (error: unknown) => error instanceof UiDesignerNodeTemplateError)
  assert.throws(() => nodeTemplateFilePath(root, 'sample.mzui'), (error: unknown) => error instanceof UiDesignerNodeTemplateError)
})

function sampleGroup() {
  return {
    format: 'mztemplate' as const,
    version: '1.0.0' as const,
    name: 'SampleGroup',
    roots: ['node_root'],
    nodes: [{
      id: 'node_root', type: 'container' as const, name: 'Root', parentId: null, children: [],
      props: { x: 0, y: 0, width: 100, height: 80 }, propModes: {}, propCodes: {},
    }],
    origin: { x: 0, y: 0, width: 100, height: 80 },
  }
}
