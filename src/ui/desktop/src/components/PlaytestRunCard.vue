<template>
  <article class="playtest-card" :class="statusTone">
    <div class="playtest-head">
      <Gamepad2 :size="15" :stroke-width="1.7" aria-hidden="true" />
      <strong>{{ t('playtest.card.title') }}</strong>
      <span class="playtest-status">{{ statusLabel }}</span>
    </div>

    <div class="playtest-details">
      <span v-if="projectName">{{ projectName }}</span>
      <span v-if="pid">PID {{ pid }}</span>
      <span v-if="duration">{{ duration }}</span>
      <span v-if="exitCode !== null">exit={{ exitCode }}</span>
    </div>

    <p v-if="errorText" class="playtest-error">{{ errorText }}</p>
    <p class="playtest-source">{{ t('playtest.card.sourceOnly') }}</p>

    <div class="playtest-foot">
      <span>{{ t('playtest.card.lifecycleOnly') }}</span>
      <button
        v-if="runId && hasEvidence"
        type="button"
        class="evidence-button"
        :disabled="revealing"
        @click="revealEvidence"
      >
        <FolderSearch :size="13" :stroke-width="1.7" aria-hidden="true" />
        {{ t('playtest.card.revealEvidence') }}
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderSearch, Gamepad2 } from '@lucide/vue'
import { playtest } from '../api/client'
import { useI18n } from '../i18n'

const props = defineProps<{
  run: Record<string, unknown>
}>()

const { t } = useI18n()
const revealing = ref(false)
const runId = computed(() => String(props.run.runId || '').trim())
const status = computed(() => String(props.run.status || 'starting'))
const pid = computed(() => Number(props.run.pid) || 0)
const exitCode = computed(() => props.run.exitCode === null || props.run.exitCode === undefined
  ? null
  : Number(props.run.exitCode))
const errorText = computed(() => String(props.run.error || '').trim())
const hasEvidence = computed(() => Boolean(String(props.run.artifactPath || '').trim()))
const projectName = computed(() => {
  const project = String(props.run.project || '').replace(/[\\/]+$/, '')
  return project.split(/[\\/]/).pop() || ''
})
const duration = computed(() => {
  const milliseconds = Number(props.run.durationMs || 0)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return ''
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  const seconds = Math.round(milliseconds / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
})
const statusTone = computed(() => ({
  live: ['starting', 'running', 'stopping'].includes(status.value),
  success: status.value === 'exited',
  muted: status.value === 'stopped',
  failed: ['failed', 'stop_failed'].includes(status.value),
}))
const statusLabel = computed(() => {
  const labels: Record<string, ReturnType<typeof t>> = {
    starting: t('playtest.card.status.starting'),
    running: t('playtest.card.status.running'),
    stopping: t('playtest.card.status.stopping'),
    stopped: t('playtest.card.status.stopped'),
    exited: t('playtest.card.status.exited'),
    failed: t('playtest.card.status.failed'),
    stop_failed: t('playtest.card.status.stopFailed'),
  }
  return labels[status.value] || status.value
})

async function revealEvidence() {
  if (!runId.value || revealing.value) return
  revealing.value = true
  try {
    await playtest.reveal(runId.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(t('playtest.card.revealFailed', { message }))
  } finally {
    revealing.value = false
  }
}
</script>

<style scoped>
.playtest-card {
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--app-ink-muted);
  border-radius: var(--app-radius-md);
  padding: 10px 11px;
  background: var(--app-bg-soft);
  color: var(--app-ink);
  font-size: 12px;
}

.playtest-card.live { border-left-color: var(--el-color-warning); }
.playtest-card.success { border-left-color: var(--el-color-success); }
.playtest-card.failed { border-left-color: var(--el-color-danger); }

.playtest-head,
.playtest-details,
.playtest-foot,
.evidence-button {
  display: flex;
  align-items: center;
}

.playtest-head { gap: 7px; }
.playtest-head strong { font-size: 12.5px; font-weight: 600; }
.playtest-status {
  margin-left: auto;
  color: var(--app-ink-soft);
}

.playtest-details {
  gap: 10px;
  margin-top: 7px;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono);
  font-size: 11px;
}

.playtest-error {
  margin: 8px 0 0;
  color: var(--el-color-danger);
  line-height: 1.45;
}

.playtest-source {
  margin: 7px 0 0;
  color: var(--app-ink-soft);
  line-height: 1.45;
}

.playtest-foot {
  gap: 10px;
  margin-top: 8px;
  color: var(--app-ink-muted);
  line-height: 1.4;
}

.evidence-button {
  gap: 5px;
  margin-left: auto;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  white-space: nowrap;
}

.evidence-button:hover:not(:disabled) {
  color: var(--app-ink);
  background: var(--app-bg-sunken);
}

.evidence-button:disabled { opacity: 0.5; cursor: default; }
</style>
