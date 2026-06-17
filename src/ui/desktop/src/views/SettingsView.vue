<template>
  <div class="settings-view">
    <div class="settings-body">
      <div v-if="store.loading" class="settings-loading-bar">正在读取设置…</div>
      <div v-if="store.lastError" class="settings-error-bar">
        <span class="alert-icon">!</span> {{ store.lastError }}
      </div>

      <div class="console-split settings-split">
        <aside class="console-panel settings-nav">
          <div class="console-panel-scroll">
            <button v-for="tab in tabList" :key="tab.name" type="button" class="folder" :class="{ active: activeName === tab.name }" @click="activeName = tab.name">{{ tab.label }}</button>
          </div>
        </aside>

        <main class="console-panel settings-content">
          <div class="console-panel-scroll">

            <!-- TAB: model-engine -->
            <section v-if="activeName === 'model-engine'" class="settings-tab-content">
              <h3>模型</h3>
              <div class="provider-actions">
                <button class="workbench-button" @click="onManageProviders">管理供应商</button>
              </div>

              <div v-if="importPresetsMessage" class="alert" :class="importPresetsError ? 'alert-error' : 'alert-success'">
                <span class="alert-icon">{{ importPresetsError ? '!' : '&#10003;' }}</span>
                <span class="alert-body">{{ importPresetsMessage }}</span>
                <button class="alert-close" @click="importPresetsMessage = null">&times;</button>
              </div>

              <div class="engine-status-bar" role="status">
                <div class="current-model-title">当前使用</div>
                <div class="status-row"><span class="status-label">Provider</span><span class="status-value">{{ activeProviderLabel }}</span></div>
                <div class="status-row"><span class="status-label">模型</span><span class="status-value mono">{{ activeModelLabel }}</span></div>
                <div class="status-row"><span class="status-label">Key</span><span class="status-value" :class="activeKeyOk ? 'status-ok' : 'status-warn'">{{ activeKeyOk ? '已配置' : '未配置' }}</span></div>
                <div class="status-row status-row--full"><span class="status-label">同步</span><span class="status-value">{{ lastSyncLabel }}</span></div>
              </div>

              <div v-if="invalidBindingWarning" class="alert alert-warn"><span class="alert-icon">!</span> {{ invalidBindingWarning }}</div>

              <div v-if="showOpencodeProviderEmptyAlert" class="alert alert-warn opencode-provider-alert">
                <span class="alert-icon">!</span>
                <div>
                  <strong>尚无 API 供应商</strong>
                  <p class="opencode-alert-body">先同步内置供应商，填写 API Key 后设为默认；换模型在聊天框旁操作。</p>
                  <button class="workbench-button primary" :disabled="importPresetsLoading" @click="onSyncProviderSeeds">{{ importPresetsLoading ? '同步中…' : '同步供应商' }}</button>
                </div>
              </div>

              <div class="provider-list-header">
                <h4 class="provider-list-title">API</h4>
                <button class="workbench-button primary add-api-btn" title="添加 API" @click="openAddProviderDialog">+ 添加</button>
              </div>

              <div v-if="displayedProviders.length" class="provider-card-list">
                <article v-for="p in displayedProviders" :key="p.id" class="provider-card" :class="{ 'is-active': isProviderActive(p.id), 'is-expanded': expandedProviderId === p.id }" @click="onProviderCardClick(p)">
                  <header class="provider-card-header">
                    <div class="provider-card-title">
                      <strong>{{ providerDisplayName(p) }}</strong>
                      <span class="provider-card-id mono">{{ p.id }}</span>
                    </div>
                    <div class="provider-card-badges">
                      <span v-if="!p.credentialPresent" class="pill pill-warn pill-sm">待配置 Key</span>
                      <span v-if="isProviderActive(p.id)" class="pill pill-primary pill-sm">默认</span>
                    </div>
                  </header>
                  <div class="provider-card-meta">
                    <div class="meta-row"><span class="meta-label">模型</span><span class="meta-value mono">{{ cardModelLabel(p) }}</span></div>
                  </div>
                  <footer class="provider-card-footer" @click.stop>
                    <button class="workbench-button primary" :disabled="activatingProviderId === p.id" @click="onActivateProvider(p)">{{ activatingProviderId === p.id ? '设置中…' : '设为默认' }}</button>
                    <button class="workbench-button" :disabled="testingProviderId === p.id" @click="onTestProviderCard(p)">{{ testingProviderId === p.id ? '测试中…' : '测试' }}</button>
                    <button class="workbench-link" @click="toggleProviderExpand(p.id)">{{ expandedProviderId === p.id ? '收起' : '编辑' }}</button>
                    <button class="workbench-link danger" :disabled="deletingProviderId === p.id" @click="onDeleteProviderCard(p)">{{ deletingProviderId === p.id ? '删除中…' : '删除' }}</button>
                  </footer>
                  <div v-if="expandedProviderId === p.id" class="provider-card-body" @click.stop>
                    <div class="provider-inline-form">
                      <div class="form-group">
                        <label class="form-label">API Key</label>
                        <input
                          v-model="inlineCredentialValue"
                          type="password"
                          class="settings-input"
                          :placeholder="inlineApiKeyPlaceholder"
                          @blur="onInlineProviderConfigBlur"
                          @keydown.enter.prevent="onInlineProviderConfigBlur"
                        />
                        <div class="form-hint">{{ inlineApiKeyHint }}</div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">Base URL</label>
                        <input
                          v-model="inlineBaseUrl"
                          class="settings-input"
                          placeholder="https://api.example.com/v1"
                          @blur="onInlineProviderConfigBlur"
                          @keydown.enter.prevent="onInlineProviderConfigBlur"
                        />
                        <div class="form-hint">可选；填入后点击其他地方会自动保存</div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">默认模型</label>
                        <div class="model-field-row">
                          <ModelPicker
                            variant="field"
                            class="model-field-select"
                            :providers="bindingProviderPickerOptions"
                            :single-provider-id="p.id"
                            :selected-provider="bindingProviderId"
                            :selected-model="bindingModelId"
                            placeholder="选择默认模型"
                            empty-configured-hint="请先拉取模型"
                            @select="onBindingModelSelect"
                          />
                          <button class="workbench-button" :disabled="fetchingModelsId === p.id || !canFetchModelsForCard(p)" @click="onFetchModelsForProvider(p)">{{ fetchingModelsId === p.id ? '拉取中…' : '拉取模型' }}</button>
                        </div>
                        <div v-if="fetchModelsMessage && expandedProviderId === p.id" class="form-hint" :class="fetchModelsOk ? 'fetch-ok' : 'fetch-err'">{{ fetchModelsMessage }}</div>
                        <div class="form-hint">填写 API Key 后可拉取模型；设为默认后聊天页会自动使用。</div>
                      </div>
                      <div class="form-group model-visibility">
                        <div class="model-visibility-header">
                          <div>
                            <label class="form-label">模型显示</label>
                            <div class="form-hint">{{ visibleModelCount(p) }} / {{ p.models?.length || 0 }} 个模型可选</div>
                          </div>
                          <div class="model-visibility-actions">
                            <button class="workbench-link" :disabled="visibilitySavingProviderId === p.id" @click="onShowAllModels(p)">全部显示</button>
                            <button class="workbench-link" :disabled="visibilitySavingProviderId === p.id" @click="onHideAllModels(p)">全部隐藏</button>
                          </div>
                        </div>
                        <input v-model="modelVisibilitySearch" class="settings-input model-visibility-search" placeholder="搜索模型" />
                        <div v-if="filteredVisibilityModels(p).length" class="model-visibility-list">
                          <label v-for="model in filteredVisibilityModels(p)" :key="model.id" class="model-visibility-row">
                            <span class="model-visibility-copy">
                              <span class="model-visibility-name">{{ model.label || model.id }}</span>
                              <span v-if="model.label && model.label !== model.id" class="model-visibility-id mono">{{ model.id }}</span>
                            </span>
                            <span class="toggle" :class="{ 'is-loading': visibilitySavingProviderId === p.id }">
                              <input type="checkbox" :checked="isModelVisible(p, model.id)" :disabled="visibilitySavingProviderId === p.id" @change="onToggleModelVisibility(p, model.id, ($event.target as HTMLInputElement).checked)" />
                              <span class="toggle-track"><span class="toggle-thumb" /></span>
                            </span>
                          </label>
                        </div>
                        <div v-else class="model-visibility-empty">{{ p.models?.length ? '无匹配模型' : '尚未拉取模型' }}</div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
              <div v-else-if="!showOpencodeProviderEmptyAlert" class="configured-empty">
                <div class="empty-state"><p>尚未配置 API，点击下方按钮添加</p><button class="workbench-button primary" @click="openAddProviderDialog">+ 添加 API</button></div>
              </div>

              <Teleport to="body">
                <div v-if="showAddProviderDialog" class="settings-overlay" @click.self="closeAddDialog">
                  <div class="settings-dialog">
                    <div class="dialog-header"><h4>添加 API</h4><button class="dialog-close-btn" @click="closeAddDialog">&times;</button></div>
                    <div class="dialog-body">
                      <input v-model="addProviderSearch" class="settings-input" placeholder="搜索名称、ID 或 Base URL…" />
                      <div v-if="filteredAvailableToAdd.length" class="add-provider-list">
                        <button v-for="p in filteredAvailableToAdd" :key="p.id" type="button" class="add-provider-item" @click="onPickProviderToAdd(p)">
                          <span class="add-provider-name">{{ providerDisplayName(p) }}</span>
                          <span class="add-provider-id mono">{{ p.id }}</span>
                          <span v-if="p.baseUrl" class="add-provider-url" :title="p.baseUrl">{{ p.baseUrl }}</span>
                        </button>
                      </div>
                      <div v-else class="empty-state">{{ availableToAddProviders.length ? '无匹配结果' : '暂无可添加的供应商，请先同步供应商' }}</div>
                    </div>
                    <div class="dialog-footer">
                      <button class="workbench-button" :disabled="importPresetsLoading" @click="onImportFromAddDialog">{{ importPresetsLoading ? '同步中…' : '同步供应商' }}</button>
                      <button class="workbench-button" @click="onCustomProviderFromAddDialog">自定义供应商</button>
                    </div>
                  </div>
                </div>
              </Teleport>

              <details class="settings-collapse model-roles-collapse">
                <summary class="collapse-summary">辅助模型</summary>
                <div class="collapse-body">
                  <p class="form-hint">权限分类、标题生成和记忆选择会用到额外的小模型；如果你的 API 不提供默认模型，可以在这里指定替代模型。留空则使用默认配置。保存后下次会话生效。</p>
                  <div class="provider-inline-form">
                    <div class="form-group">
                      <label class="form-label">轻量模型</label>
                      <ModelPicker
                        variant="field"
                        allow-empty
                        empty-label="留空使用默认配置"
                        :providers="settingsModelPickerOptions"
                        :selected-provider="modelRoleLightProviderId"
                        :selected-model="modelRoleLightModelId"
                        empty-configured-hint="请先在上方配置 API 并拉取模型"
                        @select="onModelRoleLightSelect"
                        @clear="onModelRoleLightClear"
                      />
                      <div v-if="isModelRoleHidden(modelRoleLightModelId, modelRoleLightProviderId)" class="form-hint fetch-err">当前模型已隐藏；现有绑定保留，但不会再出现在可选列表中。</div>
                      <div class="form-hint">用于权限分类、标题生成等辅助任务。</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">选择器模型（记忆选择）</label>
                      <ModelPicker
                        variant="field"
                        allow-empty
                        empty-label="留空使用默认配置"
                        :providers="settingsModelPickerOptions"
                        :selected-provider="modelRoleSelectorProviderId"
                        :selected-model="modelRoleSelectorModelId"
                        empty-configured-hint="请先在上方配置 API 并拉取模型"
                        @select="onModelRoleSelectorSelect"
                        @clear="onModelRoleSelectorClear"
                      />
                      <div v-if="isModelRoleHidden(modelRoleSelectorModelId, modelRoleSelectorProviderId)" class="form-hint fetch-err">当前模型已隐藏；现有绑定保留，但不会再出现在可选列表中。</div>
                      <div class="form-hint">用于记忆文件相关性选择。</div>
                    </div>
                  </div>
                </div>
              </details>

              <details class="settings-collapse memory-settings-collapse" open>
                <summary class="collapse-summary">Agent 记忆系统</summary>
                <div class="collapse-body">
                  <p class="form-hint">控制 Agent 记忆模块的行为。记忆系统会在每轮对话后自动提取关键信息，并在后续会话中注入上下文，提升 Agent 的连续性。保存后下次会话生效。</p>
                  <div class="memory-toggle-form">
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryAutoEnabled" />
                      <span class="toggle-label">后台记忆提取</span>
                      <span class="form-hint">每轮对话结束后，自动用轻量模型提取关键信息写入记忆文件。</span>
                    </label>
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryDreamEnabled" />
                      <span class="toggle-label">自动记忆整合</span>
                      <span class="form-hint">定期将碎片记忆合并为结构化摘要，减少上下文膨胀。</span>
                    </label>
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryPoorMode" />
                      <span class="toggle-label">节省模式</span>
                      <span class="form-hint">使用更轻量的模型执行记忆操作（提取、整合），降低 API 成本。</span>
                    </label>
                  </div>
                </div>
              </details>

              <div class="model-engine-footer">
                <div class="footer-actions">
                  <button class="workbench-button primary" :disabled="store.loading" @click="onSaveModelEngine">{{ store.loading ? '保存中…' : '保存并同步' }}</button>
                </div>
                <div v-if="syncStatus" class="alert alert-info"><span class="alert-icon">i</span> {{ syncStatus }}</div>
              </div>
            </section>

            <!-- TAB: providers -->
            <section v-if="activeName === 'providers'" class="settings-tab-content">
              <h3>API</h3>
              <p class="desc">管理本地保存的模型供应商。</p>
              <div class="provider-actions">
                <button class="workbench-button primary" @click="onAddProviderClick">+ 添加供应商</button>
                <button class="workbench-button" :disabled="importPresetsLoading" @click="onSyncProviderSeeds">{{ importPresetsLoading ? '同步中…' : '同步供应商' }}</button>
              </div>
              <div v-if="store.providers.length" class="table-wrap">
                <table class="settings-table">
                  <thead><tr><th>ID</th><th>名称</th><th>Base URL</th><th>默认模型</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="row in store.providers" :key="row.id">
                      <td class="mono">{{ row.id }}</td><td>{{ providerDisplayName(row) }}</td><td class="mono td-ellipsis" :title="row.baseUrl">{{ row.baseUrl }}</td><td class="mono">{{ row.defaultModel }}</td>
                      <td><span class="pill pill-sm" :class="row.credentialPresent ? 'pill-ok' : 'pill-warn'">{{ row.credentialPresent ? '已配置' : '无 Key' }}</span></td>
                      <td class="td-actions"><button class="workbench-link" @click="onEditProvider(row)">编辑</button><button class="workbench-link" @click="onTestProvider(row)">测试</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state">尚未配置供应商</div>
            </section>

            <!-- TAB: ui -->
            <section v-if="activeName === 'ui'" class="settings-tab-content">
              <h3>界面</h3>
              <div class="settings-form">
                <div class="form-group"><label class="form-label">主题</label><select v-model="uiForm.theme" class="settings-select" style="width:240px"><option value="auto">跟随系统</option><option value="rpgmv">RPGMV 经典</option><option value="saas">浅色极简</option></select></div>
                <div class="form-group"><label class="form-label">聊天字号</label><div class="number-input"><button class="workbench-button num-btn" @click="uiForm.fontSize = Math.max(11, uiForm.fontSize - 1)">-</button><input type="number" v-model.number="uiForm.fontSize" min="11" max="22" class="settings-input num-input-field" /><button class="workbench-button num-btn" @click="uiForm.fontSize = Math.min(22, uiForm.fontSize + 1)">+</button></div></div>
                <div class="form-group"><label class="form-label">聊天面板宽度</label><div class="number-input"><button class="workbench-button num-btn" @click="uiForm.chatWidth = Math.max(320, uiForm.chatWidth - 10)">-</button><input type="number" v-model.number="uiForm.chatWidth" min="320" max="960" step="10" class="settings-input num-input-field" /><button class="workbench-button num-btn" @click="uiForm.chatWidth = Math.min(960, uiForm.chatWidth + 10)">+</button></div></div>
                <div class="form-group"><button class="workbench-button primary" :disabled="store.loading" @click="onSaveUi">{{ store.loading ? '保存中…' : '保存界面设置' }}</button></div>
              </div>
            </section>

            <!-- TAB: tools-mcp -->
            <section v-if="activeName === 'tools-mcp'" class="settings-tab-content"><SettingsToolsMcpTab :engine="agentExecForm.engine" /></section>

            <!-- TAB: rules-skills -->
            <section v-if="activeName === 'rules-skills'" class="settings-tab-content"><SettingsRulesSkillsTab /></section>

            <!-- TAB: permissions (hidden until PERMISSIONS_SETTINGS_TAB_ENABLED) -->
            <section v-if="PERMISSIONS_SETTINGS_TAB_ENABLED && activeName === 'permissions'" class="settings-tab-content">
              <h3>权限与决策</h3>
              <p class="desc">控制 Agent 什么时候暂停并等待人工决策。</p>
              <div class="settings-form">
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnWrite" /> 写文件或代码前暂停</label>
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnBash" /> 执行命令前暂停</label>
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnNetwork" /> 联网前暂停</label>
                <div class="form-group"><label class="form-label">连续自动允许上限</label><div class="number-input"><button class="workbench-button num-btn" @click="permForm.autoApproveLimit = Math.max(0, permForm.autoApproveLimit - 1)">-</button><input type="number" v-model.number="permForm.autoApproveLimit" min="0" max="100" class="settings-input num-input-field" /><button class="workbench-button num-btn" @click="permForm.autoApproveLimit = Math.min(100, permForm.autoApproveLimit + 1)">+</button></div></div>
                <div class="form-group"><button class="workbench-button primary" :disabled="store.loading" @click="onSavePermissions">{{ store.loading ? '保存中…' : '保存权限设置' }}</button></div>
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>

    <Teleport to="body"><div class="toast-stack"><TransitionGroup name="toast"><div v-for="t in toasts" :key="t.id" class="toast-item" :class="'toast-' + t.type">{{ t.message }}</div></TransitionGroup></div></Teleport>

    <ProviderForm v-model="showProviderForm" :provider="selectedProvider" @saved="onProviderSaved" @deleted="onProviderDeleted" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import {
  settings as settingsApi,
  type AgentExecutionEngineId,
  type AgentExecutionSettings,
  type ProviderSummary,
} from '../api/client'
import ProviderForm from '../components/ProviderForm.vue'
import ModelPicker from '../components/model-picker/ModelPicker.vue'
import SettingsToolsMcpTab from '../components/settings/SettingsToolsMcpTab.vue'
import SettingsRulesSkillsTab from '../components/settings/SettingsRulesSkillsTab.vue'
import { DEFAULT_AGENT_EXECUTION_ENGINE } from '@contract/types'
import { configuredCompatibleProviders, buildConfiguredModelPickerOptions } from '../utils/chatProviderOptions'
import {
  hiddenProviderModelCount,
  hiddenModelIdsAfterToggle,
  hiddenModelIdsForAllModels,
  isRawModelVisible,
  normalizedHiddenModelIds,
  visibleProviderModels,
} from '../utils/modelVisibility'
import { resolveInlineBaseUrl, syncInlineFormDraft } from '../utils/provider-inline-form'
import { applyUiTheme } from '../utils/applyUiTheme'
import {
  formatModelDisplayLabel,
  normalizeModelOptions,
  sanitizeModelIdForProvider,
} from '../utils/model-options'
import { formatProviderDisplayName } from '../utils/provider-display-name'

