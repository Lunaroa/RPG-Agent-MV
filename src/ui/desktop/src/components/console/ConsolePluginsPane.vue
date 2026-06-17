<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, EditPen, Refresh } from '@element-plus/icons-vue';
import {
  plugins as pluginApi,
  type ManagedPluginEntry,
  type ManagedPluginFile,
  type PluginConfigurationResult,
  type PluginParameterSchemaField,
  type PluginValidationIssue,
} from '../../api/client';
import { useProjectStore } from '../../stores/project';
import ConsoleSearchInput from './ConsoleSearchInput.vue';

const projectStore = useProjectStore();
const config = ref<PluginConfigurationResult | null>(null);
const selectedName = ref('');
const search = ref('');
const loading = ref(false);
const busyKey = ref('');
const error = ref('');
const actionMessage = ref('');
const parametersText = ref('{}');
const parametersError = ref('');
const parameterForm = ref<Record<string, unknown>>({});

const plugins = computed(() => config.value?.plugins || []);
const pluginFiles = computed(() => config.value?.pluginFiles || []);
const issues = computed(() => config.value?.validation.issues || []);
const blockers = computed(() => issues.value.filter((issue) => issue.severity === 'error'));
const warnings = computed(() => issues.value.filter((issue) => issue.severity === 'warn'));
const enabledCount = computed(() => plugins.value.filter((plugin) => plugin.status).length);
const missingFileCount = computed(() => plugins.value.filter((plugin) => plugin.name && !plugin.fileExists).length);
const configuredNames = computed(() => new Set(plugins.value.map((plugin) => plugin.name).filter(Boolean)));
const orphanFiles = computed(() => pluginFiles.value.filter((file) => !configuredNames.value.has(file.name)));

const filteredPlugins = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return plugins.value;
  return plugins.value.filter((plugin) =>
    [plugin.name, plugin.description, plugin.fileName, plugin.fileRelativePath]
      .some((part) => String(part || '').toLocaleLowerCase().includes(query)),
  );
});

const selectedPlugin = computed(() =>
  plugins.value.find((plugin) => plugin.name === selectedName.value) || plugins.value[0] || null,
);

const schemaFields = computed(() => selectedPlugin.value?.parameterSchema?.fields || []);
const hasSchemaFields = computed(() => schemaFields.value.length > 0);
const schemaWarnings = computed(() => selectedPlugin.value?.parameterSchemaWarnings || []);
const validationStatusLabel = computed(() => {
  if (blockers.value.length) return '有阻断';
  if (warnings.value.length || schemaWarnings.value.length) return '有警告';
  return '插件可用';
});
const technicalIssueCount = computed(() => issues.value.length + schemaWarnings.value.length);
const parametersDirty = computed(() => {
  const plugin = selectedPlugin.value;
  if (!plugin) return false;
  const next = buildParametersPayload(false);
  return next ? formatParameters(next) !== formatParameters(plugin.parameters) : false;
});

watch(() => projectStore.currentProject, () => {
  resetState();
  if (projectStore.currentProject) void loadPlugins();
});

watch(selectedPlugin, (plugin) => {
  resetParameterEditors(plugin);
});

onMounted(() => {
  if (projectStore.currentProject) void loadPlugins();
});

function resetState() {
  config.value = null;
  selectedName.value = '';
  search.value = '';
  error.value = '';
  actionMessage.value = '';
  parametersError.value = '';
  parametersText.value = '{}';
  parameterForm.value = {};
  busyKey.value = '';
}

function applyConfig(next: PluginConfigurationResult) {
  config.value = next;
  if (!next.plugins.some((plugin) => plugin.name === selectedName.value)) {
    selectedName.value = next.plugins[0]?.name || '';
  }
}

async function loadPlugins() {
  if (!projectStore.currentProject) return;
  loading.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    applyConfig(await pluginApi.read(projectStore.currentProject));
  } catch (loadError) {
    config.value = null;
    error.value = (loadError as Error).message;
  } finally {
    loading.value = false;
  }
}

async function runAction(key: string, action: () => Promise<PluginConfigurationResult>, message: string) {
  if (!projectStore.currentProject || busyKey.value) return;
  busyKey.value = key;
  error.value = '';
  actionMessage.value = '';
  try {
    applyConfig(await action());
    actionMessage.value = message;
  } catch (actionError) {
    error.value = (actionError as Error).message;
  } finally {
    busyKey.value = '';
  }
}

function selectPlugin(plugin: ManagedPluginEntry) {
  selectedName.value = plugin.name;
}

function canMove(plugin: ManagedPluginEntry, delta: -1 | 1) {
  if (!plugin.name || busyKey.value || !config.value) return false;
  const index = plugins.value.findIndex((entry) => entry.name === plugin.name);
  const nextIndex = index + delta;
  return index >= 0 && nextIndex >= 0 && nextIndex < plugins.value.length;
}

