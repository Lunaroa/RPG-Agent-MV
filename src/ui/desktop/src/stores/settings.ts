import { defineStore } from 'pinia';
import { ref } from 'vue';
import { DEFAULT_AGENT_EXECUTION_ENGINE } from '@contract/types';
import {
  settings as settingsApi,
  sessions,
  type AgentExecutionSettings,
  type ActivateInvocationResult,
  type EngineProviderBinding,
  type PermissionSettings,
  type ProviderSummary,
  type ProbeAgentExecutionResult,
  type UiSettings,
  type TestResult,
  type FetchModelsResult,
  type AgentCapabilitiesSnapshot,
} from '../api/client';
import { normalizeProductLanguage, translate } from '../i18n/messages';

function normalizeAgentExecutionSettings(raw: AgentExecutionSettings | null | undefined): AgentExecutionSettings {
  const source = raw || { engine: DEFAULT_AGENT_EXECUTION_ENGINE };
  const bindings = source.bindings as Record<string, EngineProviderBinding | undefined> | undefined;
  const currentBinding = bindings?.[DEFAULT_AGENT_EXECUTION_ENGINE];
  const normalizedBindings = currentBinding
    ? { [DEFAULT_AGENT_EXECUTION_ENGINE]: currentBinding }
    : undefined;
  return {
    ...source,
    engine: DEFAULT_AGENT_EXECUTION_ENGINE,
    bindings: normalizedBindings,
  };
}

export const useSettingsStore = defineStore('settings', () => {
  const providers = ref<ProviderSummary[]>([]);
  const ui = ref<UiSettings>({});
  const permissions = ref<PermissionSettings>({});
  const agentExecution = ref<AgentExecutionSettings>({ engine: DEFAULT_AGENT_EXECUTION_ENGINE });
  const agentCapabilities = ref<AgentCapabilitiesSnapshot | null>(null);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  async function loadUi() {
    loading.value = true;
    lastError.value = null;
    try {
      ui.value = (await settingsApi.getUi()) || {};
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadAll() {
    loading.value = true;
    lastError.value = null;
    try {
      const [providerPayload, uiPayload, permPayload, agentExecPayload] = await Promise.all([
        settingsApi.listProviders(),
        settingsApi.getUi(),
        settingsApi.getPermissions(),
        settingsApi.getAgentExecution(),
      ]);
      providers.value = providerPayload.providers || [];
      ui.value = uiPayload || {};
      permissions.value = permPayload || {};
      agentExecution.value = normalizeAgentExecutionSettings(agentExecPayload);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function loadProviders() {
    loading.value = true;
    lastError.value = null;
    try {
      const providerPayload = await settingsApi.listProviders();
      providers.value = providerPayload.providers || [];
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function saveUi(next: UiSettings) {
    loading.value = true;
    lastError.value = null;
    try {
      const saved = await settingsApi.putUi(next);
      ui.value = saved || next;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function savePermissions(next: PermissionSettings) {
    loading.value = true;
    lastError.value = null;
    try {
      const saved = await settingsApi.putPermissions(next);
      permissions.value = saved || next;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function testProvider(
    id: string,
    overrides?: { apiKey?: string; baseUrl?: string; model?: string },
  ): Promise<TestResult> {
    loading.value = true;
    lastError.value = null;
    try {
      return await settingsApi.testProvider(id, overrides);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteProvider(id: string) {
    loading.value = true;
    lastError.value = null;
    try {
      await settingsApi.deleteProvider(id);
      await loadProviders();
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadAgentExecution() {
    agentExecution.value = normalizeAgentExecutionSettings(await settingsApi.getAgentExecution());
  }

  async function saveAgentExecution(next: AgentExecutionSettings) {
    loading.value = true;
    lastError.value = null;
    try {
      const saved = await settingsApi.putAgentExecution(normalizeAgentExecutionSettings(next));
      agentExecution.value = normalizeAgentExecutionSettings(saved || next);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function probeAgentExecution(
    partial: AgentExecutionSettings = {},
  ): Promise<ProbeAgentExecutionResult> {
    return settingsApi.probeAgentExecution({ ...agentExecution.value, ...partial });
  }

  async function previewAgentDispatch(
    partial: AgentExecutionSettings = {},
    profileId?: string,
  ): Promise<Record<string, unknown>> {
    const engine = partial.engine || agentExecution.value.engine || DEFAULT_AGENT_EXECUTION_ENGINE;
    return sessions.preview({
      executionEngine: engine,
      profileId,
      intent: translate('settings.intent.previewDispatch', normalizeProductLanguage(ui.value.language)),
      productLanguage: normalizeProductLanguage(ui.value.language),
      project: 'projects/Project',
    }) as Promise<Record<string, unknown>>;
  }

  async function listCompatibleProviders(engine?: string) {
    return settingsApi.listCompatibleProviders(engine);
  }

  async function activateInvocation(
    providerId: string,
    modelId: string,
    engine?: string,
  ): Promise<ActivateInvocationResult> {
    const resolvedEngine = engine || agentExecution.value.engine || DEFAULT_AGENT_EXECUTION_ENGINE;
    const result = await settingsApi.activateInvocation({
      engine: resolvedEngine,
      providerId,
      modelId,
    });
    await loadAgentExecution();
    return result;
  }

  function bindingForEngine(engine?: string): EngineProviderBinding | undefined {
    const id = engine || agentExecution.value.engine || DEFAULT_AGENT_EXECUTION_ENGINE;
    return agentExecution.value.bindings?.[id as keyof typeof agentExecution.value.bindings];
  }

  async function syncProviderSeeds() {
    loading.value = true;
    lastError.value = null;
    try {
      const result = await settingsApi.syncProviderSeeds();
      await loadProviders();
      await loadAgentExecution();
      return result;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadAgentCapabilities() {
    loading.value = true;
    lastError.value = null;
    try {
      agentCapabilities.value = await settingsApi.getAgentCapabilities();
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function saveAgentToolAllow(toolId: string, allowed: boolean) {
    loading.value = true;
    lastError.value = null;
    try {
      agentCapabilities.value = await settingsApi.putAgentToolAllow({ toolId, allowed });
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function saveMcpServerEnabled(serverId: string, enabled: boolean) {
    loading.value = true;
    lastError.value = null;
    try {
      agentCapabilities.value = await settingsApi.putMcpServerEnabled({ serverId, enabled });
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function saveAgentSkillEnabled(skillPath: string, enabled: boolean) {
    loading.value = true;
    lastError.value = null;
    try {
      agentCapabilities.value = await settingsApi.putAgentSkillEnabled({ skillPath, enabled });
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function openCapabilityPath(filePath: string) {
    await settingsApi.openCapabilityPath(filePath);
  }

  async function fetchModels(
    id: string,
    overrides?: { apiKey?: string; baseUrl?: string; persist?: boolean },
  ): Promise<FetchModelsResult> {
    loading.value = true;
    lastError.value = null;
    try {
      return await settingsApi.fetchModels(id, overrides);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    providers,
    ui,
    permissions,
    agentExecution,
    agentCapabilities,
    loading,
    lastError,
    loadAll,
    loadUi,
    loadAgentCapabilities,
    saveAgentToolAllow,
    saveMcpServerEnabled,
    saveAgentSkillEnabled,
    openCapabilityPath,
    loadProviders,
    loadAgentExecution,
    saveUi,
    savePermissions,
    saveAgentExecution,
    probeAgentExecution,
    previewAgentDispatch,
    listCompatibleProviders,
    activateInvocation,
    bindingForEngine,
    testProvider,
    deleteProvider,
    fetchModels,
    syncProviderSeeds,
  };
});
