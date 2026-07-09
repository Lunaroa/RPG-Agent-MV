<template>
  <el-tooltip
    effect="dark"
    placement="top"
    :show-after="200"
    :disabled="!hasData"
    popper-class="context-usage-tooltip"
  >
    <template #content>
      <div class="context-usage-tooltip-body">
        <div class="context-usage-tooltip-title">{{ title }}</div>
        <div class="context-usage-tooltip-line">{{ percentLine }}</div>
        <div class="context-usage-tooltip-line">{{ usedLine }}</div>
      </div>
    </template>
    <span
      class="context-usage-ring"
      data-ui-id="context-usage-ring"
      :aria-label="ariaLabel"
      role="img"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle
          class="context-usage-ring-track"
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke-width="1.5"
        />
        <circle
          class="context-usage-ring-progress"
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke-width="1.5"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
          stroke-dashoffset="0"
          transform="rotate(-90 8 8)"
        />
      </svg>
    </span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'

const props = withDefaults(defineProps<{
  contextPercent?: number | null
  contextUsedTokens?: number | null
  contextWindowTokens?: number | null
}>(), {
  contextPercent: null,
  contextUsedTokens: null,
  contextWindowTokens: null,
})

const { t } = useI18n()

const CIRCUMFERENCE = 2 * Math.PI * 6.5
const numberFormatter = new Intl.NumberFormat()

const hasData = computed(() => (
  props.contextPercent !== null
  && props.contextPercent !== undefined
  && Number.isFinite(props.contextPercent)
  && props.contextUsedTokens !== null
  && props.contextUsedTokens !== undefined
  && Number.isFinite(props.contextUsedTokens)
  && props.contextWindowTokens !== null
  && props.contextWindowTokens !== undefined
  && Number.isFinite(props.contextWindowTokens)
  && (props.contextWindowTokens as number) > 0
))

const percent = computed(() => {
  if (!hasData.value) return 0
  return Math.max(0, Math.min(100, Math.round(props.contextPercent as number)))
})

const remaining = computed(() => Math.max(0, 100 - percent.value))

const usedTokens = computed(() => Math.max(0, Math.trunc(props.contextUsedTokens ?? 0)))
const windowTokens = computed(() => Math.max(0, Math.trunc(props.contextWindowTokens ?? 0)))

const dashArray = computed(() => {
  const filled = (percent.value / 100) * CIRCUMFERENCE
  return `${filled} ${CIRCUMFERENCE}`
})

const title = computed(() => t('slash.tokens.overlay.title'))

const percentLine = computed(() => t('slash.tokens.overlay.percentRemaining', {
  percent: percent.value,
  remaining: remaining.value,
}))

const usedLine = computed(() => t('slash.tokens.overlay.used', {
  used: formatCompactTokens(usedTokens.value),
  total: formatCompactTokens(windowTokens.value),
}))

const ariaLabel = computed(() => {
  if (!hasData.value) return title.value
  return `${title.value} ${percentLine.value} ${usedLine.value}`
})

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
.context-usage-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 32px;
  flex-shrink: 0;
  color: var(--app-ink-soft);
}

.context-usage-ring-track {
  stroke: var(--app-border);
}

.context-usage-ring-progress {
  stroke: var(--app-ink-soft);
  transition: stroke-dasharray 0.25s ease;
}

.context-usage-tooltip-body {
  text-align: left;
  line-height: 1.45;
}

.context-usage-tooltip-title {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 500;
}

.context-usage-tooltip-line {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
</style>
