import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { translatePluginDiagnosticMessage, translatePluginDiagnosticMessages } from './pluginDiagnosticsI18n.ts'

describe('pluginDiagnosticsI18n', () => {
  test('keeps Chinese diagnostics unchanged in zh-CN mode', () => {
    assert.equal(
      translatePluginDiagnosticMessage('插件 QuestLog 的 parameters 必须是对象', 'zh-CN'),
      '插件 QuestLog 的 parameters 必须是对象',
    )
  })

  test('translates common plugin diagnostics in English mode', () => {
    assert.equal(
      translatePluginDiagnosticMessage('插件 QuestLog 的 parameters 必须是对象', 'en-US'),
      'Plugin QuestLog parameters must be an object',
    )
    assert.equal(
      translatePluginDiagnosticMessage('参数 difficulty 的 @default 不可解析为数字', 'en-US'),
      'Parameter difficulty @default cannot be parsed as a number',
    )
    assert.equal(
      translatePluginDiagnosticMessage('参数 rewards 的 @type "actor[]" 不受支持：数组元素类型不受支持', 'en-US'),
      'Parameter rewards has unsupported @type "actor[]": Array item type is not supported',
    )
  })

  test('translates diagnostic arrays', () => {
    assert.deepEqual(
      translatePluginDiagnosticMessages(['发现 @param 但缺少参数名', '未解析到 @param 定义'], 'en-US'),
      ['Found @param without a parameter name', 'No @param definitions were parsed'],
    )
  })
})
