<script setup lang="ts">
import { Brush, Edit, Grid, MapLocation, Picture } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProductPluginDirtyAction } from '../utils/productPluginLifecycle'
import {
  requestProductPluginDisable,
} from '../utils/productPluginLifecycle'
import { useI18n } from '../i18n'
import { useProductPluginsStore } from '../stores/productPlugins'
import { getProductPluginDefinition } from '../utils/productPluginRegistry'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const productPlugins = useProductPluginsStore()
const busyId = ref<string | null>(null)
const error = ref('')
const errorTitle = ref('')

const definitions = computed(() => productPlugins.definitions)
const iconMap = { Brush, Edit, Grid, MapLocation, Picture }
const disabledRedirect = computed(() => (
  route.query.reason === 'disabled'
  && typeof route.query.plugin === 'string'
  && Boolean(getProductPluginDefinition(route.query.plugin))
))

function safeProductPluginRedirect(value: unknown, pluginId: string): string | null {
  const definition = getProductPluginDefinition(pluginId)
  if (!definition) return null
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin !== window.location.origin || parsed.pathname !== definition.route) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

onMounted(async () => {
  try {
    await productPlugins.load()
    if (disabledRedirect.value) ElMessage.info(t('productPlugin.redirect.disabled'))
  } catch (loadError) {
    errorTitle.value = t('productPlugin.load.failed')
    error.value = loadError instanceof Error ? loadError.message : String(loadError)
  }
})

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function iconFor(icon: string) {
  return iconMap[icon as keyof typeof iconMap] || Brush
}

async function chooseDirtyAction(): Promise<ProductPluginDirtyAction> {
  try {
    await ElMessageBox.confirm(
      t('productPlugin.lifecycle.message'),
      t('productPlugin.lifecycle.title'),
      {
        type: 'warning',
        distinguishCancelAndClose: true,
        confirmButtonText: t('productPlugin.lifecycle.saveAndDisable'),
        cancelButtonText: t('productPlugin.lifecycle.discardAndDisable'),
        closeOnClickModal: false,
      },
    )
    return 'save'
  } catch (action) {
    const value = typeof action === 'string'
      ? action
      : (action as { action?: string } | null)?.action
    return value === 'cancel' ? 'discard' : 'cancel'
  }
}

async function toggle(pluginId: string): Promise<void> {
  const definition = getProductPluginDefinition(pluginId)
  if (!definition || busyId.value) return

  const enabled = productPlugins.isEnabled(pluginId)
  busyId.value = pluginId
  error.value = ''
  errorTitle.value = ''
  try {
    if (enabled) {
      const lifecycle = await requestProductPluginDisable(pluginId, chooseDirtyAction)
      if (!lifecycle.allowed) {
        if (lifecycle.reason === 'save-failed') ElMessage.error(t('productPlugin.lifecycle.saveFailed'))
        else if (lifecycle.reason === 'discard-failed') ElMessage.error(t('productPlugin.lifecycle.discardFailed'))
        return
      }
    }

    await productPlugins.setEnabled(pluginId, !enabled)
    if (enabled) {
      await router.replace({ path: '/plugin-marketplace', query: { changed: 'disabled' } })
    } else {
      const redirect = safeProductPluginRedirect(route.query.from, pluginId)
      if (redirect) await router.replace(redirect)
      else ElMessage.success(t('productPlugin.status.enabled'))
    }
  } catch (toggleError) {
    const message = errorMessage(toggleError)
    errorTitle.value = t('productPlugin.toggle.failed')
    error.value = message
    ElMessage.error(errorTitle.value)
  } finally {
    busyId.value = null
  }
}

async function open(pluginId: string): Promise<void> {
  const definition = getProductPluginDefinition(pluginId)
  if (!definition || !productPlugins.isEnabled(pluginId)) return
  await router.push(definition.route)
}
</script>