type ToastType = 'success' | 'error' | 'warn' | 'info'
const toasts = ref<Array<{ id: number; type: ToastType; message: string }>>([])
let _toastId = 0
function toast(type: ToastType, message: string) {
  const id = ++_toastId
  toasts.value.push({ id, type, message })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
}

/** 权限面板暂隐藏：设置项未接入 Agent 运行时。恢复时改为 true，并确保引擎读取 permissions 配置。 */
const PERMISSIONS_SETTINGS_TAB_ENABLED = false

const store = useSettingsStore()
const route = useRoute()
const activeName = ref('model-engine')
const SETTINGS_TABS = new Set([
  'model-engine',
  'providers',
  'ui',
  ...(PERMISSIONS_SETTINGS_TAB_ENABLED ? (['permissions'] as const) : []),
  'tools-mcp',
  'rules-skills',
])
const tabList = [
  { name: 'model-engine', label: '模型' },
  { name: 'providers', label: 'API' },
  { name: 'ui', label: '界面' },
  { name: 'tools-mcp', label: '工具与 MCP' },
  { name: 'rules-skills', label: '规则与技能' },
  ...(PERMISSIONS_SETTINGS_TAB_ENABLED ? [{ name: 'permissions' as const, label: '权限' }] : []),
]

const compatibleProviders = ref<ProviderSummary[]>([])
const bindingProviderId = ref('')
const bindingModelId = ref('')
const inlineCredentialValue = ref('')
const inlineBaseUrl = ref('')
const syncStatus = ref<string | null>(null)
const inlineAutoSavingProviderId = ref('')
const showProviderForm = ref(false)
const selectedProvider = ref<ProviderSummary | null>(null)
const importPresetsLoading = ref(false)
const importPresetsMessage = ref<string | null>(null)
const importPresetsError = ref(false)
const expandedProviderId = ref('')
const activatingProviderId = ref('')
const showAddProviderDialog = ref(false)
const addProviderSearch = ref('')
const fetchingModelsId = ref('')
const fetchModelsMessage = ref<string | null>(null)
const fetchModelsOk = ref(false)
const testingProviderId = ref('')
const deletingProviderId = ref('')
const visibilitySavingProviderId = ref('')
const modelVisibilitySearch = ref('')
const modelRoleLightModelId = ref('')
const modelRoleSelectorModelId = ref('')
const modelRoleLightProviderId = ref('')
const modelRoleSelectorProviderId = ref('')
const memoryAutoEnabled = ref(false)
const memoryDreamEnabled = ref(false)
const memoryPoorMode = ref(false)

