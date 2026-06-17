/**
 * Run: node --experimental-strip-types --test src/utils/consoleRunGroups.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { groupSessionsIntoRunLogs, type RunLogSessionLike } from './consoleRunGroups.ts'

function session(id: string, overrides: Partial<RunLogSessionLike> = {}): RunLogSessionLike {
  return {
    id,
    status: 'pass',
    project: 'projects/sample-project',
    intent: id,
    displayText: id,
    createdAt: '2026-06-15T04:40:00.000Z',
    updatedAt: '2026-06-15T04:40:00.000Z',
    ...overrides,
  }
}

describe('groupSessionsIntoRunLogs', () => {
  test('collapses continuation sessions into one run log row', () => {
    const logs = groupSessionsIntoRunLogs([
      session('root', {
        displayText: 'Sample task A',
        updatedAt: '2026-06-15T04:40:17.073Z',
      }),
      session('middle', {
        parentSessionId: 'root',
        displayText: 'Sample task B',
        status: 'stopped',
        updatedAt: '2026-06-15T04:45:19.080Z',
      }),
      session('leaf', {
        parentSessionId: 'middle',
        displayText: 'Sample task C',
        status: 'running',
        updatedAt: '2026-06-15T04:45:20.451Z',
      }),
      session('other', {
        displayText: '另一段对话',
        updatedAt: '2026-06-15T03:00:00.000Z',
      }),
    ])

    assert.equal(logs.length, 2)
    assert.equal(logs[0].rootId, 'root')
    assert.equal(logs[0].leafId, 'leaf')
    assert.equal(logs[0].title, 'Sample task A')
    assert.equal(logs[0].status, 'running')
    assert.deepEqual(logs[0].sessionIds, ['root', 'middle', 'leaf'])
    assert.equal(logs[0].turnCount, 3)
  })

  test('keeps every chained title searchable from the merged row', () => {
    const logs = groupSessionsIntoRunLogs([
      session('root', { displayText: '初始问题' }),
      session('child', {
        parentSessionId: 'root',
        displayText: '只出现在续聊里的关键词',
        updatedAt: '2026-06-15T04:41:00.000Z',
      }),
    ])

    assert.equal(logs.length, 1)
    assert.match(logs[0].searchText, /初始问题/)
    assert.match(logs[0].searchText, /只出现在续聊里的关键词/)
    assert.match(logs[0].searchText, /child/)
  })
})
