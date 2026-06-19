<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { eventRegistry } from '../../api/client'
import { useEventPlacementAskStore, type PlacementListEvent } from '../../stores/eventPlacementAsk'
import { useProjectStore } from '../../stores/project'
import { isPlacedStatus } from '../../utils/placementStatus'
import type { PlacementReviewDecision } from '../../utils/placementReviewResult'
import type { EventScriptModel } from '../../utils/eventScript'

interface ScriptState {
  loading: boolean
  loaded: boolean
  error?: string
  model?: EventScriptModel
}

const placementAsk = useEventPlacementAskStore()
const projectStore = useProjectStore()
const scriptStates = reactive<Record<string, ScriptState>>({})
/** 侧栏编辑态：正在为哪个事件编辑调整批注（contractId）。空串=未在编辑。 */
const editingContractId = ref('')
const editingText = ref('')
const reviewBusy = ref(false)

const events = computed(() => (
  placementAsk.isReviewMode ? placementAsk.reviewingEvents : placementAsk.placeableEvents
))
const pendingCount = computed(() => placementAsk.pendingCount)
const isReviewMode = computed(() => placementAsk.isReviewMode)
const selectedEvent = computed(() => {
  const selectedId = placementAsk.activeContractId
  return events.value.find((event) => event.contractId === selectedId)
    || events.value.find((event) => !isPlaced(event))
    || events.value[0]
    || null
})
const selectedContractId = computed(() => selectedEvent.value?.contractId || '')
const selectedIsReviewing = computed(() => selectedEvent.value?.status === 'reviewing')
/** 选中事件已暂存的决策（编辑台态）。 */
const selectedDecision = computed<PlacementReviewDecision | undefined>(() => (
  selectedContractId.value ? placementAsk.decisionFor(selectedContractId.value) : undefined
))
const selectedIsEditing = computed(() => (
  Boolean(selectedContractId.value) && editingContractId.value === selectedContractId.value
))

function isPlaced(event: PlacementListEvent): boolean {
  return isPlacedStatus(event.status)
}

function statusLabel(event: PlacementListEvent): string {
  if (event.status === 'reviewing') return '待确认'
  if (isPlaced(event)) return '已放置'
  if (event.status === 'rejected') return '已拒绝'
  if (event.status === 'abandoned') return '已弃用'
  return '待放置'
}

const stateLabel = computed(() => {
  if (isReviewMode.value) {
    return pendingCount.value ? `${pendingCount.value} 个待确认` : '暂无待确认'
  }
  return pendingCount.value ? `${pendingCount.value} 个待放置` : '暂无待放置'
})

function mapLabel(mapId: number | null | undefined): string {
  return Number.isInteger(mapId) && mapId! > 0
    ? `Map${String(mapId).padStart(3, '0')}`
    : '未指定地图'
}

function cardSubtitle(event: PlacementListEvent): string {
  return event.summary?.trim()
    || event.placementHint?.trim()
    || ''
}

function selectEvent(contractId: string): void {
  if (!contractId) return
  placementAsk.selectContract(contractId)
}

function ensureSelection(): void {
  if (!events.value.length) return
  if (events.value.some((event) => event.contractId === placementAsk.activeContractId)) return
  const next = events.value.find((event) => !isPlaced(event)) || events.value[0]
  if (next) placementAsk.selectContract(next.contractId)
}

async function refresh(): Promise<void> {
  try {
    if (!placementAsk.isReviewMode || placementAsk.reviewingCount === 0) {
      const synced = await placementAsk.syncReviewingFromRegistry(projectStore.currentProject)
      if (synced.length) {
        ensureSelection()
        return
      }
    }
    await placementAsk.refreshFromRegistry(projectStore.currentProject)
    ensureSelection()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '刷新待放置事件失败')
  }
}

// 确认：立即写后端注册表并移入放置队列。
// 拒绝/调整：只暂存到本地，提交统一走 ASK 卡片。
async function approveSelectedReview(): Promise<void> {
  if (reviewBusy.value) return
  const event = selectedEvent.value
  if (!event || event.status !== 'reviewing') return
  reviewBusy.value = true
  try {
    const result = await eventRegistry.approve(projectStore.currentProject, event.contractId)
    if (result.status !== 'ok') {
      throw new Error('批准失败')
    }
    placementAsk.setPendingDecision(event.contractId, 'approve')
    await placementAsk.markReviewEventApproved(event.contractId, projectStore.currentProject)
    cancelEditing()
    ElMessage.success('已确认，进入放置队列')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认失败，请重试')
  } finally {
    reviewBusy.value = false
  }
}