async function togglePlugin(plugin: ManagedPluginEntry) {
  if (!projectStore.currentProject || !plugin.name) return;
  const nextEnabled = !plugin.status;
  await runAction(
    `toggle:${plugin.name}`,
    () => pluginApi.setEnabled(plugin.name, nextEnabled, projectStore.currentProject),
    nextEnabled ? `已启用 ${plugin.name}` : `已禁用 ${plugin.name}`,
  );
}

async function movePlugin(plugin: ManagedPluginEntry, delta: -1 | 1) {
  if (!projectStore.currentProject || !canMove(plugin, delta)) return;
  const names = plugins.value.map((entry) => entry.name);
  const index = names.indexOf(plugin.name);
  const nextIndex = index + delta;
  [names[index], names[nextIndex]] = [names[nextIndex], names[index]];
  await runAction(
    `move:${plugin.name}:${delta}`,
    () => pluginApi.reorder(names, projectStore.currentProject),
    `已调整 ${plugin.name} 的加载顺序`,
  );
}

async function saveParameters() {
  const plugin = selectedPlugin.value;
  if (!projectStore.currentProject || !plugin?.name || busyKey.value) return;
  parametersError.value = '';
  const parsed = buildParametersPayload(true);
  if (!parsed) return;
  await runAction(
    `params:${plugin.name}`,
    () => pluginApi.updateParameters(plugin.name, parsed, projectStore.currentProject),
    `已保存 ${plugin.name} 的参数`,
  );
}

function formatParameters(value: Record<string, unknown>) {
  return JSON.stringify(value || {}, null, 2);
}

function resetParameterEditors(plugin: ManagedPluginEntry | null) {
  parametersError.value = '';
  if (!plugin) {
    parameterForm.value = {};
    parametersText.value = '{}';
    return;
  }
  const fields = plugin.parameterSchema?.fields || [];
  parameterForm.value = Object.fromEntries(fields.map((field) => [
    field.key,
    normalizeFieldFormValue(field, plugin.parameters[field.key]),
  ]));
  parametersText.value = fields.length
    ? formatParameters(unknownParameters(plugin.parameters, fields))
    : formatParameters(plugin.parameters);
}

function unknownParameters(value: Record<string, unknown>, fields: PluginParameterSchemaField[]) {
  const known = new Set(fields.map((field) => field.key));
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !known.has(key)));
}

function parseParameterJson(reportErrors: boolean): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(parametersText.value || '{}');
  } catch (parseError) {
    if (reportErrors) parametersError.value = `JSON 解析失败：${(parseError as Error).message}`;
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (reportErrors) parametersError.value = hasSchemaFields.value ? '未识别参数必须是 JSON 对象' : 'parameters 必须是 JSON 对象';
    return null;
  }
  return parsed as Record<string, unknown>;
}

function buildParametersPayload(reportErrors: boolean): Record<string, unknown> | null {
  const parsed = parseParameterJson(reportErrors);
  if (!parsed) return null;
  if (!hasSchemaFields.value) return parsed;
  const next: Record<string, unknown> = { ...parsed };
  for (const field of schemaFields.value) next[field.key] = serializeFieldValue(field, parameterForm.value[field.key]);
  return next;
}

function parameterFormValue(field: PluginParameterSchemaField) {
  return parameterForm.value[field.key] ?? defaultFieldFormValue(field);
}

function setParameterFormValue(field: PluginParameterSchemaField, value: unknown) {
  parameterForm.value = { ...parameterForm.value, [field.key]: value };
}

