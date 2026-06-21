<template>
  <section class="event-preview">
    <button
      type="button"
      class="event-preview-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <el-icon class="event-preview-chevron" :class="{ open: expanded }"><ArrowRight /></el-icon>
      <span class="event-preview-summary">{{ summaryText }}</span>
    </button>

    <div v-show="expanded" class="event-preview-body">
      <div v-for="event in events" :key="event.contractId" class="epv-item">
        <button
          type="button"
          class="epv-row"
          :aria-expanded="isOpen(event.contractId)"
          @click="toggleEvent(event.contractId)"
        >
          <el-icon class="epv-chevron" :class="{ open: isOpen(event.contractId) }"><ArrowRight /></el-icon>
          <span class="epv-name">{{ event.eventName || event.contractId }}</span>
          <span v-if="event.summary" class="epv-summary">{{ event.summary }}</span>
        </button>

        <div v-show="isOpen(event.contractId)" class="epv-script">
          <p v-if="scriptStates[event.contractId]?.loading" class="epv-hint">{{ t('eventPreview.loading') }}</p>
          <p
            v-else-if="scriptStates[event.contractId]?.error"
            class="epv-hint epv-empty"
          >
            {{ scriptStates[event.contractId]?.error }}
          </p>
          <template v-else-if="scriptStates[event.contractId]?.model">
            <div
              v-for="page in scriptStates[event.contractId]?.model?.pages"
              :key="page.index"
              class="epv-page"
            >
              <div class="epv-pagehead">
                <span class="epv-trigger">{{ page.triggerLabel }}</span>
                <span v-if="page.conditionLabel" class="epv-cond">· {{ page.conditionLabel }}</span>
              </div>
              <div
                v-for="(line, li) in page.lines"
                :key="li"
                class="epv-line"
                :class="`sl-${line.kind}`"
                :style="{ paddingLeft: (line.indent * 18) + 'px' }"
              >
                <span v-if="line.icon" class="epv-icon">{{ line.icon }}</span>
                <span v-if="line.speaker" class="epv-speaker">{{ line.speaker }}</span>
                <span class="epv-text">{{ line.text }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { eventRegistry } from '../api/client'
import type { EventScriptModel } from '../utils/eventScript'
import type { EventPreviewItem } from '../composables/useSessionStream'
import { useI18n } from '../i18n'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'

const props = defineProps<{
  events: EventPreviewItem[]
}>()

const expanded = ref(true)
const openIds = reactive<Record<string, boolean>>({})
const { language, t } = useI18n()
const summaryText = computed(() =>
  t('eventPreview.summary', { count: props.events.length }),
)

// 放置前剧本预览：按 contractId 懒加载，展开时才取（与编译同源的后端渲染）。
interface ScriptState {
  loading: boolean
  loaded: boolean
  error?: string
  model?: EventScriptModel
}
const scriptStates = reactive<Record<string, ScriptState>>({})

function isOpen(contractId: string): boolean {
  return Boolean(openIds[contractId])
}

function toggleEvent(contractId: string): void {
  if (!contractId) return
  const next = !openIds[contractId]
  openIds[contractId] = next
  if (next) void loadEventScript(contractId)
}

async function loadEventScript(contractId: string): Promise<void> {
  const existing = scriptStates[contractId]
  if (existing && (existing.loading || existing.loaded)) return
  // 通过 reactive proxy 赋值，确保 await 之后的写入被 Vue 追踪并触发重绘。
  scriptStates[contractId] = { loading: true, loaded: false }
  try {
    const res = await eventRegistry.script(undefined, contractId)
    if (res.status === 'ok' && res.script) {
      scriptStates[contractId].model = res.script
    } else {
      scriptStates[contractId].error = t('eventPreview.noScript')
    }
  } catch (error) {
    scriptStates[contractId].error = formatUserFacingErrorMessage(error, 'general', language.value)
  } finally {
    scriptStates[contractId].loading = false
    scriptStates[contractId].loaded = true
  }
}

</script>

<style scoped>
.event-preview {
  min-width: 0;
}

/* 外层切换条：与 ExecutionGroup 同款无边框命令行风格 */
.event-preview-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 34px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-ink-muted);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease);
}

.event-preview-toggle:hover,
.event-preview-toggle:focus-visible {
  color: var(--app-ink);
  background: var(--app-bg-soft);
}

.event-preview-toggle:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.event-preview-chevron {
  flex: 0 0 auto;
  font-size: 12px;
  transition: transform var(--app-dur) var(--app-ease);
}

.event-preview-chevron.open {
  transform: rotate(90deg);
}

.event-preview-summary {
  min-width: 0;
  color: var(--app-ink-muted);
  line-height: 1.5;
}

.event-preview-body {
  display: flex;
  flex-direction: column;
  margin: 6px 0 4px 14px;
  padding: 4px 0 4px 14px;
  border-left: 2px solid var(--app-border);
}

/* 单个事件行：命令行式、可折叠、无边框 */
.epv-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease);
}

.epv-row:hover,
.epv-row:focus-visible {
  color: var(--app-ink);
  background: var(--app-bg-soft);
}

.epv-chevron {
  flex: 0 0 auto;
  font-size: 12px;
  transition: transform var(--app-dur) var(--app-ease);
}

.epv-chevron.open {
  transform: rotate(90deg);
}

.epv-name {
  flex: 0 0 auto;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.epv-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

/* 展开后的剧本（迁自 AskCard 的 .epl-script-*） */
.epv-script {
  margin: 2px 0 8px 20px;
  font-size: 14px;
}

.epv-hint {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.epv-empty {
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.epv-page + .epv-page {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--app-border);
}

.epv-pagehead {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--app-border);
}

.epv-cond {
  margin-left: 4px;
}

.epv-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.epv-icon {
  flex: 0 0 auto;
  font-size: 12px;
}

.epv-speaker {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.epv-speaker::after {
  content: '：';
}

.epv-text {
  white-space: pre-line;
}

/* 对白醒目，舞台/演出与状态变化弱化为辅助信息 */
.epv-line.sl-stage .epv-text,
.epv-line.sl-effect .epv-text,
.epv-line.sl-comment .epv-text {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.epv-line.sl-choice-prompt .epv-text,
.epv-line.sl-branch .epv-text {
  color: var(--el-color-primary);
  font-size: 12px;
}

.epv-line.sl-choice-option .epv-text {
  font-weight: 600;
}
</style>