const configuredProviders = computed(() => configuredCompatibleProviders(compatibleProviders.value))

const invalidBindingWarning = computed(() => {
  const binding = currentEngineBinding.value
  if (!binding?.providerId) return null
  const compatible = compatibleProviders.value.some((p) => p.id === binding.providerId)
  if (compatible) return null
  const label = binding.providerId
  return `绑定「${label}」不可用，请在下方重选并设为默认。`
})

const displayedProviders = computed(() => {
  const configured = configuredProviders.value
  const editingId = expandedProviderId.value
  if (!editingId) return configured
  const editing = compatibleProviders.value.find((p) => p.id === editingId)
  if (editing && !editing.credentialPresent && !configured.some((p) => p.id === editingId)) {
    return [editing, ...configured]
  }
  return configured
})

const availableToAddProviders = computed(() => compatibleProviders.value.filter((p) => !p.credentialPresent))

const filteredAvailableToAdd = computed(() => {
  const q = addProviderSearch.value.trim().toLowerCase()
  const list = availableToAddProviders.value
  if (!q) return list
  return list.filter(
    (p) => providerDisplayName(p).toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.baseUrl || '').toLowerCase().includes(q),
  )
})

const showOpencodeProviderEmptyAlert = computed(
  () => isOpencodeEngine(agentExecForm.engine) && compatibleProviders.value.length === 0,
)

const uiForm = reactive({ theme: 'auto', fontSize: 14, chatWidth: 480 })
const permForm = reactive({ askOnWrite: false, askOnBash: false, askOnNetwork: false, autoApproveLimit: 10 })
const agentExecForm = reactive<AgentExecutionSettings>({ engine: DEFAULT_AGENT_EXECUTION_ENGINE, bindings: {} })

function inlineBaseUrlForProvider(provider: ProviderSummary | null | undefined): string {
  if (!provider) return ''
  return resolveInlineBaseUrl(provider, activeInlineProviderId(), inlineBaseUrl.value)
}
function normalizeModelIdForProvider(provider: ProviderSummary | null | undefined, modelId: string): string {
  return sanitizeModelIdForProvider(provider, modelId, inlineBaseUrlForProvider(provider), provider?.id)
}
function friendlyConnectionError(message: string | undefined): string {
  const text = String(message || '').trim()
  if (!text) return '未知错误'
  return text
}

const bindingModelOptions = computed(() => {
  const providerId = expandedProviderId.value || bindingProviderId.value
  const provider = compatibleProviders.value.find((p) => p.id === providerId)
  if (!provider) return []
  return normalizeModelOptions(provider, visibleProviderModels(provider), inlineBaseUrlForProvider(provider), provider?.id)
})
const settingsModelPickerOptions = computed(() =>
  buildConfiguredModelPickerOptions(compatibleProviders.value),
)
const bindingProviderPickerOptions = computed(() => {
  const providerId = expandedProviderId.value || bindingProviderId.value
  const provider = compatibleProviders.value.find((p) => p.id === providerId)
  if (!provider) return []
  const models = bindingModelOptions.value
  if (!models.length) return []
  return [{
    id: provider.id,
    label: providerDisplayName(provider),
    models,
  }]
})
const selectedBindingProvider = computed(() => compatibleProviders.value.find((p) => p.id === bindingProviderId.value) || null)
const inlineApiKeyPlaceholder = computed(() => selectedBindingProvider.value?.credentialPresent ? '（已配置）留空保留原值' : '粘贴 API Key')
const inlineApiKeyHint = computed(() => selectedBindingProvider.value?.credentialPresent ? '留空保留原密钥；填入新值后点击其他地方会自动保存' : '填入后点击其他地方会自动保存到本地安全存储')

