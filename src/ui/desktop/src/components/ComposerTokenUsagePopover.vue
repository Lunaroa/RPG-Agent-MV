<template>
  <div class="token-usage-popover" data-ui-id="composer-token-usage">
    <div class="token-usage-title">{{ title }}</div>
    <div class="token-usage-percent">
      {{ t('slash.tokens.overlay.percent', {
        percent: formatNumber(data.contextPercent || 0),
      }) }}
    </div>
    <div class="token-usage-line">
      {{ t('slash.tokens.overlay.used', {
        used: formatCompactTokens(data.contextUsedTokens || 0),
        total: formatCompactTokens(data.contextWindowTokens || 0),
      }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'

interface ComposerTokenUsageData {
  contextUsedTokens?: number
  contextWindowTokens?: number
  contextPercent?: number
}

const props = defineProps<{
  data: ComposerTokenUsageData
}>()

const { t } = useI18n()

const title = computed(() => t('slash.tokens.overlay.title'))
const numberFormatter = new Intl.NumberFormat()

function formatNumber(value: number): string {
  return numberFormatter.format(Math.max(0, Math.trunc(value)))
}

function formatCompactTokens(value: number): string {
  const normalized = Math.max(0, Math.trunc(value))
  if (normalized >= 1000) return `${Math.round(normalized / 1000)}k`
  return formatNumber(normalized)
}
</script>

<style scoped>
.token-usage-popover {
  width: 252px;
  padding: 10px 14px 12px;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  background: var(--app-bg);
  box-shadow: 0 16px 38px rgb(15 23 42 / 12%);
  color: var(--app-ink);
  font-size: 13px;
  line-height: 1.55;
  text-align: center;
}

.token-usage-title {
  margin-bottom: 2px;
  color: var(--app-ink-muted);
  font-weight: 600;
}

.token-usage-percent {
  color: var(--app-ink-muted);
  font-size: 16px;
}

.token-usage-line {
  font-size: 14px;
  white-space: nowrap;
}
</style>
