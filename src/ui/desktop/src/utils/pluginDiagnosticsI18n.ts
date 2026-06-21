import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { pickByLocale } from '../i18n/messages.ts'

type PluginDiagnosticMatch = RegExpMatchArray

interface PluginDiagnosticPattern {
  id: string
  match: (message: string) => PluginDiagnosticMatch | null
  render: Record<ProductLanguage, (match: PluginDiagnosticMatch, source: string) => string>
}

const sourceMessage = {
  'zh-CN': (_match: PluginDiagnosticMatch, source: string) => source,
  'en-US': (_match: PluginDiagnosticMatch, source: string) => source,
} satisfies Record<ProductLanguage, (match: PluginDiagnosticMatch, source: string) => string>

const literal = (value: string): ((message: string) => PluginDiagnosticMatch | null) => (
  (message) => message === value ? [message] as unknown as RegExpMatchArray : null
)

const PLUGIN_DIAGNOSTIC_PATTERNS: readonly PluginDiagnosticPattern[] = [
  {
    id: 'plugin-file-missing-metadata',
    match: (message) => message.match(/^插件 (.+) 的文件不存在，无法读取参数元数据$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Plugin file for ${match[1]} does not exist, so parameter metadata cannot be read`,
    },
  },
  {
    id: 'plugin-no-parseable-header',
    match: (message) => message.match(/^插件 (.+) 缺少可解析的参数注释（未检测到 @plugindesc）$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Plugin ${match[1]} has no parseable parameter comments (@plugindesc was not detected)`,
    },
  },
  {
    id: 'plugin-no-parameters',
    match: (message) => message.match(/^插件 (.+) 的参数注释中未解析到任何参数$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `No parameters were parsed from plugin ${match[1]}'s parameter comments`,
    },
  },
  {
    id: 'plugin-entry-missing-name',
    match: (message) => message.match(/^第 (\d+) 个插件缺少名称$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Plugin entry ${match[1]} is missing a name`,
    },
  },
  {
    id: 'plugin-duplicate',
    match: (message) => message.match(/^插件重复配置：(.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Duplicate plugin configuration: ${match[1]}`,
    },
  },
  {
    id: 'plugin-parameters-object',
    match: (message) => message.match(/^插件 (.+) 的 parameters 必须是对象$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Plugin ${match[1]} parameters must be an object`,
    },
  },
  {
    id: 'plugin-file-missing-issue',
    match: (message) => message.match(/^插件文件缺失：(.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Plugin file is missing: ${match[1]}`,
    },
  },
  {
    id: 'plugins-js-parse-failed',
    match: (message) => message.match(/^plugins\.js 无法解析：(.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `plugins.js could not be parsed: ${match[1]}`,
    },
  },
  {
    id: 'param-without-name',
    match: literal('发现 @param 但缺少参数名'),
    render: {
      ...sourceMessage,
      'en-US': () => 'Found @param without a parameter name',
    },
  },
  {
    id: 'no-param-definitions',
    match: literal('未解析到 @param 定义'),
    render: {
      ...sourceMessage,
      'en-US': () => 'No @param definitions were parsed',
    },
  },
  {
    id: 'struct-without-name',
    match: literal('发现 struct 注释块但缺少 struct 名称'),
    render: {
      ...sourceMessage,
      'en-US': () => 'Found a struct comment block without a struct name',
    },
  },
  {
    id: 'array-item-type-unsupported',
    match: literal('数组元素类型不受支持'),
    render: {
      ...sourceMessage,
      'en-US': () => 'Array item type is not supported',
    },
  },
  {
    id: 'nested-array-unsupported',
    match: literal('嵌套数组暂不支持'),
    render: {
      ...sourceMessage,
      'en-US': () => 'Nested arrays are not supported yet',
    },
  },
  {
    id: 'unknown-before-tag',
    match: (message) => message.match(/^在 @(.+) 之前未识别对应参数$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `No matching parameter was recognized before @${match[1]}`,
    },
  },
  {
    id: 'unsupported-type',
    match: (message) => message.match(/^参数 (.+) 的 @type "(.+)" 不受支持(?::|：)?(.*)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => {
        const detail = match[3]?.trim()
        return `Parameter ${match[1]} has unsupported @type "${match[2]}"${detail ? `: ${translatePluginDiagnosticMessage(detail, 'en-US')}` : ''}`
      },
    },
  },
  {
    id: 'invalid-min',
    match: (message) => message.match(/^参数 (.+) 的 @min 非法：(.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} has invalid @min: ${match[2]}`,
    },
  },
  {
    id: 'invalid-max',
    match: (message) => message.match(/^参数 (.+) 的 @max 非法：(.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} has invalid @max: ${match[2]}`,
    },
  },
  {
    id: 'value-without-option',
    match: (message) => message.match(/^参数 (.+) 的 @value 没有可匹配的 @option$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} has @value without a matching @option`,
    },
  },
  {
    id: 'unsupported-tag',
    match: (message) => message.match(/^参数 (.+) 的 @(.+) 暂不支持$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} has unsupported @${match[2]}`,
    },
  },
  {
    id: 'invalid-field',
    match: (message) => message.match(/^忽略无效参数字段: (.+)$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Ignored invalid parameter field: ${match[1]}`,
    },
  },
  {
    id: 'min-greater-than-max',
    match: (message) => message.match(/^参数 (.+) 的 @min 大于 @max$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} has @min greater than @max`,
    },
  },
  {
    id: 'struct-no-editable-fields',
    match: (message) => message.match(/^参数 (.+) 的 struct (.*) 缺少可编辑字段$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} struct ${match[2]} has no editable fields`,
    },
  },
  {
    id: 'struct-default-invalid',
    match: (message) => message.match(/^参数 (.+) 的 @default 不可解析为 struct 对象$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} @default cannot be parsed as a struct object`,
    },
  },
  {
    id: 'missing-array-item-type',
    match: (message) => message.match(/^参数 (.+) 的数组元素类型缺失$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} is missing an array item type`,
    },
  },
  {
    id: 'array-struct-no-editable-fields',
    match: (message) => message.match(/^参数 (.+) 的数组 struct (.*) 缺少可编辑字段$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} array struct ${match[2]} has no editable fields`,
    },
  },
  {
    id: 'array-default-invalid',
    match: (message) => message.match(/^参数 (.+) 的 @default 不可解析为数组$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} @default cannot be parsed as an array`,
    },
  },
  {
    id: 'boolean-default-invalid',
    match: (message) => message.match(/^参数 (.+) 的 @default 不可解析为布尔值$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} @default cannot be parsed as a boolean`,
    },
  },
  {
    id: 'number-default-invalid',
    match: (message) => message.match(/^参数 (.+) 的 @default 不可解析为数字$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} @default cannot be parsed as a number`,
    },
  },
  {
    id: 'select-missing-option',
    match: (message) => message.match(/^参数 (.+) 声明为 select 但缺少 @option$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} is declared as select but has no @option`,
    },
  },
  {
    id: 'select-array-missing-option',
    match: (message) => message.match(/^参数 (.+) 声明为 select 数组但缺少 @option$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `Parameter ${match[1]} is declared as a select array but has no @option`,
    },
  },
  {
    id: 'duplicate-struct',
    match: (message) => message.match(/^struct (.+) 重复定义，后一个定义会覆盖前一个$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `struct ${match[1]} is defined more than once; the later definition will override the earlier one`,
    },
  },
  {
    id: 'struct-missing',
    match: (message) => message.match(/^struct (.+) 未定义或没有字段$/),
    render: {
      ...sourceMessage,
      'en-US': (match) => `struct ${match[1]} is undefined or has no fields`,
    },
  },
]

export function translatePluginDiagnosticMessage(message: string, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  for (const pattern of PLUGIN_DIAGNOSTIC_PATTERNS) {
    const match = pattern.match(message)
    if (match) return pickByLocale(language, pattern.render)(match, message)
  }
  return message
}

export function translatePluginDiagnosticMessages(messages: readonly string[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string[] {
  language = normalizeProductLanguage(language)
  return messages.map((message) => translatePluginDiagnosticMessage(message, language))
}