function providerDisplayName(provider: Pick<ProviderSummary, 'id' | 'displayName'> | null | undefined): string {
  if (!provider) return ''
  return formatProviderDisplayName(provider.displayName) || provider.id
}

function isOpencodeEngine(engine?: string): boolean { return !engine || engine === DEFAULT_AGENT_EXECUTION_ENGINE }
function resolveBindingStorageKeyUi(engine: string): AgentExecutionEngineId { void engine; return DEFAULT_AGENT_EXECUTION_ENGINE }

const activeProviderLabel = computed(() => {
  const p = activeStatusProvider.value
  const binding = currentEngineBinding.value
  if (p) return providerDisplayName(p)
  if (binding?.providerId) return binding.providerId
  return '未选择'
})
const activeModelLabel = computed(() => {
  const binding = currentEngineBinding.value
  if (!binding?.modelId) return '—'
  const provider = compatibleProviders.value.find((p) => p.id === binding.providerId)
  return isConfiguredProviderModelHidden(provider, binding.modelId)
    ? `${binding.modelId}（已隐藏）`
    : binding.modelId
})
const activeKeyOk = computed(() => Boolean(activeStatusProvider.value?.credentialPresent))
const lastSyncLabel = computed(() => { const at = store.agentExecution.lastSyncedAt; return at ? at : '尚未同步' })

const currentEngineBinding = computed(() => {
  const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  const bindingEngine = resolveBindingStorageKeyUi(engine)
  return agentExecForm.bindings?.[bindingEngine] || store.bindingForEngine(engine)
})
const activeStatusProvider = computed(() => {
  const binding = currentEngineBinding.value
  if (!binding?.providerId) return null
  const compatible = compatibleProviders.value.find((p) => p.id === binding.providerId)
  if (compatible) return compatible
  return store.providers.find((p) => p.id === binding.providerId) || null
})