function rejectSelectedReview(): void {
  const event = selectedEvent.value
  if (!event || event.status !== 'reviewing') return
  placementAsk.setPendingDecision(event.contractId, 'reject')
  cancelEditing()
  ElMessage.success('已记录：拒绝')
}

function beginAdjustSelectedReview(): void {
  const event = selectedEvent.value
  if (!event || event.status !== 'reviewing') return
  editingContractId.value = event.contractId
  // 已存过批注则预填，支持重新编辑
  editingText.value = placementAsk.feedbackFor(event.contractId)
}

function cancelEditing(): void {
  editingContractId.value = ''
  editingText.value = ''
}

// 保存调整批注：只写本地暂存，覆盖旧的批注（可反复修改）。
function saveSelectedAdjustment(): void {
  const event = selectedEvent.value
  if (!event || event.status !== 'reviewing') return
  placementAsk.setPendingDecision(event.contractId, 'revise', editingText.value)
  cancelEditing()
  ElMessage.success('已保存批注')
}

// 撤销已暂存的决策，回到未决策态。
function clearSelectedDecision(): void {
  const contractId = selectedContractId.value
  if (!contractId) return
  placementAsk.setPendingDecision(contractId, null)
  cancelEditing()
}

function decisionBadge(event: PlacementListEvent): string {
  const decision = placementAsk.decisionFor(event.contractId)
  if (decision === 'approve') return '✓ 确认'
  if (decision === 'reject') return '✗ 拒绝'
  if (decision === 'revise') return '✎ 调整'
  return ''
}

async function loadEventScript(contractId: string): Promise<void> {
  if (!contractId) return
  const existing = scriptStates[contractId]
  if (existing && (existing.loading || existing.loaded)) return
  scriptStates[contractId] = { loading: true, loaded: false }
  try {
    const res = await eventRegistry.script(projectStore.currentProject, contractId)
    if (res.status === 'ok' && res.script) {
      scriptStates[contractId].model = res.script
    } else {
      scriptStates[contractId].error = '这个事件还没有登记正文。'
    }
  } catch (error) {
    scriptStates[contractId].error = error instanceof Error ? error.message : '读取事件内容失败'
  } finally {
    scriptStates[contractId].loading = false
    scriptStates[contractId].loaded = true
  }
}

watch(
  () => events.value.map((event) => event.contractId).join('\n'),
  () => ensureSelection(),
  { immediate: true },
)

