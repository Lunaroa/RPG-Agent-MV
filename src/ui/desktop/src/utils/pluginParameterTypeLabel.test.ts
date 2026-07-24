import { describe, expect, test } from 'vitest';
import { translate } from '../i18n';
import {
  formatPluginParameterTypeLabel,
  pluginParameterTypeLabelIsList,
  pluginParameterTypeStructParts,
  stripPluginParameterTypeListBrackets,
} from './pluginParameterTypeLabel';

describe('formatPluginParameterTypeLabel', () => {
  const zh = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) =>
    translate(key, 'zh-CN', params);
  const en = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) =>
    translate(key, 'en-US', params);

  test('translates standard RM types and aliases', () => {
    expect(formatPluginParameterTypeLabel('string', null, zh)).toBe('字符串');
    expect(formatPluginParameterTypeLabel('text', null, zh)).toBe('字符串');
    expect(formatPluginParameterTypeLabel('number', null, zh)).toBe('数字');
    expect(formatPluginParameterTypeLabel('float', null, zh)).toBe('数字');
    expect(formatPluginParameterTypeLabel('boolean', null, zh)).toBe('布尔值');
    expect(formatPluginParameterTypeLabel('bool', null, zh)).toBe('布尔值');
    expect(formatPluginParameterTypeLabel('switch', null, zh)).toBe('开关');
    expect(formatPluginParameterTypeLabel('common_event', null, en)).toBe('Common Event');
    expect(formatPluginParameterTypeLabel('string', null, en)).toBe('String');
  });

  test('formats structs and arrays with translated bases', () => {
    expect(formatPluginParameterTypeLabel('struct<MenuText>', null, zh)).toBe('结构体 · MenuText');
    expect(formatPluginParameterTypeLabel('struct< MenuText >', null, en)).toBe('Struct · MenuText');
    expect(formatPluginParameterTypeLabel('number[]', null, zh)).toBe('数字[]');
    expect(formatPluginParameterTypeLabel('boolean[]', null, zh)).toBe('布尔值[]');
    expect(formatPluginParameterTypeLabel('number[][]', null, zh)).toBe('数字[][]');
    expect(formatPluginParameterTypeLabel('struct<MenuText>[]', null, zh)).toBe('结构体 · MenuText[]');
  });

  test('keeps non-standard raw types unchanged', () => {
    expect(formatPluginParameterTypeLabel('custom_type', null, zh)).toBe('custom_type');
    expect(formatPluginParameterTypeLabel('image', null, zh)).toBe('image');
    expect(formatPluginParameterTypeLabel('json', null, en)).toBe('json');
    expect(formatPluginParameterTypeLabel('weird[]', null, zh)).toBe('weird[]');
  });

  test('falls back to kind when raw type is missing', () => {
    expect(formatPluginParameterTypeLabel('', 'number', zh)).toBe('数字');
    expect(formatPluginParameterTypeLabel(null, 'text', zh)).toBe('字符串');
    expect(formatPluginParameterTypeLabel('', 'mystery', zh)).toBe('mystery');
  });
});

describe('list / struct type display helpers', () => {
  test('detects list brackets and strips them for tagged display', () => {
    expect(pluginParameterTypeLabelIsList('字符串[]')).toBe(true);
    expect(pluginParameterTypeLabelIsList('数字[][]')).toBe(true);
    expect(pluginParameterTypeLabelIsList('字符串')).toBe(false);
    expect(stripPluginParameterTypeListBrackets('字符串[]')).toBe('字符串');
    expect(stripPluginParameterTypeListBrackets('结构体 · MenuText[]')).toBe('结构体 · MenuText');
    expect(stripPluginParameterTypeListBrackets('数字[][]')).toBe('数字');
  });

  test('splits struct keyword for blue tag rendering', () => {
    expect(pluginParameterTypeStructParts('结构体 · TestStruct')).toEqual({
      keyword: '结构体',
      name: 'TestStruct',
    });
    expect(pluginParameterTypeStructParts('Struct · MenuText')).toEqual({
      keyword: 'Struct',
      name: 'MenuText',
    });
    expect(pluginParameterTypeStructParts('字符串')).toBeNull();
  });
});