function applyUi() { uiForm.theme = (store.ui.theme as string) ?? 'auto'; uiForm.fontSize = (store.ui.fontSize as number) ?? 14; uiForm.chatWidth = (store.ui.chatWidth as number) ?? 480 }
function applyPermissions() { permForm.askOnWrite = Boolean(store.permissions.askOnWrite); permForm.askOnBash = Boolean(store.permissions.askOnBash); permForm.askOnNetwork = Boolean(store.permissions.askOnNetwork); permForm.autoApproveLimit = (store.permissions.autoApproveLimit as number) ?? 10 }
function activeInlineProviderId(): string { return expandedProviderId.value || bindingProviderId.value }
function syncInlineFormFromProvider(provider?: ProviderSummary | null) {
  const resolved = provider ?? compatibleProviders.value.find((p) => p.id === activeInlineProviderId()) ?? selectedBindingProvider.value
  const draft = syncInlineFormDraft(resolved); inlineCredentialValue.value = draft.credentialValue; inlineBaseUrl.value = draft.baseUrl
}
function resolveBindingModelId(providerOverride?: ProviderSummary | null): string {
  const provider = providerOverride ?? selectedBindingProvider.value ?? compatibleProviders.value.find((p) => p.id === activeInlineProviderId())
  const trimmed = bindingModelId.value.trim()
  if (trimmed) return normalizeModelIdForProvider(provider, trimmed)
  const visibleModels = provider ? visibleProviderModels(provider) : []
  const defaultModel = provider?.defaultModel && isRawModelVisible(provider, provider.defaultModel)
    ? provider.defaultModel
    : ''
  const fallback = defaultModel || visibleModels[0]?.id || ''
  return normalizeModelIdForProvider(provider, fallback)
}
function syncBindingModelIdFromProvider(provider?: ProviderSummary | null) {
  const resolved = provider ?? selectedBindingProvider.value
  if (!resolved) return
  const current = bindingModelId.value.trim()
  if (!current) { bindingModelId.value = resolveBindingModelId(resolved); return }
  const normalized = normalizeModelIdForProvider(resolved, current)
  if (normalized !== bindingModelId.value) bindingModelId.value = normalized
}
function buildInlineProviderConfigPatch(provider: ProviderSummary): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  const credential = inlineCredentialValue.value.trim()
  if (credential) patch.credentialValue = credential
  const baseUrl = inlineBaseUrl.value.trim()
  if (baseUrl && baseUrl !== (provider.baseUrl || '')) patch.baseUrl = baseUrl
  return Object.keys(patch).length > 0 ? patch : null
}
function buildProviderUpsertPatch(): Record<string, unknown> | null {
  const providerId = activeInlineProviderId()
  const provider = compatibleProviders.value.find((p) => p.id === providerId) || selectedBindingProvider.value
  if (!providerId || !provider) return null
  const patch: Record<string, unknown> = buildInlineProviderConfigPatch(provider) || {}
  const modelId = resolveBindingModelId(provider)
  if (modelId) {
    const existingModels = normalizeModelOptions(provider, provider.models || [], inlineBaseUrlForProvider(provider), provider.id)
    const match = existingModels.find((m) => m.id === modelId)
    if (!match) patch.models = [{ id: modelId, label: formatModelDisplayLabel(modelId) }, ...existingModels]
    else if (existingModels[0]?.id !== modelId) { const rest = existingModels.filter((m) => m.id !== modelId); patch.models = [{ id: modelId, label: match.label || modelId }, ...rest] }
  }
  return Object.keys(patch).length > 0 ? patch : null
}
async function upsertInlineProviderConfig(options: { fetchModelsAfter?: boolean } = {}) {
  const providerId = activeInlineProviderId()
  const provider = compatibleProviders.value.find((p) => p.id === providerId) || selectedBindingProvider.value
  const patch = buildProviderUpsertPatch()
  if (!providerId || !patch) return false
  const hadNewCredential = Boolean(patch.credentialValue)
  await settingsApi.updateProvider(providerId, patch); await store.loadProviders(); await loadCompatibleProviders(); syncInlineFormFromProvider()
  if (options.fetchModelsAfter && provider && hadNewCredential) { const refreshed = compatibleProviders.value.find((p) => p.id === providerId) || provider; await onFetchModelsForProvider(refreshed, { silent: true, autoAfterSave: true }) }
  return true
}
function isFocusMovingWithinInlineForm(event?: Event): boolean {
  if (!event || !('relatedTarget' in event)) return false
  const nextTarget = (event as FocusEvent).relatedTarget
  const currentTarget = event.currentTarget
  if (!(nextTarget instanceof Node) || !(currentTarget instanceof HTMLElement)) return false
  return Boolean(currentTarget.closest('.provider-inline-form')?.contains(nextTarget))
}
async function onInlineProviderConfigBlur(event?: Event) {
  if (isFocusMovingWithinInlineForm(event)) return
  const providerId = activeInlineProviderId()
  const provider = compatibleProviders.value.find((p) => p.id === providerId) || selectedBindingProvider.value
  if (!providerId || !provider || inlineAutoSavingProviderId.value) return
  const patch = buildInlineProviderConfigPatch(provider)
  if (!patch) return
  inlineAutoSavingProviderId.value = providerId
  try {
    await settingsApi.updateProvider(providerId, patch)
    await store.loadProviders()
    await loadCompatibleProviders()
    syncStatus.value = 'API 配置已自动保存'
    toast('success', 'API 配置已自动保存')
  } catch (err) {
    toast('error', err instanceof Error ? err.message : 'API 配置自动保存失败')
  } finally {
    inlineAutoSavingProviderId.value = ''
  }
}
function canFetchModelsForCard(provider: ProviderSummary): boolean { const key = inlineCredentialValue.value.trim(); return Boolean(key || provider.credentialPresent) }
async function onFetchModelsForProvider(provider: ProviderSummary, options: { silent?: boolean; autoAfterSave?: boolean } = {}) {
  const apiKey = inlineCredentialValue.value.trim()
  if (!apiKey && !provider.credentialPresent) { if (!options.silent) toast('warn', '请先填写 API Key'); return }
  fetchingModelsId.value = provider.id; fetchModelsMessage.value = null
  try {
    if (apiKey) {
      await settingsApi.updateProvider(provider.id, { credentialValue: apiKey })
      await store.loadProviders()
      await loadCompatibleProviders()
    }
    const baseUrl = resolveInlineBaseUrl(provider, activeInlineProviderId(), inlineBaseUrl.value) || undefined
    const result = await store.fetchModels(provider.id, { apiKey: apiKey || undefined, baseUrl, persist: true })
    if (result.ok && result.models?.length) {
      fetchModelsOk.value = true
      fetchModelsMessage.value = `已拉取 ${result.models.length} 个模型并更新列表`
      if (!options.silent) toast('success', fetchModelsMessage.value)
      const baseUrl2 = resolveInlineBaseUrl(provider, activeInlineProviderId(), inlineBaseUrl.value)
      const fetchedModels = normalizeModelOptions(provider, result.models, baseUrl2, provider.id)
      const idx = compatibleProviders.value.findIndex((p) => p.id === provider.id)
      if (idx >= 0) { const normalizedDefault = sanitizeModelIdForProvider(provider, compatibleProviders.value[idx].defaultModel || '', baseUrl2, provider.id); compatibleProviders.value[idx] = { ...compatibleProviders.value[idx], models: fetchedModels, defaultModel: fetchedModels[0]?.id || (normalizedDefault || undefined) || compatibleProviders.value[idx].defaultModel } }
      await store.loadProviders(); await loadCompatibleProviders()
      const refreshed = compatibleProviders.value.find((p) => p.id === provider.id); syncBindingModelIdFromProvider(refreshed)
      if (refreshed && bindingModelId.value) { const normalized = normalizeModelIdForProvider(refreshed, bindingModelId.value); const models = normalizeModelOptions(refreshed, refreshed.models || [], inlineBaseUrlForProvider(refreshed), refreshed.id); if (!models.some((m) => m.id === normalized)) bindingModelId.value = normalizeModelIdForProvider(refreshed, refreshed.defaultModel || models[0]?.id || ''); else bindingModelId.value = normalized } else if (!bindingModelId.value) bindingModelId.value = resolveBindingModelId(refreshed)
    } else { fetchModelsOk.value = false; fetchModelsMessage.value = result.error || '未返回模型列表'; if (!options.silent) toast('warn', fetchModelsMessage.value) }
  } catch (err) { fetchModelsOk.value = false; fetchModelsMessage.value = err instanceof Error ? err.message : '拉取模型失败'; if (!options.silent) toast('error', fetchModelsMessage.value) } finally { fetchingModelsId.value = '' }
}
function isProviderActive(providerId: string) { const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const binding = agentExecForm.bindings?.[engine]; if (binding?.providerId !== providerId) return false; return compatibleProviders.value.some((p) => p.id === providerId) }
function modelEntryForProvider(provider: ProviderSummary, modelId: string): { id: string; label: string } | undefined {
  const baseUrl = inlineBaseUrlForProvider(provider); const normalized = sanitizeModelIdForProvider(provider, modelId, baseUrl, provider.id)
  return provider.models?.find((m) => { const mid = sanitizeModelIdForProvider(provider, m.id, baseUrl, provider.id); return mid === normalized || m.id === modelId })
}
function isConfiguredProviderModelHidden(provider: ProviderSummary | null | undefined, modelId: string): boolean {
  if (!provider || !modelId) return false
  const entry = modelEntryForProvider(provider, modelId)
  return Boolean(entry && !isRawModelVisible(provider, entry.id))
}
function onBindingModelSelect(payload: { providerId: string; modelId: string }) {
  bindingProviderId.value = payload.providerId
  bindingModelId.value = payload.modelId
}
function onModelRoleLightSelect(payload: { providerId: string; modelId: string }) {
  modelRoleLightProviderId.value = payload.providerId
  modelRoleLightModelId.value = payload.modelId
}
function onModelRoleLightClear() {
  modelRoleLightProviderId.value = ''
  modelRoleLightModelId.value = ''
}
function onModelRoleSelectorSelect(payload: { providerId: string; modelId: string }) {
  modelRoleSelectorProviderId.value = payload.providerId
  modelRoleSelectorModelId.value = payload.modelId
}
function onModelRoleSelectorClear() {
  modelRoleSelectorProviderId.value = ''
  modelRoleSelectorModelId.value = ''
}
function isModelRoleHidden(modelId: string, providerId: string): boolean {
  const trimmed = modelId.trim()
  if (!trimmed) return false
  const currentProvider = compatibleProviders.value.find((provider) => provider.id === providerId)
  if (currentProvider && modelEntryForProvider(currentProvider, trimmed)) {
    return isConfiguredProviderModelHidden(currentProvider, trimmed)
  }
  const matches = compatibleProviders.value.filter((provider) => modelEntryForProvider(provider, trimmed))
  return matches.length > 0 && matches.every((provider) => isConfiguredProviderModelHidden(provider, trimmed))
}
function isModelVisible(provider: ProviderSummary, modelId: string): boolean {
  return isRawModelVisible(provider, modelId)
}
function visibleModelCount(provider: ProviderSummary): number {
  return (provider.models?.length || 0) - hiddenProviderModelCount(provider)
}
function filteredVisibilityModels(provider: ProviderSummary): Array<{ id: string; label: string }> {
  const query = modelVisibilitySearch.value.trim().toLowerCase()
  if (!query) return provider.models || []
  return (provider.models || []).filter((model) => (
    model.id.toLowerCase().includes(query)
    || (model.label || model.id).toLowerCase().includes(query)
  ))
}
function replaceProviderVisibility(providerId: string, hiddenModelIds: string[]) {
  const apply = (providers: ProviderSummary[]) => providers.map((provider) => (
    provider.id === providerId ? { ...provider, hiddenModelIds } : provider
  ))
  compatibleProviders.value = apply(compatibleProviders.value)
  store.providers = apply(store.providers)
}
async function saveProviderVisibility(provider: ProviderSummary, hiddenModelIds: string[]) {
  const previous = normalizedHiddenModelIds(provider)
  const next = [...new Set(hiddenModelIds)]
  replaceProviderVisibility(provider.id, next)
  visibilitySavingProviderId.value = provider.id
  try {
    await settingsApi.updateProvider(provider.id, { hiddenModelIds: next })
    await store.loadProviders()
    await loadCompatibleProviders()
  } catch (err) {
    replaceProviderVisibility(provider.id, previous)
    toast('error', err instanceof Error ? err.message : '保存模型显示设置失败')
  } finally {
    visibilitySavingProviderId.value = ''
  }
}
function onToggleModelVisibility(provider: ProviderSummary, modelId: string, visible: boolean) {
  void saveProviderVisibility(provider, hiddenModelIdsAfterToggle(provider, modelId, visible))
}
function onShowAllModels(provider: ProviderSummary) {
  void saveProviderVisibility(provider, [])
}
function onHideAllModels(provider: ProviderSummary) {
  void saveProviderVisibility(provider, hiddenModelIdsForAllModels(provider))
}
function cardModelLabel(provider: ProviderSummary) {
  let modelId = ''
  if (expandedProviderId.value === provider.id) modelId = resolveBindingModelId(provider)
  else if (isProviderActive(provider.id)) { const binding = currentEngineBinding.value; if (binding?.modelId) modelId = binding.modelId }
  if (!modelId) modelId = provider.defaultModel || provider.models?.[0]?.id || ''
  if (!modelId) return '—'
  const label = formatModelDisplayLabel(modelId, modelEntryForProvider(provider, modelId))
  return isConfiguredProviderModelHidden(provider, modelId) ? `${label}（已隐藏）` : label
}
function selectProviderForEdit(provider: ProviderSummary) { bindingProviderId.value = provider.id; syncInlineFormFromProvider(provider); onBindingProviderChange() }
function toggleProviderExpand(providerId: string) { if (expandedProviderId.value === providerId) { expandedProviderId.value = ''; modelVisibilitySearch.value = ''; return } expandedProviderId.value = providerId; modelVisibilitySearch.value = ''; const provider = compatibleProviders.value.find((p) => p.id === providerId); if (provider) selectProviderForEdit(provider) }
function onProviderCardClick(provider: ProviderSummary) { toggleProviderExpand(provider.id) }
function applyAgentExecution() {
  agentExecForm.engine = DEFAULT_AGENT_EXECUTION_ENGINE; agentExecForm.bindings = { ...(store.agentExecution.bindings || {}) }
  const binding = store.bindingForEngine(agentExecForm.engine); bindingProviderId.value = binding?.providerId || ''; bindingModelId.value = binding?.modelId || ''; expandedProviderId.value = ''; syncInlineFormFromProvider()
  const boundProvider = compatibleProviders.value.find((p) => p.id === bindingProviderId.value); syncBindingModelIdFromProvider(boundProvider)
  syncStatus.value = store.agentExecution.lastSyncedAt ? `上次同步：${store.agentExecution.lastSyncedAt}` : null
}
function applyModelRoles() {
  modelRoleLightModelId.value = store.modelRoles.lightModel?.modelId || ''
  modelRoleSelectorModelId.value = store.modelRoles.selectorModel?.modelId || ''
  modelRoleLightProviderId.value = store.modelRoles.lightModel?.providerId || ''
  modelRoleSelectorProviderId.value = store.modelRoles.selectorModel?.providerId || ''
}
function applyMemorySettings() {
  memoryAutoEnabled.value = store.memorySettings.autoMemoryEnabled ?? false
  memoryDreamEnabled.value = store.memorySettings.autoDreamEnabled ?? false
  memoryPoorMode.value = store.memorySettings.poorMode ?? false
}
function openAddProviderDialog() { showAddProviderDialog.value = true }
function closeAddDialog() { showAddProviderDialog.value = false; addProviderSearch.value = '' }
function onPickProviderToAdd(provider: ProviderSummary) { showAddProviderDialog.value = false; addProviderSearch.value = ''; expandedProviderId.value = provider.id; selectProviderForEdit(provider) }
async function onImportFromAddDialog() { await onSyncProviderSeeds(); if (availableToAddProviders.value.length) toast('info', '同步完成，请从列表中选择供应商并填写 API Key') }
function onCustomProviderFromAddDialog() { showAddProviderDialog.value = false; onAddProviderClick() }
async function loadCompatibleProviders() {
  const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  try {
    const result = await store.listCompatibleProviders(engine); compatibleProviders.value = result.providers || []
    const configured = compatibleProviders.value.filter((p) => p.credentialPresent)
    if (bindingProviderId.value && !compatibleProviders.value.some((p) => p.id === bindingProviderId.value)) { bindingProviderId.value = configured[0]?.id || ''; bindingModelId.value = ''; if (expandedProviderId.value && !compatibleProviders.value.some((p) => p.id === expandedProviderId.value)) expandedProviderId.value = '' }
    if (bindingProviderId.value) { const provider = compatibleProviders.value.find((p) => p.id === bindingProviderId.value); syncBindingModelIdFromProvider(provider) }
    syncInlineFormFromProvider()
  } catch (err) { toast('error', err instanceof Error ? err.message : '加载兼容 Provider 失败') }
}
function onBindingProviderChange() {
  const provider = selectedBindingProvider.value; syncBindingModelIdFromProvider(provider); const models = bindingModelOptions.value; const current = normalizeModelIdForProvider(provider, bindingModelId.value)
  if (!models.some((m) => m.id === current) && !isConfiguredProviderModelHidden(provider, current)) bindingModelId.value = normalizeModelIdForProvider(provider, models[0]?.id || '')
  else if (current !== bindingModelId.value) bindingModelId.value = current
  if (!expandedProviderId.value || expandedProviderId.value === bindingProviderId.value) syncInlineFormFromProvider(provider)
}
async function onActivateProvider(provider: ProviderSummary) {
  selectProviderForEdit(provider); expandedProviderId.value = provider.id; const resolvedModelId = resolveBindingModelId()
  if (!resolvedModelId) { toast('warn', '请填写默认模型'); return }
  bindingModelId.value = resolvedModelId; activatingProviderId.value = provider.id
  try {
    await upsertInlineProviderConfig({ fetchModelsAfter: true }); const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const bindingEngine = resolveBindingStorageKeyUi(engine); const result = await store.activateInvocation(provider.id, resolvedModelId, engine)
    agentExecForm.bindings = { ...(agentExecForm.bindings || {}), [bindingEngine]: { providerId: provider.id, modelId: resolvedModelId } }; if (result.bindings) agentExecForm.bindings = { ...result.bindings }
    applyAgentExecution(); if (result.blocker) toast('warn', `已绑定，但同步受阻：${result.blocker}`); else toast('success', '已设为默认并同步到运行配置')
  } catch (err) { toast('error', err instanceof Error ? err.message : '设为默认失败') } finally { activatingProviderId.value = '' }
}
function buildBindingsPatch() { const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const bindingEngine = resolveBindingStorageKeyUi(engine); const modelId = resolveBindingModelId(); if (!bindingProviderId.value || !modelId) return agentExecForm.bindings; return { ...(agentExecForm.bindings || {}), [bindingEngine]: { providerId: bindingProviderId.value, modelId } } }