watch(
  selectedContractId,
  (contractId) => {
    cancelEditing()
    if (contractId) void loadEventScript(contractId)
  },
  { immediate: true },
)

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="placement-panel">
    <div class="pp-toolbar">
      <span class="pp-state">{{ stateLabel }}</span>
      <button type="button" class="pp-icon-button" title="刷新" @click="refresh">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <p v-if="!events.length" class="pp-empty">Agent 给出事件后会显示在这里。</p>

    <template v-else>
      <div class="pp-gallery">
        <button
          v-for="event in events"
          :key="event.contractId"
          type="button"
          class="pp-card"
          :class="{ active: event.contractId === selectedContractId }"
          @click="selectEvent(event.contractId)"
        >
          <strong>{{ event.eventName || event.contractId }}</strong>
          <small v-if="cardSubtitle(event)">{{ cardSubtitle(event) }}</small>
          <span v-if="decisionBadge(event)" class="pp-decision-badge">{{ decisionBadge(event) }}</span>
        </button>
      </div>

      <section v-if="selectedEvent" class="pp-detail">
        <div class="pp-detail-head">
          <div class="pp-detail-title">
            <div>
              <strong>{{ selectedEvent.eventName || selectedEvent.contractId }}</strong>
              <small>{{ selectedEvent.contractId }}</small>
            </div>
          </div>
          <span>{{ statusLabel(selectedEvent) }}</span>
        </div>
        <p v-if="isReviewMode" class="pp-review-note">
          确认后进入待放置队列；拒绝后不再放置；调整会交回 Agent。
        </p>
        <div v-if="isReviewMode && selectedIsReviewing" class="pp-review-actions">
          <div v-if="!selectedDecision" class="pp-review-buttons">
            <button
              type="button"
              class="pp-action pp-action-primary"
              data-ui-id="placement-review-approve"
              :disabled="reviewBusy"
              @click="approveSelectedReview"
            >
              确认
            </button>
            <button
              type="button"
              class="pp-action pp-action-danger"
              data-ui-id="placement-review-reject"
              :disabled="reviewBusy"
              @click="rejectSelectedReview"
            >
              拒绝
            </button>
            <button
              type="button"
              class="pp-action pp-action-warning"
              data-ui-id="placement-review-adjust"
              :disabled="reviewBusy"
              @click="beginAdjustSelectedReview"
            >
              调整
            </button>
          </div>
          <div v-if="selectedIsEditing" class="pp-adjust-box">
            <textarea
              v-model="editingText"
              class="pp-review-input"
              rows="3"
              placeholder="告诉 Agent 这个事件哪里要改（可选）"
              data-ui-id="placement-review-adjust-input"
              :disabled="reviewBusy"
            />
            <div class="pp-adjust-buttons">
              <button
                type="button"
                class="pp-action"
                data-ui-id="placement-review-adjust-cancel"
                :disabled="reviewBusy"
                @click="cancelEditing"
              >
                取消
              </button>
              <button
                type="button"
                class="pp-action pp-action-primary"
                data-ui-id="placement-review-adjust-submit"
                :disabled="reviewBusy"
                @click="saveSelectedAdjustment"
              >
                保存
              </button>
            </div>
          </div>
          <div v-else-if="selectedDecision" class="pp-decision-info">
            <span class="pp-decision-label">{{ decisionBadge(selectedEvent) }}</span>
            <button
              type="button"
              class="pp-action"
              @click="clearSelectedDecision"
            >
              撤销
            </button>
          </div>
        </div>

        <dl class="pp-facts">
          <div>
            <dt>{{ isPlaced(selectedEvent) ? '地图' : '建议地图' }}</dt>
            <dd>
              {{ mapLabel(selectedEvent.targetMapId) }}
              <template v-if="isPlaced(selectedEvent) && selectedEvent.x != null && selectedEvent.y != null">
                ({{ selectedEvent.x }}, {{ selectedEvent.y }})
              </template>
            </dd>
          </div>
          <div v-if="selectedEvent.trigger">
            <dt>触发</dt>
            <dd>{{ selectedEvent.trigger }}</dd>
          </div>
          <div v-if="selectedEvent.sceneId">
            <dt>场景</dt>
            <dd>{{ selectedEvent.sceneId }}</dd>
          </div>
          <div v-if="selectedEvent.summary">
            <dt>概要</dt>
            <dd>{{ selectedEvent.summary }}</dd>
          </div>
          <div v-if="selectedEvent.placementHint">
            <dt>放置提示</dt>
            <dd>{{ selectedEvent.placementHint }}</dd>
          </div>
        </dl>

        <div class="pp-script">
          <p v-if="scriptStates[selectedContractId]?.loading" class="pp-hint">读取中...</p>
          <p v-else-if="scriptStates[selectedContractId]?.error" class="pp-hint">{{ scriptStates[selectedContractId]?.error }}</p>
          <template v-else-if="scriptStates[selectedContractId]?.model">
            <div
              v-for="page in scriptStates[selectedContractId]?.model?.pages"
              :key="page.index"
              class="pp-page"
            >
              <div class="pp-pagehead">
                <span>{{ page.triggerLabel }}</span>
                <span v-if="page.conditionLabel"> · {{ page.conditionLabel }}</span>
              </div>
              <div
                v-for="(line, lineIndex) in page.lines"
                :key="lineIndex"
                class="pp-line"
                :class="`sl-${line.kind}`"
                :style="{ paddingLeft: `${line.indent * 14}px` }"
              >
                <span v-if="line.icon" class="pp-line-icon">{{ line.icon }}</span>
                <span v-if="line.speaker" class="pp-speaker">{{ line.speaker }}</span>
                <span class="pp-line-text">{{ line.text }}</span>
              </div>
            </div>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.placement-panel {
  padding: 8px 10px 12px;
}

