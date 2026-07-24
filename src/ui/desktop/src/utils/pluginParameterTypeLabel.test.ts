import { describe, expect, test } from 'vitest';
import { translate } from '../i18n';
import { formatPluginParameterTypeLabel } from './pluginParameterTypeLabel';

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
