/**
 * Run: node --experimental-strip-types --test src/utils/toolPresentation.test.ts
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { summarizeToolCall } from './toolPresentation.ts'

describe('summarizeToolCall', () => {
  test('renders command tools as Chinese command rows', () => {
    assert.deepEqual(
      summarizeToolCall('Shell', { command: 'npm run test' }),
      { kind: 'command', label: '运行命令', target: 'npm run test' },
    )
    assert.deepEqual(
      summarizeToolCall('functions.shell_command', { command: 'Get-ChildItem' }),
      { kind: 'command', label: '运行命令', target: 'Get-ChildItem' },
    )
  })

  test('renders Agent and subagent tools without exposing raw Agent as the title', () => {
    assert.deepEqual(
      summarizeToolCall('Agent', { description: '检查地图事件' }),
      { kind: 'subagent', label: '启动 subagent', target: '检查地图事件' },
    )
    assert.deepEqual(
      summarizeToolCall('multi_agent_v1.spawn_agent', { task: '整理素材' }),
      { kind: 'subagent', label: '启动 subagent', target: '整理素材' },
    )
    assert.deepEqual(
      summarizeToolCall('task', { description: '读取地图信息' }),
      { kind: 'subagent', label: '启动 subagent', target: '读取地图信息' },
    )
  })

  test('renders todo-list and plan tools as product actions', () => {
    assert.deepEqual(
      summarizeToolCall('TaskUpdate', { content: '完善 MAP001 测试事件' }),
      { kind: 'task', label: '更新待办', target: '完善 MAP001 测试事件' },
    )
    assert.deepEqual(
      summarizeToolCall('todowrite', { todos: [{ content: '读取项目事实' }] }),
      { kind: 'task', label: '更新待办', target: '读取项目事实' },
    )
    assert.deepEqual(
      summarizeToolCall('TASK', { title: '完善 MAP001 测试事件' }),
      { kind: 'task', label: '更新待办', target: '完善 MAP001 测试事件' },
    )
    assert.deepEqual(
      summarizeToolCall('PLAN', { plan: '1. 读取项目\n2. 修改事件' }),
      { kind: 'plan', label: '更新计划', target: '' },
    )
  })

  test('falls back to a tool action for unknown tools', () => {
    assert.deepEqual(
      summarizeToolCall('mcp__rmmv__RmmvReadContext', { action: 'mapIndex' }),
      { kind: 'tool', label: '调用工具', target: 'mapIndex' },
    )
  })

  test('renders common file and search tools with meaningful targets', () => {
    assert.deepEqual(
      summarizeToolCall('glob', { pattern: '**/Map*.json' }),
      { kind: 'tool', label: '查找文件', target: '**/Map*.json' },
    )
    assert.deepEqual(
      summarizeToolCall('read', { path: 'data/MapInfos.json' }),
      { kind: 'tool', label: '读取文件', target: 'data/MapInfos.json' },
    )
    assert.deepEqual(
      summarizeToolCall('grep', { pattern: 'registry', path: 'src' }),
      { kind: 'tool', label: '搜索内容', target: 'registry' },
    )
  })
})
