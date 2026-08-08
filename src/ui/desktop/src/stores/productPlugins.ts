import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { productPlugin as productPluginApi } from '../api/client'
import {
  isProductPluginEnabled,
  normalizeProductPluginSettings,
  type ProductPluginId,
  type ProductPluginSettings,
} from '@contract/product-plugin'
import { useWorkspaceStore } from './workspace'
import {
  getProductPluginDefinition,
  PRODUCT_PLUGIN_REGISTRY,
} from '../utils/productPluginRegistry'

export const useProductPluginsStore = defineStore('productPlugins', () => {
  const workspace = useWorkspaceStore()
  const states = ref<ProductPluginSettings>({})
  const hydrated = ref(false)
  const loadError = ref<string | null>(null)
  const loading = ref(false)
  let loadPromise: Promise<void> | null = null
  let ipcLoaded = false

  function syncFromWorkspace(): void {
    states.value = normalizeProductPluginSettings(workspace.settings.productPlugins) || {}
  }

  async function load(): Promise<void> {
    if (ipcLoaded) return
    if (loadPromise) return loadPromise

    loading.value = true
    loadPromise = (async () => {
      if (!workspace.hydrated) await workspace.load()
      try {
        const result = await productPluginApi.list()
        if (result.error) throw new Error(result.error.code)
        states.value = {
          ...(normalizeProductPluginSettings(workspace.settings.productPlugins) || {}),
          ...Object.fromEntries(result.snapshot.map((entry) => [entry.id, entry.enabled])),
        }
        workspace.settings.productPlugins = states.value
        hydrated.value = true
        ipcLoaded = true
        loadError.value = null
      } catch {
        // A catalog/read failure must not block application startup; use the
        // persisted workspace snapshot until the independent IPC is healthy.
        syncFromWorkspace()
        loadError.value = 'product-plugin-load-failed'
        hydrated.value = true
      }
    })()
    try {
      await loadPromise
    } finally {
      loadPromise = null
      loading.value = false
    }
  }

  async function retry(): Promise<void> {
    ipcLoaded = false
    hydrated.value = false
    await load()
  }

  function isEnabled(id: ProductPluginId): boolean {
    return isProductPluginEnabled(states.value, id)
  }

  async function setEnabled(id: ProductPluginId, enabled: boolean): Promise<void> {
    if (!getProductPluginDefinition(id)) {
      throw new Error(`Unknown product plugin: ${id}`)
    }
    await load()
    const result = await productPluginApi.setEnabled({ id, enabled })
    if (!result.ok) throw new Error(result.error?.code || 'product-plugin persistence failed')
    states.value = result.settings
    workspace.settings.productPlugins = result.settings
    hydrated.value = true
  }

  const definitions = computed(() => PRODUCT_PLUGIN_REGISTRY)

  return {
    definitions,
    states,
    hydrated,
    loading,
    load,
    retry,
    loadError,
    syncFromWorkspace,
    isEnabled,
    setEnabled,
  }
})
