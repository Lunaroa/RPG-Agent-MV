/**
 * Run: node --experimental-strip-types --test src/stores/taskBoardProjection.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  applyTaskToolCall,
  applyTodoSnapshot,
  taskFromBackend,
  todoFromOpencode,
} from './taskBoardProjection.ts'

describe('taskBoardProjection', () => {
  test('applyTodoSnapshot replaces list with authoritative OpenCode todos', () => {
    const todos = [
      { content: '测试 ASK 卡片功能', status: 'completed', priority: 'high' },
      { content: '测试事件注册与放置流程', status: 'in_progress', priority: 'medium' },
      { content: '测试派遣子 agent', status: 'pending', priority: 'low' },
    ]
    const result = applyTodoSnapshot([], todos)

    assert.equal(result.length, 3)
    assert.deepEqual(result[0], { id: 'todo:1', subject: '测试 ASK 卡片功能', description: '', status: 'completed' })
    assert.deepEqual(result[1], { id: 'todo:2', subject: '测试事件注册与放置流程', description: '', status: 'in_progress' })
    assert.deepEqual(result[2], { id: 'todo:3', subject: '测试派遣子 agent', description: '', status: 'pending' })
  })

  test('applyTodoSnapshot filters out invalid items', () => {
    const todos = [
      { id: '1', content: '有效任务', status: 'pending' },
      { id: '', content: '没有 id 也应使用位置生成 id', status: 'pending' },
      { id: '3', content: '', status: 'pending' },
      null,
      'string item',
      { id: '4', content: '也有效', status: 'completed' },
    ]
    const result = applyTodoSnapshot([], todos)

    assert.equal(result.length, 3)
    assert.equal(result[0]!.id, '1')
    assert.equal(result[1]!.id, 'todo:2')
    assert.equal(result[2]!.id, '4')
  })

  test('todoFromOpencode maps OpenCode todo shape to TaskItem', () => {
    const item = todoFromOpencode({ content: '做某件事', status: 'in_progress', priority: 'high' }, 4)
    assert.deepEqual(item, { id: 'todo:5', subject: '做某件事', description: '', status: 'in_progress' })
  })

  test('todoFromOpencode returns null for invalid input', () => {
    assert.equal(todoFromOpencode(null), null)
    assert.equal(todoFromOpencode({ id: '1', content: '' }), null)
    assert.equal(todoFromOpencode('string'), null)
  })

  test('taskFromBackend accepts opencode content as the task subject', () => {
    const item = taskFromBackend({ id: 'todo:1', content: '回读任务', status: 'pending' })
    assert.deepEqual(item, { id: 'todo:1', subject: '回读任务', description: '', status: 'pending', activeForm: undefined })
  })

  test('applyTaskToolCall handles todowrite snapshots normalized as TaskUpdate', () => {
    const result = applyTaskToolCall([], 'TaskUpdate', {
      todos: [
        { content: '读取项目事实', status: 'completed', priority: 'high' },
        { content: '注册事件草稿', status: 'in_progress', priority: 'medium' },
      ],
    }, 'call-todo')

    assert.deepEqual(result.map((item) => [item.id, item.subject, item.status]), [
      ['todo:1', '读取项目事实', 'completed'],
      ['todo:2', '注册事件草稿', 'in_progress'],
    ])
  })

  test('applyTaskToolCall handles TaskUpdate deletion', () => {
    const initial = [
      { id: '1', subject: '任务 A', description: '', status: 'pending' as const },
      { id: '2', subject: '任务 B', description: '', status: 'pending' as const },
    ]
    const result = applyTaskToolCall(initial, 'TaskUpdate', { taskId: '1', status: 'deleted' }, 'call-1')

    assert.equal(result.length, 1)
    assert.equal(result[0]!.id, '2')
  })

  test('applyTaskToolCall ignores non-TaskUpdate tools', () => {
    const initial = [{ id: '1', subject: '任务 A', description: '', status: 'pending' as const }]
    const result = applyTaskToolCall(initial, 'Agent', { task: 'subtask' }, 'call-2')
    assert.equal(result.length, 1)
    assert.equal(result[0]!.id, '1')
  })
})
