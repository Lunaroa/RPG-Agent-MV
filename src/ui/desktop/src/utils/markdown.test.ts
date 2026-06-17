/**
 * Run: node --experimental-strip-types --test src/utils/markdown.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { renderMarkdown } from './markdown.ts'

describe('renderMarkdown', () => {
  test('renders bold, inline code, and ordered list', () => {
    const html = renderMarkdown([
      '**剩余风险 / 你可能想接着做的事**',
      '',
      '1. 打开 `runtime/session/foo.json`',
      '2. **确认** 后再继续',
    ].join('\n'))
    assert.match(html, /<strong>剩余风险 \/ 你可能想接着做的事<\/strong>/)
    assert.match(html, /<code>runtime\/session\/foo\.json<\/code>/)
    assert.match(html, /<ol>/)
    assert.match(html, /<li>.*<strong>确认<\/strong>/)
    assert.doesNotMatch(html, /\*\*剩余风险/)
    assert.doesNotMatch(html, /`runtime/)
  })

  test('renders multiple bold spans in one line', () => {
    const html = renderMarkdown('**a** and **b**')
    assert.equal(html, '<p><strong>a</strong> and <strong>b</strong></p>')
  })

  test('renders markdown tables with inline formatting', () => {
    const html = renderMarkdown([
      '| 工具 | 状态 |',
      '|------|------|',
      '| **ASK** | `AskUserQuestion` |',
    ].join('\n'))
    assert.match(html, /<table>/)
    assert.match(html, /<strong>ASK<\/strong>/)
    assert.match(html, /<code>AskUserQuestion<\/code>/)
    assert.doesNotMatch(html, /\| \*\*ASK\*\*/)
  })
})
