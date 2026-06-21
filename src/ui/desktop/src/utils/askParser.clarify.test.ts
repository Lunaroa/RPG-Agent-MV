/**
 * Run: node --experimental-strip-types --test src/utils/askParser.clarify.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  parseAgentAsk,
  parseAskFromToolCall,
  parseOptionalBoolean,
} from './askParser.ts'

describe('parseOptionalBoolean', () => {
  test('does not treat string "false" as true', () => {
    assert.equal(parseOptionalBoolean('false'), false)
    assert.equal(parseOptionalBoolean('true'), true)
    assert.equal(parseOptionalBoolean('0'), false)
    assert.equal(parseOptionalBoolean('1'), true)
  })
})

describe('clarify ASK with options', () => {
  test('parses recommended existing maps for a map decision', () => {
    const ask = parseAgentAsk(JSON.stringify({
      type: 'map-selection',
      title: '选择场景地图',
      prompt: '现有地图不足时再新增',
      candidates: [
        { mapId: 4, mapName: '示例场景 A', reason: '已有基础室内结构' },
        { mapId: 8, mapName: '示例场景 B', reason: '适合改为临时会面点' },
      ],
    }))
    assert.deepEqual(ask?.candidates, [
      { mapId: 4, mapName: '示例场景 A', reason: '已有基础室内结构' },
      { mapId: 8, mapName: '示例场景 B', reason: '适合改为临时会面点' },
    ])
  })

  test('parses options from agent-console JSON', () => {
    const ask = parseAgentAsk(JSON.stringify({
      type: 'clarify',
      title: '剧情推进方式',
      prompt: '请选择本章主要推进方式',
      fieldName: 'story_progress_method',
      options: [
        { id: 'explore', label: '探索驱动', description: '玩家自由探索触发事件' },
        { id: 'linear', label: '线性主线', description: '按任务顺序推进' },
      ],
    }))
    assert.equal(ask?.type, 'clarify')
    assert.equal(ask?.options?.length, 2)
    assert.equal(ask?.options?.[0].id, 'explore')
    assert.equal(ask?.allowOther, false)
  })

  test('allowOther true only when explicitly set', () => {
    const ask = parseAgentAsk(JSON.stringify({
      type: 'clarify',
      title: '测试',
      prompt: '选一个',
      options: [{ label: 'A' }, { label: 'B' }],
      allowOther: true,
    }))
    assert.equal(ask?.allowOther, true)
  })

  test('parses askuser_ask_clarify MCP tool input', () => {
    const ask = parseAskFromToolCall('askuser_ask_clarify', 'mcp-test-1', {
      title: '测试',
      prompt: '选一个',
      options: [
        { label: 'A' },
        { label: 'B' },
      ],
    })
    assert.equal(ask?.fromMcp, true)
    assert.equal(ask?.askId, 'mcp-test-1')
    assert.deepEqual(ask?.options?.map((o) => o.label), ['A', 'B'])
  })

  test('parses Claude-compatible mcp__askuser__ask_clarify tool name', () => {
    const ask = parseAskFromToolCall('mcp__askuser__ask_clarify', 'toolu-1', {
      title: 'ASK',
      prompt: '二选一',
      options: [{ label: 'X' }, { label: 'Y' }],
    })
    assert.equal(ask?.type, 'clarify')
    assert.equal(ask?.fromMcp, false)
    assert.equal(ask?.askId, 'toolu-1')
  })

  test('legacy MCP askId marks fromMcp for old transcript compatibility', () => {
    const ask = parseAskFromToolCall('askuser_ask_clarify', 'mcp-abc-123', {
      title: '网关 ASK',
      prompt: '二选一',
      options: [{ label: 'A' }, { label: 'B' }],
    })
    assert.equal(ask?.fromMcp, true)
  })

  test('multi-choice keeps single-select when multiSelect is string false', () => {
    const ask = parseAskFromToolCall('askuser_ask_multi_choice_clarify', 'mcp-mcc-1', {
      title: '空事件分类确认',
      questions: [{
        header: '删除范围',
        question: '选择要清理的空事件',
        multiSelect: 'false',
        options: [
          { id: 'a', label: 'A 类' },
          { id: 'b', label: 'B 类' },
        ],
      }],
    })
    assert.equal(ask?.type, 'multi-choice-clarify')
    assert.equal(ask?.questions?.[0].multiSelect, false)
  })

  test('multi-choice dedupes duplicate option ids', () => {
    const ask = parseAskFromToolCall('askuser_ask_multi_choice_clarify', 'mcp-mcc-2', {
      title: '确认',
      questions: [{
        header: 'Q',
        question: 'pick',
        options: [
          { id: 'choice', label: 'A' },
          { id: 'choice', label: 'B' },
        ],
      }],
    })
    const ids = ask?.questions?.[0].options.map((o) => o.id)
    assert.deepEqual(ids, ['choice', 'choice-2'])
  })

  test('multi-choice with no valid questions returns null', () => {
    const ask = parseAskFromToolCall('askuser_ask_multi_choice_clarify', 'mcp-x', {
      title: '空壳',
      questions: [{ header: 'Q1', question: 'x', options: [{ label: 'only' }] }],
    })
    assert.equal(ask, null)
  })

  test('omits options when fewer than two', () => {
    const ask = parseAgentAsk(JSON.stringify({
      type: 'clarify',
      title: '开放题',
      prompt: '请说明',
      options: [{ label: '仅一项' }],
    }))
    assert.equal(ask?.options, undefined)
  })

  test('uses English fallbacks when product language is English', () => {
    const ask = parseAgentAsk(JSON.stringify({
      type: 'multi-choice-clarify',
      questions: [{
        options: [{}, {}],
      }],
    }), { language: 'en-US' })
    assert.equal(ask?.title, 'More Information Needed')
    assert.equal(ask?.prompt, 'Answer the questions')
    assert.equal(ask?.questions?.[0].header, 'Question 1')
    assert.deepEqual(ask?.questions?.[0].options.map((option) => option.label), ['Option 1', 'Option 2'])
  })
})