.pp-toolbar {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
}

.pp-state,
.pp-empty,
.pp-hint,
.pp-review-note {
  margin: 0;
  color: var(--app-ink-muted);
  font-size: 12px;
}

.pp-state {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-icon-button {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.pp-icon-button:hover {
  background: var(--app-bg-elevated);
  color: var(--app-ink);
}

.pp-icon-button :deep(svg) {
  width: 13px;
  height: 13px;
}

.pp-gallery {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.pp-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease),
    box-shadow var(--app-dur) var(--app-ease);
}

.pp-card:hover {
  border-color: var(--app-border-strong);
  background: var(--app-bg-sunken);
}

.pp-card.active {
  border-color: var(--app-accent);
  box-shadow: inset 0 0 0 1px var(--app-accent);
  background: var(--app-accent-soft);
}

.pp-card:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.pp-card strong,
.pp-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-card strong {
  font-size: 12px;
  font-weight: 650;
  color: var(--app-ink);
}

.pp-card small {
  font-size: 11px;
  color: var(--app-ink-muted);
}

.pp-detail-title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.pp-detail-title strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: var(--app-ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-detail-title small {
  display: block;
  overflow: hidden;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-list {
  display: grid;
  gap: 6px;
}

.pp-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.pp-detail-head span {
  flex: 0 0 auto;
  color: var(--app-ink-muted);
  font-size: 11px;
}

.pp-review-note {
  margin-bottom: 8px;
}

.pp-review-actions {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}

.pp-adjust-box {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
}

.pp-review-input {
  width: 100%;
  min-height: 64px;
  resize: vertical;
  padding: 7px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  outline: none;
}

.pp-review-input:focus {
  border-color: var(--app-accent);
  box-shadow: var(--app-ring);
}

.pp-review-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pp-adjust-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.pp-action {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-elevated);
  color: var(--app-ink-soft);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.pp-action:disabled,
.pp-review-input:disabled {
  cursor: wait;
  opacity: .55;
}

.pp-action-primary {
  border-color: var(--app-accent);
  background: var(--app-accent);
  color: var(--app-accent-ink);
}

.pp-action-danger {
  color: var(--app-danger);
  border-color: var(--app-danger-soft);
}

.pp-action-danger:hover:not(:disabled) {
  background: var(--app-danger-soft);
}

.pp-action-warning {
  color: var(--app-warn);
  border-color: color-mix(in srgb, var(--app-warn) 34%, var(--app-border));
}

.pp-action-warning:hover:not(:disabled) {
  background: var(--app-warn-soft);
}

.pp-decision-badge {
  display: inline-block;
  margin-top: 2px;
  padding: 0 5px;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-sunken);
  color: var(--app-ink-muted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.6;
}

.pp-decision-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pp-decision-label {
  color: var(--app-ink-muted);
  font-size: 12px;
  font-weight: 600;
}

.pp-facts {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
}

.pp-facts div {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 8px;
}

.pp-facts dt,
.pp-facts dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.pp-facts dt {
  color: var(--app-ink-muted);
}

.pp-facts dd {
  min-width: 0;
  color: var(--app-ink-soft);
  overflow-wrap: anywhere;
}

.pp-script {
  display: grid;
  gap: 12px;
}

.pp-page + .pp-page {
  padding-top: 12px;
  border-top: 1px dashed var(--app-border);
}

.pp-pagehead {
  margin-bottom: 7px;
  color: var(--app-ink-muted);
  font-size: 11px;
}

.pp-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--app-ink-soft);
  font-size: 12px;
  line-height: 1.65;
}

.pp-line-icon,
.pp-speaker {
  flex: 0 0 auto;
}

.pp-speaker {
  color: var(--app-ink);
  font-weight: 650;
}

.pp-speaker::after {
  content: ':';
}

.pp-line-text {
  min-width: 0;
  white-space: pre-line;
}

.pp-line.sl-stage .pp-line-text,
.pp-line.sl-effect .pp-line-text,
.pp-line.sl-comment .pp-line-text {
  color: var(--app-ink-muted);
  font-size: 11.5px;
}
</style>