onMounted(async () => {
  const tab = typeof route.query.tab === 'string' ? route.query.tab : ''; if (SETTINGS_TABS.has(tab)) activeName.value = tab
  await store.loadAll(); applyUi(); applyPermissions(); applyAgentExecution(); applyModelRoles(); applyMemorySettings(); await loadCompatibleProviders()
})
watch(() => store.ui, applyUi, { deep: true })
watch(() => store.permissions, applyPermissions, { deep: true })
watch(() => store.agentExecution, applyAgentExecution, { deep: true })
watch(() => store.modelRoles, applyModelRoles, { deep: true })
watch(() => store.memorySettings, applyMemorySettings, { deep: true })

async function onSaveUi() {
  try {
    await store.saveUi({ ...uiForm })
    applyUiTheme(store.ui)
    toast('success', '界面设置已保存')
  } catch (err) {
    toast('error', err instanceof Error ? err.message : '保存界面设置失败')
  }
}
async function onSaveModelEngine() {
  if (!bindingProviderId.value) { toast('warn', '请选择 Provider'); return }
  const resolvedModelId = resolveBindingModelId(); if (!resolvedModelId) { toast('warn', '请填写默认模型'); return }
  bindingModelId.value = resolvedModelId
  try {
    await upsertInlineProviderConfig({ fetchModelsAfter: true }); const payload: AgentExecutionSettings = { ...agentExecForm, bindings: buildBindingsPatch() }; await store.saveAgentExecution(payload); applyAgentExecution()
    const lightModelId = modelRoleLightModelId.value.trim()
    const selectorModelId = modelRoleSelectorModelId.value.trim()
    const lightBinding = lightModelId
      ? { providerId: modelRoleLightProviderId.value, modelId: lightModelId }
      : undefined
    const selectorBinding = selectorModelId
      ? { providerId: modelRoleSelectorProviderId.value, modelId: selectorModelId }
      : undefined
    await store.saveModelRoles({ lightModel: lightBinding, selectorModel: selectorBinding })
    await store.saveMemorySettings({ autoMemoryEnabled: memoryAutoEnabled.value, autoDreamEnabled: memoryDreamEnabled.value, poorMode: memoryPoorMode.value })
    syncStatus.value = store.agentExecution.lastSyncedAt ? `上次同步：${store.agentExecution.lastSyncedAt}` : '已保存'; toast('success', '模型设置已保存并同步。')
  } catch (err) { toast('error', err instanceof Error ? err.message : '保存失败') }
}
async function onSavePermissions() { try { await store.savePermissions({ ...permForm }); toast('success', 'Permissions saved.') } catch (err) { toast('error', err instanceof Error ? err.message : 'Failed to save permissions.') } }
function onManageProviders() { activeName.value = 'providers' }
async function onSyncProviderSeeds() {
  importPresetsLoading.value = true; importPresetsMessage.value = null; importPresetsError.value = false
  try {
    const result = await store.syncProviderSeeds(); const imported = result.imported?.length || 0; const skipped = result.skipped?.length || 0; importPresetsMessage.value = `已从本地供应商库同步 ${imported} 个供应商${result.clearedCount ? `，清理 ${result.clearedCount} 个旧的 Claude 供应商` : ''}${skipped ? `，跳过 ${skipped} 个重复项` : ''}。请为需要的供应商填写 API Key 后设为默认。`; if (result.errors?.length) importPresetsMessage.value += ` ${result.errors.length} 项失败。`; if (imported > 0) toast('success', `已同步 ${imported} 个供应商`); else toast('warn', '暂无可同步的供应商'); await loadCompatibleProviders(); applyAgentExecution()
  } catch (err) { importPresetsError.value = true; importPresetsMessage.value = err instanceof Error ? err.message : '同步失败'; toast('error', importPresetsMessage.value) } finally { importPresetsLoading.value = false }
}
function onAddProviderClick() { selectedProvider.value = null; showProviderForm.value = true }
function onEditProvider(provider: ProviderSummary) { selectedProvider.value = provider; showProviderForm.value = true }
function testOverridesForCard(provider: ProviderSummary): { apiKey?: string; baseUrl?: string; model?: string } | undefined {
  if (expandedProviderId.value !== provider.id) return undefined
  const apiKey = inlineCredentialValue.value.trim(); const baseUrl = resolveInlineBaseUrl(provider, provider.id, inlineBaseUrl.value)?.trim(); const model = sanitizeModelIdForProvider(provider, resolveBindingModelId(provider), resolveInlineBaseUrl(provider, provider.id, inlineBaseUrl.value), provider.id)
  const overrides: { apiKey?: string; baseUrl?: string; model?: string } = {}; if (apiKey) overrides.apiKey = apiKey; if (baseUrl) overrides.baseUrl = baseUrl; if (model) overrides.model = model
  return Object.keys(overrides).length > 0 ? overrides : undefined
}
async function onTestProviderCard(provider: ProviderSummary) {
  if (expandedProviderId.value !== provider.id) { expandedProviderId.value = provider.id; selectProviderForEdit(provider) }
  if (!provider.credentialPresent && !inlineCredentialValue.value.trim()) { toast('warn', '请先填写 API Key 或保存已有凭证'); return }
  testingProviderId.value = provider.id
  try { const result = await store.testProvider(provider.id, testOverridesForCard(provider)); if (result.ok) toast('success', `连接成功：${result.latencyMs ?? '—'}ms${result.model ? ` · ${result.model}` : ''}`); else toast('error', `连接失败：${friendlyConnectionError(result.error)}`) } catch (err) { toast('error', err instanceof Error ? err.message : '测试连接失败') } finally { testingProviderId.value = '' }
}
async function onDeleteProviderCard(provider: ProviderSummary) {
  const confirmed = confirm(`确定删除供应商「${providerDisplayName(provider)}」？此操作会移除本地配置与凭证，不可恢复。`); if (!confirmed) return
  deletingProviderId.value = provider.id
  try { await store.deleteProvider(provider.id); const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const binding = agentExecForm.bindings?.[engine]; if (binding?.providerId === provider.id) { const nextBindings = { ...(agentExecForm.bindings || {}) }; delete nextBindings[engine]; await store.saveAgentExecution({ ...agentExecForm, bindings: nextBindings }) } if (expandedProviderId.value === provider.id) { expandedProviderId.value = ''; inlineCredentialValue.value = ''; inlineBaseUrl.value = '' } await loadCompatibleProviders(); applyAgentExecution(); toast('success', '已删除供应商') } catch (err) { toast('error', err instanceof Error ? err.message : '删除失败') } finally { deletingProviderId.value = '' }
}
async function onTestProvider(provider: ProviderSummary) { await onTestProviderCard(provider) }
async function onProviderSaved() { await store.loadProviders(); await loadCompatibleProviders(); if (selectedProvider.value?.id) { expandedProviderId.value = selectedProvider.value.id; selectProviderForEdit(compatibleProviders.value.find((p) => p.id === selectedProvider.value?.id) || selectedProvider.value) } }
async function onProviderDeleted() { await store.loadProviders() }
</script>