<template>
  <section class="product-plugin-page" data-ui-id="plugin-marketplace" data-testid="plugin-marketplace">
    <header class="product-plugin-header">
      <div>
        <h1>{{ t('productPlugin.marketplace.title') }}</h1>
        <p>{{ t('productPlugin.marketplace.subtitle') }}</p>
      </div>
      <el-tag type="info" effect="plain">{{ t('productPlugin.marketplace.localOnly') }}</el-tag>
    </header>

    <el-alert
      v-if="error"
      class="product-plugin-alert"
      type="error"
      :closable="false"
      :title="errorTitle || t('error.operationFailed')"
    >
      <details class="product-plugin-error-detail">
        <summary>{{ t('productPlugin.error.technicalDetails') }}</summary>
        <span>{{ error }}</span>
      </details>
    </el-alert>
    <el-alert
      v-if="productPlugins.loadError"
      class="product-plugin-alert"
      type="warning"
      :closable="false"
      :title="t('productPlugin.load.failed')"
    >
      <el-button link type="primary" data-ui-id="plugin-marketplace-retry" data-testid="plugin-marketplace-retry" @click="productPlugins.retry()">
        {{ t('productPlugin.action.retry') }}
      </el-button>
    </el-alert>

    <div class="product-plugin-grid">
      <el-card
        v-for="plugin in definitions"
        :key="plugin.id"
        class="product-plugin-card"
        shadow="never"
        :data-ui-id="`plugin-marketplace-card-${plugin.id}`"
        :data-testid="`plugin-marketplace-card-${plugin.id}`"
      >
        <div class="product-plugin-card-head">
          <div class="product-plugin-icon" aria-hidden="true">
            <component :is="iconFor(plugin.icon)" />
          </div>
          <div class="product-plugin-copy">
            <h2>{{ t(plugin.titleKey) }}</h2>
            <p>{{ t(plugin.descriptionKey) }}</p>
          </div>
          <el-tag
            :type="productPlugins.isEnabled(plugin.id) ? 'success' : 'info'"
            effect="plain"
          >
            {{ productPlugins.isEnabled(plugin.id)
              ? t('productPlugin.status.enabled')
              : t('productPlugin.status.disabled') }}
          </el-tag>
        </div>

        <div class="product-plugin-actions">
          <el-button
            v-if="productPlugins.isEnabled(plugin.id)"
            :loading="busyId === plugin.id"
            :data-ui-id="`plugin-marketplace-disable-${plugin.id}`"
            :data-testid="`plugin-marketplace-disable-${plugin.id}`"
            @click="toggle(plugin.id)"
          >
            {{ t('productPlugin.action.disable') }}
          </el-button>
          <el-button
            v-else
            type="primary"
            :loading="busyId === plugin.id"
            :data-ui-id="`plugin-marketplace-enable-${plugin.id}`"
            :data-testid="`plugin-marketplace-enable-${plugin.id}`"
            @click="toggle(plugin.id)"
          >
            {{ t('productPlugin.action.enable') }}
          </el-button>
          <el-button
            link
            :disabled="!productPlugins.isEnabled(plugin.id) || busyId === plugin.id"
            :data-ui-id="`plugin-marketplace-open-${plugin.id}`"
            :data-testid="`plugin-marketplace-open-${plugin.id}`"
            @click="open(plugin.id)"
          >
            {{ t('productPlugin.action.open') }}
          </el-button>
        </div>
      </el-card>
    </div>
  </section>
</template>

<style scoped>
.product-plugin-page {
  min-height: 100%;
  overflow: auto;
  padding: 28px 32px 40px;
  background: var(--app-bg-page);
  color: var(--app-ink);
}

.product-plugin-header {
  max-width: 960px;
  margin: 0 auto 22px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.product-plugin-header h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
}

.product-plugin-header p {
  margin: 7px 0 0;
  color: var(--app-ink-soft);
  font-size: 13px;
}

.product-plugin-grid {
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.product-plugin-card {
  border-color: var(--app-border);
  background: var(--app-bg);
}

.product-plugin-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.product-plugin-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: var(--app-radius-md);
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.product-plugin-icon :deep(svg) {
  width: 19px;
  height: 19px;
}

.product-plugin-copy {
  flex: 1 1 auto;
  min-width: 0;
}

.product-plugin-copy h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.35;
}

.product-plugin-copy p {
  margin: 6px 0 0;
  color: var(--app-ink-soft);
  font-size: 12px;
  line-height: 1.5;
}

.product-plugin-actions {
  margin-top: 22px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.product-plugin-alert {
  max-width: 960px;
  margin: 0 auto 16px;
}

.product-plugin-error-detail {
  color: var(--app-ink-soft);
  font-size: 11px;
}

@media (max-width: 680px) {
  .product-plugin-page {
    padding: 20px 16px 28px;
  }

  .product-plugin-header {
    flex-direction: column;
  }
}
</style>
