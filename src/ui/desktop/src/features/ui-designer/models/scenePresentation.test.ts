import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultNode, createUiDocument } from './document'
import { parseUiDocument } from './parser'

test('legacy scenes gain an empty title and retain their existing text spacing', () => {
  const document = createUiDocument('Scene_Example')
  const text = createDefaultNode('text', { id: 'text_1', name: 'Text', parentId: 'node_root' })
  const button = createDefaultNode('button', { id: 'button_1', name: 'Button', parentId: 'node_root' })
  document.nodes.push(text, button)
  document.nodes[0]!.children.push(text.id, button.id)
  const legacy = JSON.parse(JSON.stringify(document))
  delete legacy.meta.title
  delete legacy.nodes[1].props.lineHeight
  delete legacy.nodes[2].props.lineHeight

  const parsed = parseUiDocument(legacy)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.document?.meta.title, '')
  assert.equal(parsed.document?.nodes[1]?.type === 'text' ? parsed.document.nodes[1].props.lineHeight : 0, 1.2)
  assert.equal(parsed.document?.nodes[2]?.type === 'button' ? parsed.document.nodes[2].props.lineHeight : 0, 1.3)
})

test('scene titles and text line-height multipliers survive a file round trip', () => {
  const document = createUiDocument('Scene_Example')
  const text = createDefaultNode('text', { id: 'text_1', name: 'Text', parentId: 'node_root' })
  document.nodes.push(text)
  document.nodes[0]!.children.push(text.id)
  document.meta.title = '示例标题'
  text.props.lineHeight = 1.6

  const parsed = parseUiDocument(JSON.stringify(document))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.document?.meta.title, '示例标题')
  assert.equal(parsed.document?.nodes[1]?.type === 'text' ? parsed.document.nodes[1].props.lineHeight : 0, 1.6)
})

test('zero line height is rejected before the scene is opened', () => {
  const document = createUiDocument('Scene_Example')
  const text = createDefaultNode('text', { id: 'text_1', name: 'Text', parentId: 'node_root' })
  text.props.lineHeight = 0
  document.nodes.push(text)
  document.nodes[0]!.children.push(text.id)

  const parsed = parseUiDocument(document)
  assert.equal(parsed.ok, false)
  assert.ok(parsed.issues.some((issue) => issue.path === 'nodes.1.props.lineHeight'))
})