<style scoped>
/* Layout */
.settings-view { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; width: 100%; background: var(--console-page, var(--app-bg-page)) }
.settings-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden }
.settings-split { flex: 1; min-height: 0; grid-template-columns: 198px minmax(0, 1fr); padding: 14px 40px 34px; gap: 22px }
.settings-nav { border-right: 0 }
.settings-nav .folder { width: 100%; height: 38px; display: flex; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--console-text-soft,#5a5247); font: inherit; font-size: 13px; cursor: pointer; text-align: left }
.settings-nav .folder:hover { background: #f1e9db; color: var(--console-text-soft,#5a5247) }
.settings-nav .folder.active { border-color: transparent; background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); font-weight: 650 }
.settings-nav .folder:focus-visible { outline: none; box-shadow: var(--app-ring) }
.settings-content { min-width: 0 }
.settings-tab-content { padding: 22px 24px 28px; max-width: min(980px, 100%) }
.settings-tab-content h3 { margin: 0 0 10px; font-size: 18px; font-weight: 650; color: var(--console-text,#211d17); letter-spacing: -0.02em }
.desc { color: var(--console-text-muted,#9a8e7e); font-size: 13px; margin-bottom: 20px }

/* Error bar */
.settings-error-bar { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--app-danger-soft); color: var(--app-danger); font-size: 13px }
.settings-loading-bar { flex-shrink: 0; padding: 9px 40px; border-bottom: 1px solid var(--console-border,#e4dcce); background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); font-size: 12px; font-weight: 700 }

/* Alerts */
.alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border-radius: var(--app-radius-sm); font-size: 13px; margin-bottom: 12px; line-height: 1.5 }
.alert-icon { flex: 0 0 18px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 700 }
.alert-body { flex: 1 }
.alert-close { background: none; border: none; color: inherit; cursor: pointer; font-size: 16px; padding: 0; line-height: 1 }
.alert-error { background: var(--app-danger-soft); color: var(--app-danger) }
.alert-error .alert-icon { background: var(--app-danger); color: var(--app-bg) }
.alert-success { background: var(--app-ok-soft); color: var(--app-ok) }
.alert-success .alert-icon { background: var(--app-ok); color: var(--app-bg) }
.alert-warn { background: var(--app-warn-soft); color: var(--app-warn) }
.alert-warn .alert-icon { background: var(--app-warn); color: var(--app-bg) }
.alert-info { background: var(--app-accent-soft); color: var(--app-accent) }
.alert-info .alert-icon { background: var(--app-accent); color: var(--app-accent-ink) }

/* Pills */
.pill { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: var(--app-radius-pill); font-size: 12px; line-height: 1.5; border: 1px solid var(--app-border); color: var(--app-ink-soft); background: var(--app-bg-soft); white-space: nowrap }
.pill-info { border-color: var(--app-accent); color: var(--app-accent); background: var(--app-accent-soft) }
.pill-warn { border-color: var(--app-warn); color: var(--app-warn); background: var(--app-warn-soft) }
.pill-ok { border-color: var(--app-ok); color: var(--app-ok); background: var(--app-ok-soft) }
.pill-danger { border-color: var(--app-danger); color: var(--app-danger); background: var(--app-danger-soft) }
.pill-primary { border-color: var(--app-accent); color: var(--app-accent-ink); background: var(--app-accent) }
.pill-sm { font-size: 11px; padding: 1px 7px }

/* Status card */
.engine-status-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 32px; padding: 22px 24px; margin-bottom: 18px; border: 1px solid var(--console-border,#e4dcce); border-radius: 14px; background: var(--console-paper,#fffdfa); font-size: 13px; line-height: 1.45 }
.current-model-title { grid-column: 1 / -1; margin-bottom: 2px; color: var(--app-ink); font-size: 13px; font-weight: 650 }
.status-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 8px; align-items: baseline; min-width: 0 }
.status-row--full { grid-column: 1 / -1 }
.status-label { font-size: 12px; color: var(--app-ink-soft) }
.status-value { font-weight: 500; color: var(--app-ink); word-break: break-word }
.status-value.mono { font-family: var(--app-font-mono); font-size: 12px }
.status-ok { color: var(--app-ok) }
.status-warn { color: var(--app-warn) }

/* Engine segment */
.engine-segment-label { font-size: 13px; font-weight: 600; color: var(--app-ink-soft); margin-bottom: 10px; padding: 4px 0 }

/* Collapse (details/summary) */
.settings-collapse { border: 1px solid var(--console-border,#e4dcce); border-radius: 9px; margin-bottom: 12px; overflow: hidden }
.collapse-summary { cursor: pointer; padding: 8px 14px; font-size: 13px; font-weight: 600; color: var(--console-text-soft,#5a5247); background: var(--console-paper-soft,#faf5ec); list-style: none; display: flex; align-items: center; gap: 6px }
.collapse-summary::-webkit-details-marker { display: none }
.collapse-summary::before { content: '\25B6'; font-size: 9px; transition: transform 0.15s ease }
details[open] > .collapse-summary::before { transform: rotate(90deg) }
.collapse-body { padding: 12px 14px }
.model-roles-collapse { margin-top: 16px; margin-bottom: 12px; border-top: 1px solid var(--app-border) }
.memory-settings-collapse { margin-bottom: 12px; border-top: 1px solid var(--app-border) }
.memory-toggle-form { display: flex; flex-direction: column; gap: 10px }
.toggle-row { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; gap: 8px 10px; cursor: pointer }
.toggle-row input[type="checkbox"] { margin-top: 2px }
.toggle-label { font-size: 13px; font-weight: 500; color: var(--console-text,#3d3529); white-space: nowrap }

/* Segmented button group (replaces el-radio-button) */
.segmented-group { display: inline-flex; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); overflow: hidden }
.segmented-btn { padding: 4px 12px; border: none; border-right: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink-soft); font: inherit; font-size: 12px; cursor: pointer; transition: background var(--app-dur) var(--app-ease), color var(--app-dur) var(--app-ease) }
.segmented-btn:last-child { border-right: none }
.segmented-btn:hover { background: var(--app-bg-sunken) }
.segmented-btn.is-active { background: var(--app-accent-soft); color: var(--app-accent); font-weight: 600 }
.segmented-btn:disabled { opacity: 0.5; cursor: not-allowed }

/* Provider actions */
.provider-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px }
.preset-hint { font-size: 12px; color: var(--app-ink-soft) }
.provider-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px }
.provider-list-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--app-ink) }
.add-api-btn { flex-shrink: 0 }

/* Provider card list */
.provider-card-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px }
.provider-card { border: 1px solid transparent; border-radius: var(--app-radius-md); padding: 12px; background: var(--app-bg); box-shadow: var(--app-shadow-1); cursor: pointer; transition: background var(--app-dur) var(--app-ease), border-color var(--app-dur) var(--app-ease) }
.provider-card:hover { background: var(--app-bg-sunken) }
.provider-card.is-active { background: var(--app-bg-elevated); border-color: var(--app-border-strong); box-shadow: var(--app-shadow-1) }
.provider-card.is-expanded { cursor: default }
.provider-card-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px }
.provider-card-title { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.provider-card-title strong { font-size: 15px; color: var(--app-ink) }
.provider-card-id { font-size: 11px; color: var(--app-ink-soft); font-family: var(--app-font-mono) }
.provider-card-badges { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end }
.provider-card-meta { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px }
.meta-row { display: grid; grid-template-columns: 72px 1fr; gap: 8px; font-size: 12px; align-items: baseline }
.meta-label { color: var(--app-ink-soft) }
.meta-value { color: var(--app-ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.meta-value.mono { font-family: var(--app-font-mono) }
.provider-card-footer { display: flex; align-items: center; gap: 8px }
.provider-card-body { margin-top: 10px; padding: 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-bg) }
.provider-inline-form { max-width: 100% }

/* Form elements */
.form-group { margin-bottom: 14px }
.form-label { display: block; font-size: 12px; font-weight: 600; color: var(--app-ink-soft); margin-bottom: 4px }
.form-hint { font-size: 12px; color: var(--app-ink-soft); margin-top: 4px; line-height: 1.5 }
.form-hint.fetch-ok { color: var(--app-ok) }
.form-hint.fetch-err { color: var(--app-danger) }
.settings-input { width: 100%; padding: 6px 10px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font: inherit; font-size: 13px; outline: none; transition: border-color var(--app-dur) var(--app-ease) }
.settings-input:focus { border-color: var(--app-accent) }
.settings-select { padding: 6px 10px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font: inherit; font-size: 13px; outline: none }
.settings-select:focus { border-color: var(--app-accent) }
.model-field-row { display: flex; gap: 8px; align-items: flex-start; width: 100% }
.model-field-select { flex: 1; min-width: 0 }
.model-field-row .model-picker-trigger { width: 100% }
.model-visibility { margin-top: 18px; margin-bottom: 0; padding-top: 14px; border-top: 1px solid var(--app-border) }
.model-visibility-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px }
.model-visibility-header .form-label { margin-bottom: 0 }
.model-visibility-header .form-hint { margin-top: 2px }
.model-visibility-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0 }
.model-visibility-actions .workbench-link:disabled { opacity: 0.45; cursor: not-allowed }
.model-visibility-search { margin-bottom: 8px }
.model-visibility-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg) }
.model-visibility-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 7px 10px; cursor: pointer }
.model-visibility-row + .model-visibility-row { border-top: 1px solid var(--app-border) }
.model-visibility-row:hover { background: var(--app-bg-sunken) }
.model-visibility-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0 }
.model-visibility-name { overflow: hidden; color: var(--app-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap }
.model-visibility-id { overflow: hidden; color: var(--app-ink-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap }
.model-visibility-empty { padding: 18px 12px; border: 1px dashed var(--app-border); border-radius: var(--app-radius-sm); color: var(--app-ink-muted); font-size: 12px; text-align: center }
.settings-form { max-width: 480px }
.checkbox-label { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; color: var(--app-ink); cursor: pointer }
.checkbox-label input[type="checkbox"] { accent-color: var(--app-accent) }
.number-input { display: inline-flex; align-items: center; gap: 4px }
.num-btn { min-width: 28px; padding: 0 6px }
.num-input-field { width: 80px; text-align: center }

/* Link button */
.workbench-link { background: none; border: none; color: var(--app-accent); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: var(--app-radius-sm) }
.workbench-link:hover { background: var(--app-accent-soft) }
.workbench-link.danger { color: var(--app-danger) }
.workbench-link.danger:hover { background: var(--app-danger-soft) }

/* Toggle switch */
.toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0 }
.toggle.is-loading { opacity: 0.5; pointer-events: none }
.toggle input { position: absolute; opacity: 0; width: 0; height: 0 }
.toggle-track { width: 36px; height: 20px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); border-radius: var(--app-radius-pill); position: relative; transition: background var(--app-dur) var(--app-ease), border-color var(--app-dur) var(--app-ease) }
.toggle-thumb { width: 14px; height: 14px; background: var(--app-ink-muted); border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform var(--app-dur) var(--app-ease), background var(--app-dur) var(--app-ease) }
.toggle input:checked + .toggle-track { background: var(--app-accent-soft); border-color: var(--app-accent) }
.toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(16px); background: var(--app-accent) }

