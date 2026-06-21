<template>
  <div class="settings-view" :data-ui-id="`settings-view-${activeName}`">
    <div class="settings-body">
      <div v-if="store.loading" class="settings-loading-bar">{{ t('settings.loading') }}</div>
      <div v-if="store.lastError" class="settings-error-bar">
        <span class="alert-icon">!</span> {{ store.lastError }}
      </div>

      <div class="console-split settings-split">
        <aside class="console-panel settings-nav">
          <div class="console-panel-scroll">
            <button
              v-for="tab in tabList"
              :key="tab.name"
              type="button"
              class="folder"
              :data-ui-id="`settings-tab-${tab.name}`"
              :class="{ active: activeName === tab.name }"
              @click="activeName = tab.name"
            >{{ t(tab.labelKey) }}</button>
          </div>
        </aside>

        <main class="console-panel settings-content">
          <div class="console-panel-scroll">

            <!-- TAB: model-engine -->
            <section v-if="activeName === 'model-engine'" class="settings-tab-content">
              <h3>{{ t('settings.model.title') }}</h3>
              <div class="provider-actions">
                <button class="workbench-button" data-ui-id="settings-manage-providers" @click="onManageProviders">{{ t('settings.model.manageProviders') }}</button>
              </div>

              <div v-if="importPresetsMessage" class="alert" :class="importPresetsError ? 'alert-error' : 'alert-success'">
                <span class="alert-icon">{{ importPresetsError ? '!' : '&#10003;' }}</span>
                <span class="alert-body">{{ importPresetsMessage }}</span>
                <button class="alert-close" @click="importPresetsMessage = null">&times;</button>
              </div>

              <div class="engine-status-bar" role="status">
                <div class="current-model-title">{{ t('settings.model.current') }}</div>
                <div class="status-row"><span class="status-label">{{ t('settings.model.provider') }}</span><span class="status-value">{{ activeProviderLabel }}</span></div>
                <div class="status-row"><span class="status-label">{{ t('settings.model.model') }}</span><span class="status-value mono">{{ activeModelLabel }}</span></div>
                <div class="status-row"><span class="status-label">{{ t('settings.model.key') }}</span><span class="status-value" :class="activeKeyOk ? 'status-ok' : 'status-warn'">{{ activeKeyOk ? t('settings.model.keyConfigured') : t('settings.model.keyMissing') }}</span></div>
                <div class="status-row status-row--full"><span class="status-label">{{ t('settings.model.sync') }}</span><span class="status-value">{{ lastSyncLabel }}</span></div>
              </div>

              <div v-if="invalidBindingWarning" class="alert alert-warn"><span class="alert-icon">!</span> {{ invalidBindingWarning }}</div>

              <div v-if="showOpencodeProviderEmptyAlert" class="alert alert-warn opencode-provider-alert">
                <span class="alert-icon">!</span>
                <div>
                  <strong>{{ t('settings.model.noApiProvidersTitle') }}</strong>
                  <p class="opencode-alert-body">{{ t('settings.model.noApiProvidersBody') }}</p>
                  <button class="workbench-button primary" data-ui-id="settings-sync-providers-empty" :disabled="importPresetsLoading" @click="onSyncProviderSeeds">{{ importPresetsLoading ? t('settings.model.syncingProviders') : t('settings.model.syncProviders') }}</button>
                </div>
              </div>

              <div class="provider-list-header">
                <h4 class="provider-list-title">API</h4>
                <button class="workbench-button primary add-api-btn" data-ui-id="settings-add-api" :title="t('settings.model.addApiTitle')" @click="openAddProviderDialog">{{ t('settings.model.add') }}</button>
              </div>

              <div v-if="displayedProviders.length" class="provider-card-list">
                <article v-for="p in displayedProviders" :key="p.id" class="provider-card" :class="{ 'is-active': isProviderActive(p.id), 'is-expanded': expandedProviderId === p.id }" @click="onProviderCardClick(p)">
                  <header class="provider-card-header">
                    <div class="provider-card-title">
                      <strong>{{ providerDisplayName(p) }}</strong>
                      <span class="provider-card-id mono">{{ p.id }}</span>
                    </div>
                    <div class="provider-card-badges">
                      <span v-if="!p.credentialPresent" class="pill pill-warn pill-sm">{{ t('settings.model.pendingKey') }}</span>
                      <span v-if="isProviderActive(p.id)" class="pill pill-primary pill-sm">{{ t('settings.model.defaultBadge') }}</span>
                    </div>
                  </header>
                  <div class="provider-card-meta">
                    <div class="meta-row"><span class="meta-label">{{ t('settings.model.model') }}</span><span class="meta-value mono">{{ cardModelLabel(p) }}</span></div>
                  </div>
                  <footer class="provider-card-footer" @click.stop>
                    <button class="workbench-button primary" :disabled="activatingProviderId === p.id" @click="onActivateProvider(p)">{{ activatingProviderId === p.id ? t('settings.model.setting') : t('settings.model.setDefault') }}</button>
                    <button class="workbench-button" :disabled="testingProviderId === p.id" @click="onTestProviderCard(p)">{{ testingProviderId === p.id ? t('settings.model.testing') : t('settings.model.test') }}</button>
                    <button class="workbench-link" @click="toggleProviderExpand(p.id)">{{ expandedProviderId === p.id ? t('settings.model.collapse') : t('settings.model.edit') }}</button>
                    <button class="workbench-link danger" :disabled="deletingProviderId === p.id" @click="onDeleteProviderCard(p)">{{ deletingProviderId === p.id ? t('settings.model.deleting') : t('settings.model.delete') }}</button>
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
                        <div class="form-hint">{{ t('settings.model.baseUrlHint') }}</div>
                      </div>
                      <div class="form-group">
                        <label class="form-label">{{ t('settings.model.defaultModel') }}</label>
                        <div class="model-field-row">
                          <ModelPicker
                            variant="field"
                            class="model-field-select"
                            :providers="bindingProviderPickerOptions"
                            :single-provider-id="p.id"
                            :selected-provider="bindingProviderId"
                            :selected-model="bindingModelId"
                            :placeholder="t('settings.model.selectDefaultModel')"
                            :empty-configured-hint="t('settings.model.fetchModelsFirst')"
                            @select="onBindingModelSelect"
                          />
                          <button class="workbench-button" :disabled="fetchingModelsId === p.id || !canFetchModelsForCard(p)" @click="onFetchModelsForProvider(p)">{{ fetchingModelsId === p.id ? t('settings.model.fetchingModels') : t('settings.model.fetchModels') }}</button>
                        </div>
                        <div v-if="fetchModelsMessage && expandedProviderId === p.id" class="form-hint" :class="fetchModelsOk ? 'fetch-ok' : 'fetch-err'">{{ fetchModelsMessage }}</div>
                        <div class="form-hint">{{ t('settings.model.fetchModelsHint') }}</div>
                      </div>
                      <div class="form-group model-visibility">
                        <div class="model-visibility-header">
                          <div>
                            <label class="form-label">{{ t('settings.model.modelVisibility') }}</label>
                            <div class="form-hint">{{ t('settings.model.modelsVisible', { visible: visibleModelCount(p), total: p.models?.length || 0 }) }}</div>
                          </div>
                          <div class="model-visibility-actions">
                            <button class="workbench-link" :disabled="visibilitySavingProviderId === p.id" @click="onShowAllModels(p)">{{ t('settings.model.showAll') }}</button>
                            <button class="workbench-link" :disabled="visibilitySavingProviderId === p.id" @click="onHideAllModels(p)">{{ t('settings.model.hideAll') }}</button>
                          </div>
                        </div>
                        <input v-model="modelVisibilitySearch" data-ui-id="settings-model-visibility-search" class="settings-input model-visibility-search" :placeholder="t('settings.model.searchModels')" />
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
                        <div v-else class="model-visibility-empty">{{ p.models?.length ? t('settings.model.noModelMatches') : t('settings.model.noModelsFetched') }}</div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
              <div v-else-if="!showOpencodeProviderEmptyAlert" class="configured-empty">
                <div class="empty-state"><p>{{ t('settings.model.noApiConfigured') }}</p><button class="workbench-button primary" data-ui-id="settings-add-api-empty" @click="openAddProviderDialog">{{ t('settings.model.addApiTitle') }}</button></div>
              </div>

              <Teleport to="body">
                <div v-if="showAddProviderDialog" class="settings-overlay" @click.self="closeAddDialog">
                  <div class="settings-dialog">
                    <div class="dialog-header"><h4>{{ t('settings.model.addApiTitle') }}</h4><button class="dialog-close-btn" @click="closeAddDialog">&times;</button></div>
                    <div class="dialog-body">
                      <input v-model="addProviderSearch" data-ui-id="settings-add-provider-search" class="settings-input" :placeholder="t('settings.model.searchProviders')" />
                      <div v-if="filteredAvailableToAdd.length" class="add-provider-list">
                        <button v-for="p in filteredAvailableToAdd" :key="p.id" type="button" class="add-provider-item" @click="onPickProviderToAdd(p)">
                          <span class="add-provider-name">{{ providerDisplayName(p) }}</span>
                          <span class="add-provider-id mono">{{ p.id }}</span>
                          <span v-if="p.baseUrl" class="add-provider-url" :title="p.baseUrl">{{ p.baseUrl }}</span>
                        </button>
                      </div>
                      <div v-else class="empty-state">{{ availableToAddProviders.length ? t('settings.model.noProviderMatches') : t('settings.model.noProvidersToAdd') }}</div>
                    </div>
                    <div class="dialog-footer">
                      <button class="workbench-button" data-ui-id="settings-add-dialog-sync-providers" :disabled="importPresetsLoading" @click="onImportFromAddDialog">{{ importPresetsLoading ? t('settings.model.syncingProviders') : t('settings.model.syncProviders') }}</button>
                      <button class="workbench-button" data-ui-id="settings-add-dialog-custom-provider" @click="onCustomProviderFromAddDialog">{{ t('settings.model.customProvider') }}</button>
                    </div>
                  </div>
                </div>
              </Teleport>

              <details class="settings-collapse model-roles-collapse">
                <summary class="collapse-summary">{{ t('settings.model.helperModels') }}</summary>
                <div class="collapse-body">
                  <p class="form-hint">{{ t('settings.model.helperModelsHint') }}</p>
                  <div class="provider-inline-form">
                    <div class="form-group">
                      <label class="form-label">{{ t('settings.model.lightModel') }}</label>
                      <ModelPicker
                        variant="field"
                        allow-empty
                        :empty-label="t('settings.model.emptyDefaultConfig')"
                        :providers="settingsModelPickerOptions"
                        :selected-provider="modelRoleLightProviderId"
                        :selected-model="modelRoleLightModelId"
                        :empty-configured-hint="t('settings.model.configureAndFetchFirst')"
                        @select="onModelRoleLightSelect"
                        @clear="onModelRoleLightClear"
                      />
                      <div v-if="isModelRoleHidden(modelRoleLightModelId, modelRoleLightProviderId)" class="form-hint fetch-err">{{ t('settings.model.hiddenModelWarning') }}</div>
                      <div class="form-hint">{{ t('settings.model.lightModelHint') }}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">{{ t('settings.model.selectorModel') }}</label>
                      <ModelPicker
                        variant="field"
                        allow-empty
                        :empty-label="t('settings.model.emptyDefaultConfig')"
                        :providers="settingsModelPickerOptions"
                        :selected-provider="modelRoleSelectorProviderId"
                        :selected-model="modelRoleSelectorModelId"
                        :empty-configured-hint="t('settings.model.configureAndFetchFirst')"
                        @select="onModelRoleSelectorSelect"
                        @clear="onModelRoleSelectorClear"
                      />
                      <div v-if="isModelRoleHidden(modelRoleSelectorModelId, modelRoleSelectorProviderId)" class="form-hint fetch-err">{{ t('settings.model.hiddenModelWarning') }}</div>
                      <div class="form-hint">{{ t('settings.model.selectorModelHint') }}</div>
                    </div>
                  </div>
                </div>
              </details>

              <details class="settings-collapse memory-settings-collapse" open>
                <summary class="collapse-summary">{{ t('settings.model.memorySystem') }}</summary>
                <div class="collapse-body">
                  <p class="form-hint">{{ t('settings.model.memorySystemHint') }}</p>
                  <div class="memory-toggle-form">
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryAutoEnabled" />
                      <span class="toggle-label">{{ t('settings.model.memoryExtract') }}</span>
                      <span class="form-hint">{{ t('settings.model.memoryExtractHint') }}</span>
                    </label>
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryDreamEnabled" />
                      <span class="toggle-label">{{ t('settings.model.memoryDream') }}</span>
                      <span class="form-hint">{{ t('settings.model.memoryDreamHint') }}</span>
                    </label>
                    <label class="toggle-row">
                      <input type="checkbox" v-model="memoryPoorMode" />
                      <span class="toggle-label">{{ t('settings.model.costSaving') }}</span>
                      <span class="form-hint">{{ t('settings.model.costSavingHint') }}</span>
                    </label>
                  </div>
                </div>
              </details>

              <div class="model-engine-footer">
                <div class="footer-actions">
                  <button class="workbench-button primary" data-ui-id="settings-save-model-engine" :disabled="store.loading" @click="onSaveModelEngine">{{ store.loading ? t('settings.ui.saving') : t('settings.model.saveAndSync') }}</button>
                </div>
                <div v-if="syncStatus" class="alert alert-info"><span class="alert-icon">i</span> {{ syncStatus }}</div>
              </div>
            </section>

            <!-- TAB: providers -->
            <section v-if="activeName === 'providers'" class="settings-tab-content">
              <h3>API</h3>
              <p class="desc">{{ t('settings.model.providersDescription') }}</p>
              <div class="provider-actions">
                <button class="workbench-button primary" data-ui-id="settings-provider-add" @click="onAddProviderClick">{{ t('settings.model.addProvider') }}</button>
                <button class="workbench-button" data-ui-id="settings-provider-sync" :disabled="importPresetsLoading" @click="onSyncProviderSeeds">{{ importPresetsLoading ? t('settings.model.syncingProviders') : t('settings.model.syncProviders') }}</button>
              </div>
              <div v-if="store.providers.length" class="table-wrap">
                <table class="settings-table">
                  <thead><tr><th>ID</th><th>{{ t('settings.model.tableName') }}</th><th>Base URL</th><th>{{ t('settings.model.tableDefaultModel') }}</th><th>{{ t('settings.model.tableStatus') }}</th><th>{{ t('settings.model.tableActions') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="row in store.providers" :key="row.id">
                      <td class="mono">{{ row.id }}</td><td>{{ providerDisplayName(row) }}</td><td class="mono td-ellipsis" :title="row.baseUrl">{{ row.baseUrl }}</td><td class="mono">{{ row.defaultModel }}</td>
                      <td><span class="pill pill-sm" :class="row.credentialPresent ? 'pill-ok' : 'pill-warn'">{{ row.credentialPresent ? t('settings.model.keyConfigured') : t('settings.model.noKey') }}</span></td>
                      <td class="td-actions"><button class="workbench-link" @click="onEditProvider(row)">{{ t('settings.model.edit') }}</button><button class="workbench-link" @click="onTestProvider(row)">{{ t('settings.model.test') }}</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state">{{ t('settings.model.noProviders') }}</div>
            </section>

            <!-- TAB: ui -->
            <section v-if="activeName === 'ui'" class="settings-tab-content">
              <h3>{{ t('settings.ui.title') }}</h3>
              <div class="settings-form">
                <div class="form-group">
                  <label class="form-label">{{ t('settings.ui.language') }}</label>
                  <select v-model="uiForm.language" data-ui-id="settings-ui-language" class="settings-select" style="width:240px">
                    <option v-for="option in PRODUCT_LANGUAGE_OPTIONS" :key="option.value" :value="option.value">{{ t(option.labelKey) }}</option>
                  </select>
                </div>
                <div class="form-group"><label class="form-label">{{ t('settings.ui.theme') }}</label><select v-model="uiForm.theme" data-ui-id="settings-ui-theme" class="settings-select" style="width:240px"><option value="auto">{{ t('settings.ui.theme.auto') }}</option><option value="rpgmv">{{ t('settings.ui.theme.rpgmv') }}</option><option value="saas">{{ t('settings.ui.theme.saas') }}</option></select></div>
                <div class="form-group"><label class="form-label">{{ t('settings.ui.chatFontSize') }}</label><div class="number-input"><button class="workbench-button num-btn" data-ui-id="settings-ui-font-size-dec" @click="uiForm.fontSize = Math.max(11, uiForm.fontSize - 1)">-</button><input type="number" v-model.number="uiForm.fontSize" data-ui-id="settings-ui-font-size" min="11" max="22" class="settings-input num-input-field" /><button class="workbench-button num-btn" data-ui-id="settings-ui-font-size-inc" @click="uiForm.fontSize = Math.min(22, uiForm.fontSize + 1)">+</button></div></div>
                <div class="form-group"><label class="form-label">{{ t('settings.ui.chatWidth') }}</label><div class="number-input"><button class="workbench-button num-btn" data-ui-id="settings-ui-chat-width-dec" @click="uiForm.chatWidth = Math.max(320, uiForm.chatWidth - 10)">-</button><input type="number" v-model.number="uiForm.chatWidth" data-ui-id="settings-ui-chat-width" min="320" max="960" step="10" class="settings-input num-input-field" /><button class="workbench-button num-btn" data-ui-id="settings-ui-chat-width-inc" @click="uiForm.chatWidth = Math.min(960, uiForm.chatWidth + 10)">+</button></div></div>
                <div class="form-group"><button class="workbench-button primary" data-ui-id="settings-ui-save" :disabled="store.loading" @click="onSaveUi">{{ store.loading ? t('settings.ui.saving') : t('settings.ui.save') }}</button></div>
              </div>
            </section>

            <!-- TAB: tools-mcp -->
            <section v-if="activeName === 'tools-mcp'" class="settings-tab-content"><SettingsToolsMcpTab :engine="agentExecForm.engine" /></section>

            <!-- TAB: rules-skills -->
            <section v-if="activeName === 'rules-skills'" class="settings-tab-content"><SettingsRulesSkillsTab /></section>

            <!-- TAB: permissions (hidden until PERMISSIONS_SETTINGS_TAB_ENABLED) -->
            <section v-if="PERMISSIONS_SETTINGS_TAB_ENABLED && activeName === 'permissions'" class="settings-tab-content">
              <h3>{{ t('settings.permissions.title') }}</h3>
              <p class="desc">{{ t('settings.permissions.description') }}</p>
              <div class="settings-form">
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnWrite" /> {{ t('settings.permissions.askOnWrite') }}</label>
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnBash" /> {{ t('settings.permissions.askOnBash') }}</label>
                <label class="checkbox-label"><input type="checkbox" v-model="permForm.askOnNetwork" /> {{ t('settings.permissions.askOnNetwork') }}</label>
                <div class="form-group"><label class="form-label">{{ t('settings.permissions.autoApproveLimit') }}</label><div class="number-input"><button class="workbench-button num-btn" @click="permForm.autoApproveLimit = Math.max(0, permForm.autoApproveLimit - 1)">-</button><input type="number" v-model.number="permForm.autoApproveLimit" min="0" max="100" class="settings-input num-input-field" /><button class="workbench-button num-btn" @click="permForm.autoApproveLimit = Math.min(100, permForm.autoApproveLimit + 1)">+</button></div></div>
                <div class="form-group"><button class="workbench-button primary" :disabled="store.loading" @click="onSavePermissions">{{ store.loading ? t('settings.permissions.saving') : t('settings.permissions.save') }}</button></div>
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
import { PRODUCT_LANGUAGE_OPTIONS, normalizeProductLanguage, useI18n, type MessageKey } from '../i18n'
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
const { t } = useI18n()
const activeName = ref('model-engine')
const SETTINGS_TABS = new Set([
  'model-engine',
  'providers',
  'ui',
  ...(PERMISSIONS_SETTINGS_TAB_ENABLED ? (['permissions'] as const) : []),
  'tools-mcp',
  'rules-skills',
])
const permissionTabs: Array<{ name: string; labelKey: MessageKey }> = PERMISSIONS_SETTINGS_TAB_ENABLED
  ? [{ name: 'permissions', labelKey: 'settings.tabs.permissions' }]
  : []
const tabList: Array<{ name: string; labelKey: MessageKey }> = [
  { name: 'model-engine', labelKey: 'settings.tabs.model' },
  { name: 'providers', labelKey: 'settings.tabs.providers' },
  { name: 'ui', labelKey: 'settings.tabs.ui' },
  { name: 'tools-mcp', labelKey: 'settings.tabs.toolsMcp' },
  { name: 'rules-skills', labelKey: 'settings.tabs.rulesSkills' },
  ...permissionTabs,
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
  return t('settings.model.invalidBinding', { label })
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

const uiForm = reactive({ theme: 'auto', fontSize: 14, chatWidth: 480, language: normalizeProductLanguage(undefined) })
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
  if (!text) return t('settings.model.unknownError')
  return text
}

function formatProviderSeedSyncMessage(imported: number, clearedCount: number, skipped: number, errorCount: number): string {
  let message = t('settings.model.syncSeedSummary', { imported })
  if (clearedCount) message += t('settings.model.syncSeedCleared', { count: clearedCount })
  if (skipped) message += t('settings.model.syncSeedSkipped', { count: skipped })
  message += t('settings.model.syncSeedAction')
  if (errorCount) message += t('settings.model.syncSeedErrors', { count: errorCount })
  return message
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
const inlineApiKeyPlaceholder = computed(() => selectedBindingProvider.value?.credentialPresent ? t('settings.model.apiKeyConfiguredPlaceholder') : t('settings.model.apiKeyPlaceholder'))
const inlineApiKeyHint = computed(() => selectedBindingProvider.value?.credentialPresent ? t('settings.model.apiKeyKeepHint') : t('settings.model.apiKeySaveHint'))

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
  return t('settings.model.notSelected')
})
const activeModelLabel = computed(() => {
  const binding = currentEngineBinding.value
  if (!binding?.modelId) return '—'
  const provider = compatibleProviders.value.find((p) => p.id === binding.providerId)
  return isConfiguredProviderModelHidden(provider, binding.modelId)
    ? t('modelPicker.hiddenSuffix', { model: binding.modelId })
    : binding.modelId
})
const activeKeyOk = computed(() => Boolean(activeStatusProvider.value?.credentialPresent))
const lastSyncLabel = computed(() => { const at = store.agentExecution.lastSyncedAt; return at ? at : t('settings.model.notSynced') })

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

function applyUi() { uiForm.theme = (store.ui.theme as string) ?? 'auto'; uiForm.fontSize = (store.ui.fontSize as number) ?? 14; uiForm.chatWidth = (store.ui.chatWidth as number) ?? 480; uiForm.language = normalizeProductLanguage(store.ui.language) }
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
    syncStatus.value = t('settings.model.apiAutoSaved')
    toast('success', t('settings.model.apiAutoSaved'))
  } catch (err) {
    toast('error', err instanceof Error ? err.message : t('settings.model.apiAutoSaveFailed'))
  } finally {
    inlineAutoSavingProviderId.value = ''
  }
}
function canFetchModelsForCard(provider: ProviderSummary): boolean { const key = inlineCredentialValue.value.trim(); return Boolean(key || provider.credentialPresent) }
async function onFetchModelsForProvider(provider: ProviderSummary, options: { silent?: boolean; autoAfterSave?: boolean } = {}) {
  const apiKey = inlineCredentialValue.value.trim()
  if (!apiKey && !provider.credentialPresent) { if (!options.silent) toast('warn', t('settings.model.enterApiKey')); return }
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
      fetchModelsMessage.value = t('settings.model.fetchModelsSuccess', { count: result.models.length })
      if (!options.silent) toast('success', fetchModelsMessage.value)
      const baseUrl2 = resolveInlineBaseUrl(provider, activeInlineProviderId(), inlineBaseUrl.value)
      const fetchedModels = normalizeModelOptions(provider, result.models, baseUrl2, provider.id)
      const idx = compatibleProviders.value.findIndex((p) => p.id === provider.id)
      if (idx >= 0) { const normalizedDefault = sanitizeModelIdForProvider(provider, compatibleProviders.value[idx].defaultModel || '', baseUrl2, provider.id); compatibleProviders.value[idx] = { ...compatibleProviders.value[idx], models: fetchedModels, defaultModel: fetchedModels[0]?.id || (normalizedDefault || undefined) || compatibleProviders.value[idx].defaultModel } }
      await store.loadProviders(); await loadCompatibleProviders()
      const refreshed = compatibleProviders.value.find((p) => p.id === provider.id); syncBindingModelIdFromProvider(refreshed)
      if (refreshed && bindingModelId.value) { const normalized = normalizeModelIdForProvider(refreshed, bindingModelId.value); const models = normalizeModelOptions(refreshed, refreshed.models || [], inlineBaseUrlForProvider(refreshed), refreshed.id); if (!models.some((m) => m.id === normalized)) bindingModelId.value = normalizeModelIdForProvider(refreshed, refreshed.defaultModel || models[0]?.id || ''); else bindingModelId.value = normalized } else if (!bindingModelId.value) bindingModelId.value = resolveBindingModelId(refreshed)
    } else { fetchModelsOk.value = false; fetchModelsMessage.value = result.error || t('settings.model.noModelsReturned'); if (!options.silent) toast('warn', fetchModelsMessage.value) }
  } catch (err) { fetchModelsOk.value = false; fetchModelsMessage.value = err instanceof Error ? err.message : t('settings.model.fetchModelsFailed'); if (!options.silent) toast('error', fetchModelsMessage.value) } finally { fetchingModelsId.value = '' }
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
    toast('error', err instanceof Error ? err.message : t('settings.model.saveVisibilityFailed'))
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
  return isConfiguredProviderModelHidden(provider, modelId) ? t('modelPicker.hiddenSuffix', { model: label }) : label
}
function selectProviderForEdit(provider: ProviderSummary) { bindingProviderId.value = provider.id; syncInlineFormFromProvider(provider); onBindingProviderChange() }
function toggleProviderExpand(providerId: string) { if (expandedProviderId.value === providerId) { expandedProviderId.value = ''; modelVisibilitySearch.value = ''; return } expandedProviderId.value = providerId; modelVisibilitySearch.value = ''; const provider = compatibleProviders.value.find((p) => p.id === providerId); if (provider) selectProviderForEdit(provider) }
function onProviderCardClick(provider: ProviderSummary) { toggleProviderExpand(provider.id) }
function applyAgentExecution() {
  agentExecForm.engine = DEFAULT_AGENT_EXECUTION_ENGINE; agentExecForm.bindings = { ...(store.agentExecution.bindings || {}) }
  const binding = store.bindingForEngine(agentExecForm.engine); bindingProviderId.value = binding?.providerId || ''; bindingModelId.value = binding?.modelId || ''; expandedProviderId.value = ''; syncInlineFormFromProvider()
  const boundProvider = compatibleProviders.value.find((p) => p.id === bindingProviderId.value); syncBindingModelIdFromProvider(boundProvider)
  syncStatus.value = store.agentExecution.lastSyncedAt ? t('settings.model.lastSync', { time: store.agentExecution.lastSyncedAt }) : null
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
async function onImportFromAddDialog() { await onSyncProviderSeeds(); if (availableToAddProviders.value.length) toast('info', t('settings.model.syncCompleteChooseProvider')) }
function onCustomProviderFromAddDialog() { showAddProviderDialog.value = false; onAddProviderClick() }
async function loadCompatibleProviders() {
  const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE
  try {
    const result = await store.listCompatibleProviders(engine); compatibleProviders.value = result.providers || []
    const configured = compatibleProviders.value.filter((p) => p.credentialPresent)
    if (bindingProviderId.value && !compatibleProviders.value.some((p) => p.id === bindingProviderId.value)) { bindingProviderId.value = configured[0]?.id || ''; bindingModelId.value = ''; if (expandedProviderId.value && !compatibleProviders.value.some((p) => p.id === expandedProviderId.value)) expandedProviderId.value = '' }
    if (bindingProviderId.value) { const provider = compatibleProviders.value.find((p) => p.id === bindingProviderId.value); syncBindingModelIdFromProvider(provider) }
    syncInlineFormFromProvider()
  } catch (err) { toast('error', err instanceof Error ? err.message : t('settings.model.loadCompatibleFailed')) }
}
function onBindingProviderChange() {
  const provider = selectedBindingProvider.value; syncBindingModelIdFromProvider(provider); const models = bindingModelOptions.value; const current = normalizeModelIdForProvider(provider, bindingModelId.value)
  if (!models.some((m) => m.id === current) && !isConfiguredProviderModelHidden(provider, current)) bindingModelId.value = normalizeModelIdForProvider(provider, models[0]?.id || '')
  else if (current !== bindingModelId.value) bindingModelId.value = current
  if (!expandedProviderId.value || expandedProviderId.value === bindingProviderId.value) syncInlineFormFromProvider(provider)
}
async function onActivateProvider(provider: ProviderSummary) {
  selectProviderForEdit(provider); expandedProviderId.value = provider.id; const resolvedModelId = resolveBindingModelId()
  if (!resolvedModelId) { toast('warn', t('settings.model.defaultModelRequired')); return }
  bindingModelId.value = resolvedModelId; activatingProviderId.value = provider.id
  try {
    await upsertInlineProviderConfig({ fetchModelsAfter: true }); const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const bindingEngine = resolveBindingStorageKeyUi(engine); const result = await store.activateInvocation(provider.id, resolvedModelId, engine)
    agentExecForm.bindings = { ...(agentExecForm.bindings || {}), [bindingEngine]: { providerId: provider.id, modelId: resolvedModelId } }; if (result.bindings) agentExecForm.bindings = { ...result.bindings }
    applyAgentExecution(); if (result.blocker) toast('warn', t('settings.model.boundSyncBlocked', { blocker: result.blocker })); else toast('success', t('settings.model.activatedSynced'))
  } catch (err) { toast('error', err instanceof Error ? err.message : t('settings.model.activateFailed')) } finally { activatingProviderId.value = '' }
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
    toast('success', t('settings.ui.saved'))
  } catch (err) {
    toast('error', err instanceof Error ? err.message : t('settings.ui.saveFailed'))
  }
}
async function onSaveModelEngine() {
  if (!bindingProviderId.value) { toast('warn', t('settings.model.noProviderSelected')); return }
  const resolvedModelId = resolveBindingModelId(); if (!resolvedModelId) { toast('warn', t('settings.model.defaultModelRequired')); return }
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
    syncStatus.value = store.agentExecution.lastSyncedAt ? t('settings.model.lastSync', { time: store.agentExecution.lastSyncedAt }) : t('settings.model.savedShort'); toast('success', t('settings.model.saved'))
  } catch (err) { toast('error', err instanceof Error ? err.message : t('settings.model.saveFailed')) }
}
async function onSavePermissions() { try { await store.savePermissions({ ...permForm }); toast('success', 'Permissions saved.') } catch (err) { toast('error', err instanceof Error ? err.message : 'Failed to save permissions.') } }
function onManageProviders() { activeName.value = 'providers' }
async function onSyncProviderSeeds() {
  importPresetsLoading.value = true; importPresetsMessage.value = null; importPresetsError.value = false
  try {
    const result = await store.syncProviderSeeds(); const imported = result.imported?.length || 0; const skipped = result.skipped?.length || 0; importPresetsMessage.value = formatProviderSeedSyncMessage(imported, result.clearedCount || 0, skipped, result.errors?.length || 0); if (imported > 0) toast('success', t('settings.model.syncProviderSuccess', { count: imported })); else toast('warn', t('settings.model.noProvidersSynced')); await loadCompatibleProviders(); applyAgentExecution()
  } catch (err) { importPresetsError.value = true; importPresetsMessage.value = err instanceof Error ? err.message : t('settings.model.syncFailed'); toast('error', importPresetsMessage.value) } finally { importPresetsLoading.value = false }
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
  if (!provider.credentialPresent && !inlineCredentialValue.value.trim()) { toast('warn', t('settings.model.enterApiKey')); return }
  testingProviderId.value = provider.id
  try { const result = await store.testProvider(provider.id, testOverridesForCard(provider)); if (result.ok) toast('success', t('settings.model.testSuccess', { latency: result.latencyMs ?? '—', model: result.model ? ` · ${result.model}` : '' })); else toast('error', t('settings.model.testFailed', { message: friendlyConnectionError(result.error) })) } catch (err) { toast('error', err instanceof Error ? err.message : t('settings.model.testConnectionFailed')) } finally { testingProviderId.value = '' }
}
async function onDeleteProviderCard(provider: ProviderSummary) {
  const confirmed = confirm(t('settings.model.deleteConfirm', { provider: providerDisplayName(provider) })); if (!confirmed) return
  deletingProviderId.value = provider.id
  try { await store.deleteProvider(provider.id); const engine = agentExecForm.engine || DEFAULT_AGENT_EXECUTION_ENGINE; const binding = agentExecForm.bindings?.[engine]; if (binding?.providerId === provider.id) { const nextBindings = { ...(agentExecForm.bindings || {}) }; delete nextBindings[engine]; await store.saveAgentExecution({ ...agentExecForm, bindings: nextBindings }) } if (expandedProviderId.value === provider.id) { expandedProviderId.value = ''; inlineCredentialValue.value = ''; inlineBaseUrl.value = '' } await loadCompatibleProviders(); applyAgentExecution(); toast('success', t('settings.model.deleted')) } catch (err) { toast('error', err instanceof Error ? err.message : t('settings.model.deleteFailed')) } finally { deletingProviderId.value = '' }
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