function parameterCheckboxValue(field: PluginParameterSchemaField) {
  const value = parameterFormValue(field);
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function setParameterCheckboxValue(field: PluginParameterSchemaField, event: Event) {
  setParameterFormValue(field, (event.target as HTMLInputElement).checked ? 'true' : 'false');
}

function parameterInputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

function normalizeFieldFormValue(field: PluginParameterSchemaField, rawValue: unknown): unknown {
  const value = rawValue ?? field.defaultValue;
  if (field.kind === 'struct') return normalizeStructValue(field, value);
  if (field.kind === 'array') return normalizeArrayValue(field, value);
  if (value === undefined || value === null) return defaultFieldFormValue(field);
  return value;
}

function defaultFieldFormValue(field: PluginParameterSchemaField): unknown {
  if (field.kind === 'struct') return normalizeStructValue(field, field.defaultValue);
  if (field.kind === 'array') return normalizeArrayValue(field, field.defaultValue);
  if (field.kind === 'boolean') return field.defaultValue ?? 'false';
  return field.defaultValue ?? '';
}

function normalizeStructValue(field: PluginParameterSchemaField, rawValue: unknown): Record<string, unknown> {
  const parsed = parseMaybeJson(rawValue);
  const source = isPlainObject(parsed) ? parsed : {};
  return Object.fromEntries((field.fields || []).map((child) => [
    child.key,
    normalizeFieldFormValue(child, source[child.key]),
  ]));
}

function normalizeArrayValue(field: PluginParameterSchemaField, rawValue: unknown): unknown[] {
  const parsed = parseMaybeJson(rawValue);
  if (!Array.isArray(parsed)) return [];
  const item = field.item;
  if (!item) return [];
  return parsed.map((entry) => normalizeFieldFormValue(item, entry));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function serializeFieldValue(field: PluginParameterSchemaField, value: unknown): unknown {
  if (field.kind === 'struct') return JSON.stringify(serializeStructValue(field, value));
  if (field.kind === 'array') {
    const item = field.item;
    const entries = Array.isArray(value) ? value : [];
    if (!item) return '[]';
    return JSON.stringify(entries.map((entry) =>
      item.kind === 'struct'
        ? JSON.stringify(serializeStructValue(item, entry))
        : serializeScalarFieldValue(item, entry),
    ));
  }
  return serializeScalarFieldValue(field, value);
}

function serializeStructValue(field: PluginParameterSchemaField, value: unknown): Record<string, unknown> {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries((field.fields || []).map((child) => [
    child.key,
    serializeFieldValue(child, source[child.key]),
  ]));
}

function serializeScalarFieldValue(field: PluginParameterSchemaField, value: unknown): unknown {
  if (field.kind === 'boolean') return value === true || value === 'true' || value === 'on' || value === '1' ? 'true' : 'false';
  if (value === undefined || value === null) return '';
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWideField(field: PluginParameterSchemaField): boolean {
  return field.kind === 'json'
    || field.kind === 'struct'
    || field.kind === 'array'
    || (field.kind === 'text' && String(parameterFormValue(field)).length > 80);
}

function structFields(field: PluginParameterSchemaField): PluginParameterSchemaField[] {
  return field.fields || [];
}

function structFieldValue(field: PluginParameterSchemaField, child: PluginParameterSchemaField): unknown {
  const source = parameterFormValue(field);
  return isPlainObject(source) ? source[child.key] ?? defaultFieldFormValue(child) : defaultFieldFormValue(child);
}

function setStructFieldValue(field: PluginParameterSchemaField, child: PluginParameterSchemaField, value: unknown) {
  const source = parameterFormValue(field);
  const next = isPlainObject(source) ? { ...source } : {};
  next[child.key] = value;
  setParameterFormValue(field, next);
}

function arrayItems(field: PluginParameterSchemaField): unknown[] {
  const value = parameterFormValue(field);
  return Array.isArray(value) ? value : [];
}

function addArrayItem(field: PluginParameterSchemaField) {
  const item = field.item;
  if (!item) return;
  setParameterFormValue(field, [...arrayItems(field), defaultFieldFormValue(item)]);
}

function removeArrayItem(field: PluginParameterSchemaField, index: number) {
  setParameterFormValue(field, arrayItems(field).filter((_, itemIndex) => itemIndex !== index));
}

function arrayScalarValue(field: PluginParameterSchemaField, index: number): unknown {
  return arrayItems(field)[index] ?? defaultFieldFormValue(field.item || field);
}

function setArrayScalarValue(field: PluginParameterSchemaField, index: number, value: unknown) {
  const next = [...arrayItems(field)];
  next[index] = value;
  setParameterFormValue(field, next);
}

function arrayStructFieldValue(field: PluginParameterSchemaField, index: number, child: PluginParameterSchemaField): unknown {
  const item = arrayItems(field)[index];
  return isPlainObject(item) ? item[child.key] ?? defaultFieldFormValue(child) : defaultFieldFormValue(child);
}

function setArrayStructFieldValue(field: PluginParameterSchemaField, index: number, child: PluginParameterSchemaField, value: unknown) {
  const next = [...arrayItems(field)];
  const item = isPlainObject(next[index]) ? { ...next[index] as Record<string, unknown> } : {};
  item[child.key] = value;
  next[index] = item;
  setParameterFormValue(field, next);
}

function scalarCheckboxValue(value: unknown) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function setScalarCheckboxValue(setter: (value: unknown) => void, event: Event) {
  setter((event.target as HTMLInputElement).checked ? 'true' : 'false');
}

function fieldMeta(field: PluginParameterSchemaField) {
  const parts = [
    field.rawType ? `type: ${field.rawType}` : '',
    field.structName ? `struct: ${field.structName}` : '',
    field.directory ? `dir: ${field.directory}` : '',
    field.required ? 'required' : '',
    field.defaultValue !== undefined && field.defaultValue !== '' ? `default: ${String(field.defaultValue)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function formatSize(file: ManagedPluginFile) {
  if (file.size === null) return '未知';
  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

function issueClass(issue: PluginValidationIssue) {
  return issue.severity === 'error' ? 'error' : 'warn';
}
</script>

<template>
  <div class="console-subpage plugins-pane">
    <div v-if="!projectStore.currentProject" class="state">请先添加并选择 RPG Maker MV 项目。</div>
    <div v-else-if="loading" class="state">正在读取插件配置…</div>
    <div v-else class="plugins-layout">
      <aside class="plugin-list-panel">
        <div class="panel-title">
          <span>插件配置</span>
          <button type="button" title="刷新" :disabled="Boolean(busyKey)" @click="loadPlugins">
            <Refresh />
          </button>
        </div>
        <div class="summary">
          <div><strong>{{ plugins.length }}</strong><span>配置项</span></div>
          <div><strong>{{ enabledCount }}</strong><span>已启用</span></div>
          <div :class="{ bad: missingFileCount }"><strong>{{ missingFileCount }}</strong><span>缺文件</span></div>
        </div>
        <ConsoleSearchInput v-model="search" placeholder="搜索插件" />
        <div v-if="error" class="status error">{{ error }}</div>
        <div v-if="actionMessage" class="status success">{{ actionMessage }}</div>
        <div class="plugin-list">
          <button
            v-for="plugin in filteredPlugins"
            :key="`${plugin.index}:${plugin.name}`"
            type="button"
            class="plugin-row"
            :class="{ active: selectedPlugin?.index === plugin.index, disabled: !plugin.status, broken: plugin.name && !plugin.fileExists }"
            @click="selectPlugin(plugin)"
          >
            <span class="plugin-main">
              <strong>{{ plugin.name || `#${plugin.index + 1}` }}</strong>
              <small>{{ plugin.description || plugin.fileRelativePath || '无描述' }}</small>
            </span>
            <span class="plugin-badges">
              <b :class="plugin.status ? 'on' : 'off'">{{ plugin.status ? 'ON' : 'OFF' }}</b>
              <b :class="plugin.fileExists ? 'ok' : 'missing'">{{ plugin.fileExists ? 'JS' : 'MISS' }}</b>
            </span>
          </button>
          <div v-if="!filteredPlugins.length" class="empty">{{ plugins.length ? '没有匹配插件' : 'plugins.js 没有配置项' }}</div>
        </div>
      </aside>

      <main class="plugin-detail-panel">
        <div class="panel-title">
          <span>{{ selectedPlugin?.name || '插件详情' }}</span>
          <span v-if="config" class="path-chip">{{ config.relativePath }}</span>
        </div>
        <div v-if="!config" class="state error">插件配置读取失败。</div>
        <template v-else>
          <section class="validation-strip" :class="{ blocked: blockers.length, clean: !technicalIssueCount }">
            <strong>{{ validationStatusLabel }}</strong>
          </section>

          <details v-if="technicalIssueCount" class="technical-details">
            <summary>查看技术详情（{{ technicalIssueCount }} 条）</summary>
            <div class="technical-detail-body">
              <div v-if="issues.length" class="technical-detail-section">
                <strong>配置诊断</strong>
                <div class="issue-list">
                  <div v-for="issue in issues" :key="`${issue.code}:${issue.index ?? ''}:${issue.pluginName ?? ''}`" class="issue" :class="issueClass(issue)">
                    <strong>{{ issue.severity === 'error' ? '阻断' : '警告' }}</strong>
                    <span>{{ issue.message }}</span>
                  </div>
                </div>
              </div>
              <div v-if="schemaWarnings.length" class="technical-detail-section">
                <strong>当前插件参数解析</strong>
                <div class="schema-warnings">
                  <div v-for="warning in schemaWarnings" :key="warning">{{ warning }}</div>
                </div>
              </div>
            </div>
          </details>

          <section v-if="selectedPlugin" class="detail-card">
            <div class="plugin-toolbar">
              <button type="button" :disabled="Boolean(busyKey) || !selectedPlugin.name" @click="togglePlugin(selectedPlugin)">
                {{ selectedPlugin.status ? '禁用' : '启用' }}
              </button>
              <button type="button" title="上移" :disabled="!canMove(selectedPlugin, -1)" @click="movePlugin(selectedPlugin, -1)">
                <ArrowUp />
              </button>
              <button type="button" title="下移" :disabled="!canMove(selectedPlugin, 1)" @click="movePlugin(selectedPlugin, 1)">
                <ArrowDown />
              </button>
            </div>

            <dl class="facts">
              <dt>名称</dt><dd>{{ selectedPlugin.name || '未命名' }}</dd>
              <dt>顺序</dt><dd>#{{ selectedPlugin.index + 1 }}</dd>
              <dt>状态</dt><dd>{{ selectedPlugin.status ? '启用' : '禁用' }}</dd>
              <dt>文件</dt><dd :class="{ danger: !selectedPlugin.fileExists }">{{ selectedPlugin.fileExists ? selectedPlugin.fileRelativePath : `${selectedPlugin.fileName || '插件文件'} 缺失` }}</dd>
              <dt>参数</dt><dd>{{ selectedPlugin.parameterCount }} 项</dd>
            </dl>

            <div v-if="schemaFields.length" class="schema-params">
              <div v-for="field in schemaFields" :key="field.key" class="param-field" :class="{ full: isWideField(field) }">
                <span>
                  <strong>{{ field.label }}</strong>
                  <code>{{ field.key }}</code>
                </span>
                <input
                  v-if="field.kind === 'text'"
                  :value="parameterFormValue(field)"
                  @input="setParameterFormValue(field, parameterInputValue($event))"
                />
                <input
                  v-else-if="field.kind === 'number'"
                  :value="parameterFormValue(field)"
                  type="number"
                  :min="field.min"
                  :max="field.max"
                  @input="setParameterFormValue(field, parameterInputValue($event))"
                />
                <label v-else-if="field.kind === 'boolean'" class="param-check">
                  <input :checked="parameterCheckboxValue(field)" type="checkbox" @change="setParameterCheckboxValue(field, $event)" />
                  <span>{{ parameterCheckboxValue(field) ? 'true' : 'false' }}</span>
                </label>
                <select
                  v-else-if="field.kind === 'select'"
                  :value="String(parameterFormValue(field))"
                  @change="setParameterFormValue(field, parameterInputValue($event))"
                >
                  <option v-for="option in field.options || []" :key="String(option.value)" :value="String(option.value)">
                    {{ option.label }}
                  </option>
                </select>
                <textarea
                  v-else-if="field.kind === 'json'"
                  :value="String(parameterFormValue(field))"
                  rows="4"
                  spellcheck="false"
                  @input="setParameterFormValue(field, parameterInputValue($event))"
                />
                <div v-else-if="field.kind === 'struct'" class="struct-editor">
                  <label v-for="child in structFields(field)" :key="child.key" class="nested-field">
                    <span>
                      <strong>{{ child.label }}</strong>
                      <code>{{ child.key }}</code>
                    </span>
                    <input
                      v-if="child.kind === 'text'"
                      :value="structFieldValue(field, child)"
                      @input="setStructFieldValue(field, child, parameterInputValue($event))"
                    />
                    <input
                      v-else-if="child.kind === 'number'"
                      :value="structFieldValue(field, child)"
                      type="number"
                      :min="child.min"
                      :max="child.max"
                      @input="setStructFieldValue(field, child, parameterInputValue($event))"
                    />
                    <label v-else-if="child.kind === 'boolean'" class="param-check">
                      <input
                        :checked="scalarCheckboxValue(structFieldValue(field, child))"
                        type="checkbox"
                        @change="setScalarCheckboxValue((value) => setStructFieldValue(field, child, value), $event)"
                      />
                      <span>{{ scalarCheckboxValue(structFieldValue(field, child)) ? 'true' : 'false' }}</span>
                    </label>
                    <select
                      v-else-if="child.kind === 'select'"
                      :value="String(structFieldValue(field, child))"
                      @change="setStructFieldValue(field, child, parameterInputValue($event))"
                    >
                      <option v-for="option in child.options || []" :key="String(option.value)" :value="String(option.value)">
                        {{ option.label }}
                      </option>
                    </select>
                    <textarea
                      v-else
                      :value="JSON.stringify(structFieldValue(field, child), null, 2)"
                      rows="3"
                      spellcheck="false"
                      @input="setStructFieldValue(field, child, parameterInputValue($event))"
                    />
                    <small v-if="child.description || fieldMeta(child)">
                      {{ [child.description, fieldMeta(child)].filter(Boolean).join(' · ') }}
                    </small>
                  </label>
                </div>
                <div v-else-if="field.kind === 'array'" class="array-editor">
                  <div v-for="(_, index) in arrayItems(field)" :key="`${field.key}:${index}`" class="array-row">
                    <div class="array-row-head">
                      <strong>#{{ index + 1 }}</strong>
                      <button type="button" @click="removeArrayItem(field, index)">删除</button>
                    </div>
                    <div v-if="field.item?.kind === 'struct'" class="struct-editor">
                      <label v-for="child in field.item.fields || []" :key="child.key" class="nested-field">
                        <span>
                          <strong>{{ child.label }}</strong>
                          <code>{{ child.key }}</code>
                        </span>
                        <input
                          v-if="child.kind === 'text'"
                          :value="arrayStructFieldValue(field, index, child)"
                          @input="setArrayStructFieldValue(field, index, child, parameterInputValue($event))"
                        />
                        <input
                          v-else-if="child.kind === 'number'"
                          :value="arrayStructFieldValue(field, index, child)"
                          type="number"
                          :min="child.min"
                          :max="child.max"
                          @input="setArrayStructFieldValue(field, index, child, parameterInputValue($event))"
                        />
                        <label v-else-if="child.kind === 'boolean'" class="param-check">
                          <input
                            :checked="scalarCheckboxValue(arrayStructFieldValue(field, index, child))"
                            type="checkbox"
                            @change="setScalarCheckboxValue((value) => setArrayStructFieldValue(field, index, child, value), $event)"
                          />
                          <span>{{ scalarCheckboxValue(arrayStructFieldValue(field, index, child)) ? 'true' : 'false' }}</span>
                        </label>
                        <select
                          v-else-if="child.kind === 'select'"
                          :value="String(arrayStructFieldValue(field, index, child))"
                          @change="setArrayStructFieldValue(field, index, child, parameterInputValue($event))"
                        >
                          <option v-for="option in child.options || []" :key="String(option.value)" :value="String(option.value)">
                            {{ option.label }}
                          </option>
                        </select>
                        <textarea
                          v-else
                          :value="JSON.stringify(arrayStructFieldValue(field, index, child), null, 2)"
                          rows="3"
                          spellcheck="false"
                          @input="setArrayStructFieldValue(field, index, child, parameterInputValue($event))"
                        />
                      </label>
                    </div>
                    <template v-else-if="field.item">
                      <input
                        v-if="field.item.kind === 'text'"
                        :value="arrayScalarValue(field, index)"
                        @input="setArrayScalarValue(field, index, parameterInputValue($event))"
                      />
                      <input
                        v-else-if="field.item.kind === 'number'"
                        :value="arrayScalarValue(field, index)"
                        type="number"
                        :min="field.item.min"
                        :max="field.item.max"
                        @input="setArrayScalarValue(field, index, parameterInputValue($event))"
                      />
                      <label v-else-if="field.item.kind === 'boolean'" class="param-check">
                        <input
                          :checked="scalarCheckboxValue(arrayScalarValue(field, index))"
                          type="checkbox"
                          @change="setScalarCheckboxValue((value) => setArrayScalarValue(field, index, value), $event)"
                        />
                        <span>{{ scalarCheckboxValue(arrayScalarValue(field, index)) ? 'true' : 'false' }}</span>
                      </label>
                      <select
                        v-else-if="field.item.kind === 'select'"
                        :value="String(arrayScalarValue(field, index))"
                        @change="setArrayScalarValue(field, index, parameterInputValue($event))"
                      >
                        <option v-for="option in field.item.options || []" :key="String(option.value)" :value="String(option.value)">
                          {{ option.label }}
                        </option>
                      </select>
                      <textarea
                        v-else
                        :value="JSON.stringify(arrayScalarValue(field, index), null, 2)"
                        rows="3"
                        spellcheck="false"
                        @input="setArrayScalarValue(field, index, parameterInputValue($event))"
                      />
                    </template>
                  </div>
                  <button type="button" class="array-add" @click="addArrayItem(field)">添加条目</button>
                  <small v-if="!arrayItems(field).length">数组为空</small>
                </div>
                <small v-if="field.description || fieldMeta(field)">
                  {{ [field.description, fieldMeta(field)].filter(Boolean).join(' · ') }}
                </small>
              </div>
            </div>

            <label class="params-editor">
              <span><EditPen /> {{ schemaFields.length ? '未识别参数 JSON' : 'parameters JSON' }}</span>
              <textarea v-model="parametersText" spellcheck="false" @keydown.ctrl.enter.prevent="saveParameters" />
            </label>
            <div v-if="parametersError" class="status error">{{ parametersError }}</div>
            <button type="button" class="primary" :disabled="Boolean(busyKey) || !parametersDirty" @click="saveParameters">
              {{ busyKey === `params:${selectedPlugin.name}` ? '保存中…' : '保存参数' }}
            </button>
          </section>
          <div v-else class="empty">选择一个插件编辑配置</div>
        </template>
      </main>

      <aside class="plugin-files-panel">
        <div class="panel-title">插件文件</div>
        <div class="file-list">
          <div v-for="file in pluginFiles" :key="file.relativePath" class="file-row" :class="{ staged: file.staged, deleted: file.deleted }">
            <strong>{{ file.fileName }}</strong>
            <small>{{ file.relativePath }}</small>
            <span>
              {{ file.deleted ? '待删除' : file.staged ? '暂存' : file.exists ? formatSize(file) : '缺失' }}
            </span>
          </div>
          <div v-if="!pluginFiles.length" class="empty">没有发现插件 JS 文件</div>
        </div>
        <div v-if="orphanFiles.length" class="orphan-block">
          <strong>未配置文件</strong>
          <span v-for="file in orphanFiles" :key="file.relativePath">{{ file.fileName }}</span>
        </div>
        <div class="file-note">本页暂不暴露本地文件安装和删除；没有安全文件选择入口前，不给用户假按钮。</div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.plugins-pane { height: 100%; min-height: 0; background: var(--console-page,#f4efe7); color: var(--console-text,#211d17); }
.plugins-layout { height: 100%; min-height: 0; display: grid; grid-template-columns: 280px minmax(360px,1fr) 280px; gap: 22px; padding: 14px 40px 34px; }
.plugin-list-panel,.plugin-detail-panel,.plugin-files-panel { min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--console-border,#e4dcce); border-radius: 14px; background: var(--console-paper,#fffdfa); }
.panel-title { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--console-border,#e4dcce); color: var(--console-text-soft,#5a5247); font-size: 12px; font-weight: 650; }
.panel-title button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--console-text-muted,#9a8e7e); cursor: pointer; }
.panel-title button:hover:not(:disabled) { background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); }
.panel-title button:disabled,button:disabled { cursor: not-allowed; opacity: .45; }
.panel-title svg,.plugin-toolbar svg,.params-editor svg { width: 15px; }
.path-chip { min-width: 0; overflow: hidden; color: var(--console-text-muted,#9a8e7e); font-family: var(--app-font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; padding: 10px; border-bottom: 1px solid var(--console-border,#e4dcce); background: var(--console-paper-soft,#faf5ec); }
.summary div { display: grid; gap: 2px; padding: 8px; border-radius: 9px; background: var(--console-paper,#fffdfa); }
.summary strong { font-size: 18px; line-height: 1; }
.summary span { color: var(--console-text-muted,#9a8e7e); font-size: 10px; }
.summary .bad strong { color: var(--app-danger); }
.plugin-list-panel :deep(.console-search) { margin: 10px; }
.plugin-list,.file-list { min-height: 0; flex: 1; overflow: auto; padding: 8px; }
.plugin-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; border: 0; border-radius: 10px; background: transparent; color: var(--console-text,#211d17); font: inherit; text-align: left; cursor: pointer; }
.plugin-row:hover,.plugin-row.active { background: #fbf1e9; }
.plugin-row.active { box-shadow: inset 3px 0 var(--console-accent,#be5630); }
.plugin-row.disabled { color: var(--console-text-muted,#9a8e7e); }
.plugin-row.broken .plugin-main strong { color: var(--app-danger); }
.plugin-main { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.plugin-main strong,.file-row strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.plugin-main small,.file-row small { overflow: hidden; color: var(--console-text-muted,#9a8e7e); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.plugin-badges { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.plugin-badges b { min-width: 38px; padding: 2px 6px; border-radius: 999px; font-family: var(--app-font-mono); font-size: 9px; font-weight: 800; text-align: center; }
.plugin-badges .on,.plugin-badges .ok { background: var(--app-ok-soft); color: var(--app-ok); }
.plugin-badges .off { background: var(--console-paper-soft,#faf5ec); color: var(--console-text-muted,#9a8e7e); }
.plugin-badges .missing { background: var(--app-danger-soft); color: var(--app-danger); }
.plugin-detail-panel { overflow: auto; }
.validation-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px; padding: 11px 12px; border-radius: 11px; background: var(--app-warn-soft); color: var(--app-warn); font-size: 12px; }
.validation-strip.blocked { background: var(--app-danger-soft); color: var(--app-danger); }
.validation-strip.clean { background: var(--app-ok-soft); color: var(--app-ok); }
.technical-details { margin: 0 12px 12px; border: 1px solid var(--console-border,#e4dcce); border-radius: 10px; background: var(--console-paper-soft,#faf5ec); color: var(--console-text-soft,#5a5247); font-size: 11px; }
.technical-details summary { cursor: pointer; padding: 9px 10px; color: var(--console-text-muted,#9a8e7e); font-weight: 650; }
.technical-details summary:hover { color: var(--console-accent,#be5630); }
.technical-detail-body { display: grid; gap: 10px; padding: 0 10px 10px; }
.technical-detail-section { display: grid; gap: 6px; }
.technical-detail-section > strong { color: var(--console-text-soft,#5a5247); font-size: 11px; }
.issue-list { display: grid; gap: 6px; margin: 0 12px 12px; }
.technical-details .issue-list { margin: 0; }
.issue { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 9px; font-size: 11px; line-height: 1.45; }
.issue.error,.status.error { background: var(--app-danger-soft); color: var(--app-danger); }
.issue.warn { background: var(--app-warn-soft); color: var(--app-warn); }
.detail-card { display: grid; gap: 12px; padding: 12px; }
.plugin-toolbar { display: flex; gap: 7px; align-items: center; }
.plugin-toolbar button,.primary { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 9px; background: var(--console-paper,#fffdfa); color: var(--console-text-soft,#5a5247); padding: 0 11px; font: inherit; font-size: 11px; cursor: pointer; }
.plugin-toolbar button:hover:not(:disabled) { border-color: #d2a88c; color: var(--console-accent,#be5630); }
.facts { display: grid; grid-template-columns: 66px minmax(0,1fr); gap: 8px 10px; margin: 0; padding: 12px; border-radius: 10px; background: var(--console-paper-soft,#faf5ec); font-size: 11px; }
.facts dt { color: var(--console-text-muted,#9a8e7e); }
.facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.facts .danger { color: var(--app-danger); }
.status { padding: 8px 10px; border-radius: 9px; font-size: 11px; white-space: pre-wrap; }
.status { margin: 0 10px 10px; }
.status.success { background: var(--app-ok-soft); color: var(--app-ok); }
.schema-warnings { display: grid; gap: 5px; padding: 9px 10px; border-radius: 10px; background: var(--app-warn-soft); color: var(--app-warn); font-size: 11px; line-height: 1.45; }
.schema-params { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; padding: 12px; border: 1px solid var(--console-border,#e4dcce); border-radius: 10px; background: var(--console-paper-soft,#faf5ec); }
.param-field { min-width: 0; display: grid; gap: 5px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.param-field.full { grid-column: 1 / -1; }
.param-field > span,.nested-field > span { min-width: 0; display: flex; align-items: center; gap: 6px; }
.schema-params strong { overflow: hidden; color: var(--console-text-soft,#5a5247); text-overflow: ellipsis; white-space: nowrap; }
.schema-params code { min-width: 0; overflow: hidden; color: var(--console-text-muted,#9a8e7e); font-family: var(--app-font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.schema-params input:not([type="checkbox"]),.schema-params select,.schema-params textarea { min-width: 0; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 8px; background: var(--console-paper,#fffdfa); color: var(--console-text,#211d17); padding: 7px 8px; font: inherit; }
.schema-params textarea { font-family: var(--app-font-mono); resize: vertical; }
.schema-params small { color: var(--console-text-muted,#9a8e7e); font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
.param-check { min-height: 31px; display: inline-flex!important; align-items: center; gap: 7px; }
.param-check span { color: var(--console-text-soft,#5a5247); font-family: var(--app-font-mono); font-size: 10px; }
.struct-editor { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; padding: 9px; border: 1px solid var(--console-border,#e4dcce); border-radius: 9px; background: var(--console-paper,#fffdfa); }
.nested-field { min-width: 0; display: grid; gap: 5px; }
.array-editor { display: grid; gap: 8px; }
.array-row { display: grid; gap: 8px; padding: 9px; border: 1px solid var(--console-border,#e4dcce); border-radius: 9px; background: var(--console-paper,#fffdfa); }
.array-row-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.array-row-head strong { font-family: var(--app-font-mono); font-size: 10px; }
.array-row-head button,.array-add { min-height: 28px; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 8px; background: var(--console-paper-soft,#faf5ec); color: var(--console-text-soft,#5a5247); padding: 0 9px; font: inherit; font-size: 10px; cursor: pointer; }
.array-row-head button:hover,.array-add:hover { border-color: #d2a88c; color: var(--console-accent,#be5630); }
.array-add { width: fit-content; }
.params-editor { display: grid; gap: 7px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.params-editor span { display: inline-flex; align-items: center; gap: 5px; color: var(--console-text-soft,#5a5247); font-weight: 650; }
.params-editor textarea { min-height: 260px; resize: vertical; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 10px; background: var(--console-paper-soft,#faf5ec); color: var(--console-text,#211d17); padding: 11px; font: 11px/1.55 var(--app-font-mono); }
.schema-params input:focus,.schema-params select:focus,.schema-params textarea:focus,.params-editor textarea:focus,.plugin-row:focus-visible,.plugin-toolbar button:focus-visible,.primary:focus-visible,.panel-title button:focus-visible { outline: none; box-shadow: var(--app-ring); }
.primary { width: fit-content; border-color: var(--console-accent,#be5630); background: var(--console-accent,#be5630); color: white; font-weight: 750; }
.primary:hover:not(:disabled) { background: var(--console-accent-hover,#a8481f); }
.file-row { display: grid; gap: 3px; padding: 9px 10px; border-radius: 10px; }
.file-row:hover { background: #fbf1e9; }
.file-row span { color: var(--console-text-muted,#9a8e7e); font-size: 10px; }
.file-row.staged span { color: var(--console-accent,#be5630); }
.file-row.deleted strong,.file-row.deleted span { color: var(--app-danger); }
.orphan-block { display: grid; gap: 5px; margin: 0 10px 10px; padding: 10px; border-radius: 10px; background: var(--console-paper-soft,#faf5ec); font-size: 11px; }
.orphan-block strong { color: var(--console-text-soft,#5a5247); }
.orphan-block span { color: var(--console-text-muted,#9a8e7e); font-family: var(--app-font-mono); font-size: 10px; }
.file-note { margin: 0 10px 10px; padding: 10px; border-radius: 10px; background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); font-size: 11px; line-height: 1.5; }
.empty,.state { display: grid; place-items: center; min-height: 110px; padding: 20px; color: var(--console-text-muted,#9a8e7e); font-size: 12px; text-align: center; }
.state { height: 100%; }
.state.error { color: var(--app-danger); }
@media(max-width:1180px){.plugins-layout{grid-template-columns:240px minmax(320px,1fr);}.plugin-files-panel{grid-column:1 / -1;min-height:220px;}}
@media(max-width:760px){.plugins-layout{grid-template-columns:1fr;padding:14px 24px 28px;}.plugin-list-panel,.plugin-detail-panel,.plugin-files-panel{min-height:260px;}.validation-strip{align-items:flex-start;flex-direction:column;}}
</style>