/* Dialog overlay */
.settings-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 10000 }
.settings-dialog { background: var(--app-bg-page); border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); width: 560px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--app-shadow-3) }
.dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--app-border) }
.dialog-header h4 { margin: 0; font-size: 15px; font-weight: 600; color: var(--app-ink) }
.dialog-close-btn { background: none; border: none; color: var(--app-ink-muted); font-size: 20px; cursor: pointer; padding: 0; line-height: 1 }
.dialog-close-btn:hover { color: var(--app-ink) }
.dialog-body { padding: 16px; flex: 1; overflow-y: auto }
.dialog-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--app-border) }

/* Add provider list */
.add-provider-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; margin-top: 10px }
.add-provider-item { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; gap: 4px 8px; width: 100%; padding: 10px 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); text-align: left; cursor: pointer; font: inherit; transition: border-color 0.15s ease, background 0.15s ease }
.add-provider-item:hover { border-color: var(--app-accent); background: var(--app-bg-sunken) }
.add-provider-name { grid-column: 1; font-weight: 600; font-size: 14px; color: var(--app-ink) }
.add-provider-tag { grid-column: 2; grid-row: 1 / span 2; align-self: start }
.add-provider-id { grid-column: 1; font-size: 11px; font-family: var(--app-font-mono); color: var(--app-ink-soft) }
.add-provider-url { grid-column: 1 / -1; font-size: 12px; color: var(--app-ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

/* Table */
.table-wrap { overflow-x: auto; margin-top: 16px }
.settings-table { width: 100%; border-collapse: collapse; font-size: 12px }
.settings-table th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--app-border); font-weight: 600; color: var(--app-ink-soft); white-space: nowrap }
.settings-table td { padding: 8px 10px; border-bottom: 1px solid var(--app-border); color: var(--app-ink); vertical-align: middle }
.settings-table tr:hover td { background: var(--app-bg-sunken) }
.td-ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.td-actions { display: flex; gap: 8px; white-space: nowrap }

/* Empty */
.empty-state { text-align: center; padding: 32px; color: var(--app-ink-muted); font-size: 13px }
.configured-empty { margin-bottom: 20px }

/* Footer */
.model-engine-footer { margin-top: 8px }
.footer-actions { display: flex; gap: 8px; margin-bottom: 12px }
.opencode-provider-alert { margin-bottom: 16px }
.opencode-alert-body { margin: 8px 0 12px; font-size: 13px; line-height: 1.5 }

/* Mono */
.mono { font-family: var(--app-font-mono) }

/* Toast */
.toast-stack { position: fixed; top: 16px; right: 16px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none }
.toast-item { padding: 8px 16px; border-radius: var(--app-radius-sm); font-size: 13px; font-family: var(--app-font-mono); border: 1px solid; pointer-events: auto; max-width: 420px; line-height: 1.4 }
.toast-success { background: var(--app-ok-soft); color: var(--app-ok); border-color: var(--app-ok) }
.toast-error { background: var(--app-danger-soft); color: var(--app-danger); border-color: var(--app-danger) }
.toast-warn { background: var(--app-warn-soft); color: var(--app-warn); border-color: var(--app-warn) }
.toast-info { background: var(--app-accent-soft); color: var(--app-accent); border-color: var(--app-accent) }
.toast-enter-active, .toast-leave-active { transition: opacity 0.3s ease, transform 0.3s ease }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(20px) }
</style>
