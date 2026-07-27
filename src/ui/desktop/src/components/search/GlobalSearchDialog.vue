<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  globalSearch,
  projectConfig,
  type GlobalSearchCategory,
  type GlobalSearchHit,
  type GlobalSearchIndexState,
} from '../../api/client'
import { useI18n } from '../../i18n'
import { useProjectStore } from '../../stores/project'
import { GLOBAL_SEARCH_OPEN_EVENT } from '../../utils/globalSearchEvents'

const ROW_HEIGHT = 52
const LIST_MAX_HEIGHT = 416
const HISTORY_LIMIT = 50

const router = useRouter()
const projectStore = useProjectStore()
const { t } = useI18n()

const visible = ref(false)
const query = ref('')
const exact = ref(false)
const searching = ref(false)
const searchError = ref('')
const hits = ref<GlobalSearchHit[]>([])
const total = ref(0)
const tookMs = ref(0)
const activeIndex = ref(0)
const indexState = ref<GlobalSearchIndexState | null>(null)
const history = ref<string[]>([])
const maxResults = ref(100)
const extraFoldersText = ref('')
const settingsOpen = ref(false)
const rebuildBusy = ref(false)
const scrollTop = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

/** Route to return to after a jump; enables the "jump back" affordance. */
const jumpBackTarget = ref('')

const ALL_CATEGORIES: GlobalSearchCategory[] = ['file', 'map', 'event', 'database', 'plugin', 'pluginParam']
const enabledCategories = ref<Set<GlobalSearchCategory>>(new Set(ALL_CATEGORIES))

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSequence = 0

const categoryLabels = computed<Record<GlobalSearchCategory, string>>(() => ({
  file: t('search.category.file'),
  map: t('search.category.map'),
  event: t('search.category.event'),
  database: t('search.category.database'),
  plugin: t('search.category.plugin'),
  pluginParam: t('search.category.pluginParam'),
}))

const building = computed(() => indexState.value?.status === 'building')

const visibleWindow = computed(() => {
  const count = Math.ceil(LIST_MAX_HEIGHT / ROW_HEIGHT) + 2
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - 1)
  return {
    start,
    items: hits.value.slice(start, start + count),
    offsetY: start * ROW_HEIGHT,
    totalHeight: hits.value.length * ROW_HEIGHT,
  }
})

function hitContext(hit: GlobalSearchHit): string {
  return hit.document.context
}

function openDialog(): void {
  if (!projectStore.currentProject) return
  visible.value = true
  settingsOpen.value = false
  void loadSettings()
  void refreshIndex()
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function closeDialog(): void {
  visible.value = false
  settingsOpen.value = false
}

async function loadSettings(): Promise<void> {
  const project = projectStore.currentProject
  if (!project) return
  try {
    const config = await projectConfig.get(project)
    history.value = config.search?.history || []
    maxResults.value = config.search?.maxResults || 100
    extraFoldersText.value = (config.search?.extraFolders || []).join('\n')
  } catch {
    // Config read failures surface on save; the dialog stays usable.
  }
}

async function refreshIndex(): Promise<void> {
  const project = projectStore.currentProject
  if (!project) return
  try {
    indexState.value = await globalSearch.state(project)
    indexState.value = await globalSearch.ensureIndex(project)
    if (query.value.trim()) scheduleSearch(0)
  } catch (error) {
    searchError.value = t('search.failed', { message: (error as Error).message })
  }
}

function scheduleSearch(delay = 250): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void runSearch()
  }, delay)
}

async function runSearch(): Promise<void> {
  const project = projectStore.currentProject
  const term = query.value.trim()
  if (!project || !term) {
    hits.value = []
    total.value = 0
    tookMs.value = 0
    searchError.value = ''
    return
  }
  const sequence = ++searchSequence
  searching.value = true
  searchError.value = ''
  try {
    const result = await globalSearch.query(term, {
      categories: [...enabledCategories.value],
      exact: exact.value,
      maxResults: maxResults.value,
    }, project)
    if (sequence !== searchSequence) return
    hits.value = result.hits
    total.value = result.total
    tookMs.value = result.tookMs
    activeIndex.value = 0
    scrollTop.value = 0
    if (listRef.value) listRef.value.scrollTop = 0
    indexState.value = await globalSearch.state(project)
  } catch (error) {
    if (sequence !== searchSequence) return
    hits.value = []
    total.value = 0
    searchError.value = t('search.failed', { message: (error as Error).message })
  } finally {
    if (sequence === searchSequence) searching.value = false
  }
}

function toggleCategory(category: GlobalSearchCategory): void {
  const next = new Set(enabledCategories.value)
  if (next.has(category)) next.delete(category)
  else next.add(category)
  if (next.size === 0) return // At least one category stays active.
  enabledCategories.value = next
  scheduleSearch(0)
}

/** Remove one result row (non-persistent; groundwork for a future replace flow). */
function removeHit(index: number): void {
  hits.value = hits.value.filter((_, itemIndex) => itemIndex !== index)
  total.value = Math.max(0, total.value - 1)
  if (activeIndex.value >= hits.value.length) {
    activeIndex.value = Math.max(0, hits.value.length - 1)
  }
}

async function rememberTerm(term: string): Promise<void> {
  const project = projectStore.currentProject
  if (!project || !term) return
  const next = [term, ...history.value.filter((item) => item !== term)].slice(0, HISTORY_LIMIT)
  history.value = next
  try {
    await projectConfig.setSearch({ history: next }, project)
  } catch {
    // History persistence is best effort; the search flow must not break.
  }
}

function applyHistoryTerm(term: string): void {
  query.value = term
  scheduleSearch(0)
  inputRef.value?.focus()
}

async function clearHistory(): Promise<void> {
  const project = projectStore.currentProject
  history.value = []
  if (project) await projectConfig.setSearch({ history: [] }, project)
}

/** DatabaseView keeps its section param in sync; derive it so the sidebar lands on the right tab. */
function sectionForDatabaseGroup(group: string): string {
  if (group === 'CommonEvents') return 'commonEvents'
  if (group === 'Switches') return 'switches'
  if (group === 'Variables') return 'variables'
  return 'database'
}

/** Jump to the hit's owning surface; each view consumes these query params. */
function navigateTo(hit: GlobalSearchHit): void {
  const document = hit.document
  jumpBackTarget.value = router.currentRoute.value.fullPath
  void rememberTerm(query.value.trim())
  closeDialog()
  // `focus` is a nonce so repeated jumps to the same target still re-trigger route watchers.
  const focus = String(Date.now())
  if (document.category === 'map' && document.mapId) {
    void router.push({ path: '/workbench', query: { mapId: String(document.mapId), focus } })
    return
  }
  if (document.category === 'event') {
    if (document.mapId && document.eventId) {
      void router.push({
        path: '/workbench',
        query: { mapId: String(document.mapId), eventId: String(document.eventId), focus },
      })
      return
    }
    if (document.commonEventId) {
      void router.push({
        path: '/database',
        query: { section: 'commonEvents', group: 'CommonEvents', id: String(document.commonEventId) },
      })
      return
    }
  }
  if (document.category === 'database' && document.databaseGroup && document.databaseId) {
    void router.push({
      path: '/database',
      query: {
        section: sectionForDatabaseGroup(document.databaseGroup),
        group: document.databaseGroup,
        id: String(document.databaseId),
      },
    })
    return
  }
  if (document.category === 'file') {
    void router.push({
      path: '/project-assets',
      query: document.assetCategoryId && document.assetName
        ? { category: document.assetCategoryId, entry: document.assetName }
        : {},
    })
    return
  }
  if ((document.category === 'plugin' || document.category === 'pluginParam') && document.pluginName) {
    void router.push({ path: '/console', query: { page: 'plugins', plugin: document.pluginName } })
  }
}

function jumpBack(): void {
  if (!jumpBackTarget.value) return
  const target = jumpBackTarget.value
  jumpBackTarget.value = ''
  closeDialog()
  void router.push(target)
}

async function saveSettings(): Promise<void> {
  const project = projectStore.currentProject
  if (!project) return
  const folders = extraFoldersText.value
    .split('\n')
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean)
  try {
    await projectConfig.setSearch({ extraFolders: folders, maxResults: maxResults.value }, project)
    settingsOpen.value = false
    await rebuildIndex()
  } catch (error) {
    ElMessage.error(t('search.failed', { message: (error as Error).message }))
  }
}

async function rebuildIndex(): Promise<void> {
  const project = projectStore.currentProject
  if (!project || rebuildBusy.value) return
  rebuildBusy.value = true
  try {
    indexState.value = await globalSearch.rebuild(project)
    if (query.value.trim()) scheduleSearch(0)
  } catch (error) {
    ElMessage.error(t('search.failed', { message: (error as Error).message }))
  } finally {
    rebuildBusy.value = false
  }
}

function onListScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}

function scrollActiveIntoView(): void {
  const host = listRef.value
  if (!host) return
  const top = activeIndex.value * ROW_HEIGHT
  if (top < host.scrollTop) host.scrollTop = top
  else if (top + ROW_HEIGHT > host.scrollTop + host.clientHeight) {
    host.scrollTop = top + ROW_HEIGHT - host.clientHeight
  }
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (hits.value.length) {
      activeIndex.value = Math.min(hits.value.length - 1, activeIndex.value + 1)
      scrollActiveIntoView()
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (hits.value.length) {
      activeIndex.value = Math.max(0, activeIndex.value - 1)
      scrollActiveIntoView()
    }
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const hit = hits.value[activeIndex.value]
    if (hit) navigateTo(hit)
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    if (visible.value) closeDialog()
    else openDialog()
    return
  }
  if (event.key === 'Escape' && visible.value) {
    event.preventDefault()
    event.stopPropagation()
    closeDialog()
  }
}

function onOpenRequest(): void {
  openDialog()
}

watch(query, () => scheduleSearch())
watch(exact, () => scheduleSearch(0))
watch(() => projectStore.currentProject, () => {
  hits.value = []
  total.value = 0
  query.value = ''
  history.value = []
  indexState.value = null
  jumpBackTarget.value = ''
  closeDialog()
})

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown, true)
  window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenRequest)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
  window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenRequest)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="global-search-overlay"
      data-ui-id="global-search-overlay"
      @pointerdown.self="closeDialog"
    >
      <div class="global-search-panel" role="dialog" :aria-label="t('search.title')">
        <div class="global-search-input-row">
          <el-icon class="global-search-icon"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="global-search-input"
            data-ui-id="global-search-input"
            type="text"
            :placeholder="t('search.placeholder')"
            spellcheck="false"
            @keydown="onInputKeydown"
          />
          <span v-if="building" class="global-search-building">{{ t('search.building') }}</span>
          <el-popover v-model:visible="settingsOpen" trigger="click" width="320" placement="bottom-end">
            <template #reference>
              <button type="button" class="global-search-tool" :title="t('search.settings')">
                <el-icon><Setting /></el-icon>
              </button>
            </template>
            <div class="global-search-settings">
              <label class="global-search-settings-label">{{ t('search.maxResults') }}</label>
              <el-input-number v-model="maxResults" size="small" :min="10" :max="1000" :step="10" :controls="false" />
              <label class="global-search-settings-label">{{ t('search.extraFolders') }}</label>
              <el-input
                v-model="extraFoldersText"
                type="textarea"
                :rows="3"
                resize="none"
                :placeholder="t('search.extraFoldersPlaceholder')"
              />
              <div class="global-search-settings-actions">
                <el-button size="small" :loading="rebuildBusy" :icon="Refresh" @click="rebuildIndex">
                  {{ t('search.rebuild') }}
                </el-button>
                <el-button size="small" type="primary" @click="saveSettings">
                  {{ t('search.save') }}
                </el-button>
              </div>
            </div>
          </el-popover>
        </div>

        <div class="global-search-filters">
          <el-checkbox
            v-for="category in ALL_CATEGORIES"
            :key="category"
            size="small"
            :model-value="enabledCategories.has(category)"
            @change="toggleCategory(category)"
          >
            {{ categoryLabels[category] }}
          </el-checkbox>
          <el-checkbox size="small" class="global-search-exact" :model-value="exact" @change="exact = !exact">
            {{ t('search.exact') }}
          </el-checkbox>
        </div>

        <div v-if="searchError" class="global-search-error" role="alert">{{ searchError }}</div>

        <div
          v-if="hits.length"
          ref="listRef"
          class="global-search-list"
          data-ui-id="global-search-results"
          @scroll="onListScroll"
        >
          <div class="global-search-list-spacer" :style="{ height: `${visibleWindow.totalHeight}px` }">
            <div :style="{ transform: `translateY(${visibleWindow.offsetY}px)` }">
              <div
                v-for="(hit, windowIndex) in visibleWindow.items"
                :key="hit.document.id"
                class="global-search-row"
                :class="{ active: visibleWindow.start + windowIndex === activeIndex }"
                :data-ui-id="`global-search-hit-${hit.document.id}`"
                @mouseenter="activeIndex = visibleWindow.start + windowIndex"
                @click="navigateTo(hit)"
              >
                <span class="global-search-row-category">{{ categoryLabels[hit.document.category] }}</span>
                <span class="global-search-row-main">
                  <span class="global-search-row-title">{{ hit.document.title }}</span>
                  <span class="global-search-row-context">{{ hitContext(hit) }}</span>
                </span>
                <button
                  type="button"
                  class="global-search-row-remove"
                  :title="t('search.removeResult')"
                  @click.stop="removeHit(visibleWindow.start + windowIndex)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="query.trim() && !searching" class="global-search-empty">
          {{ t('search.empty') }}
        </div>
        <div v-else-if="!query.trim()" class="global-search-history">
          <template v-if="history.length">
            <div class="global-search-history-head">
              <span>{{ t('search.history') }}</span>
              <button type="button" class="global-search-history-clear" @click="clearHistory">
                {{ t('search.clearHistory') }}
              </button>
            </div>
            <button
              v-for="term in history.slice(0, 10)"
              :key="term"
              type="button"
              class="global-search-history-term"
              @click="applyHistoryTerm(term)"
            >
              {{ term }}
            </button>
          </template>
          <p v-else class="global-search-empty">{{ t('search.hint') }}</p>
        </div>

        <div class="global-search-footer">
          <span v-if="query.trim() && !searching">
            {{ t('search.stats', { total, ms: tookMs }) }}
          </span>
          <span v-else-if="searching">…</span>
          <span v-else />
          <button
            v-if="jumpBackTarget"
            type="button"
            class="global-search-jump-back"
            data-ui-id="global-search-jump-back"
            @click="jumpBack"
          >
            {{ t('search.jumpBack') }}
          </button>
          <span class="global-search-keys">{{ t('search.keysHint') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.global-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(20, 24, 29, .38);
}
.global-search-panel {
  width: min(680px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: var(--app-bg-elevated, #fff);
  box-shadow: 0 18px 50px rgba(20, 24, 29, .35);
  overflow: hidden;
}
.global-search-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--app-border);
}
.global-search-icon {
  color: var(--app-accent);
  font-size: 18px;
}
.global-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--app-ink);
  font-size: 16px;
}
.global-search-building {
  flex: none;
  color: var(--app-ink-muted);
  font-size: 11px;
}
.global-search-tool {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
}
.global-search-tool:hover {
  background: var(--app-bg-hover);
  color: var(--app-ink);
}
.global-search-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 12px;
  padding: 4px 14px;
  border-bottom: 1px solid var(--app-border);
}
.global-search-exact {
  margin-left: auto;
}
.global-search-error {
  padding: 10px 14px;
  color: var(--el-color-danger);
  font-size: 12px;
}
.global-search-list {
  max-height: 416px;
  overflow-y: auto;
}
.global-search-list-spacer {
  position: relative;
}
.global-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 14px;
  cursor: pointer;
}
.global-search-row.active {
  background: var(--app-accent-soft);
}
.global-search-row-category {
  flex: none;
  width: 64px;
  color: var(--app-ink-muted);
  font-size: 11px;
  font-weight: 650;
}
.global-search-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.global-search-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-ink);
  font-size: 13px;
  font-weight: 600;
}
.global-search-row-context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-ink-soft);
  font-size: 11px;
}
.global-search-row-remove {
  flex: none;
  display: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
}
.global-search-row:hover .global-search-row-remove,
.global-search-row.active .global-search-row-remove {
  display: grid;
}
.global-search-row-remove:hover {
  color: var(--el-color-danger);
}
.global-search-empty {
  margin: 0;
  padding: 22px 14px;
  color: var(--app-ink-muted);
  font-size: 12px;
  text-align: center;
}
.global-search-history {
  display: flex;
  flex-direction: column;
  padding: 6px 0;
}
.global-search-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 14px;
  color: var(--app-ink-muted);
  font-size: 11px;
  font-weight: 650;
}
.global-search-history-clear {
  border: none;
  background: transparent;
  color: var(--app-ink-soft);
  font-size: 11px;
  cursor: pointer;
}
.global-search-history-clear:hover {
  color: var(--app-accent);
}
.global-search-history-term {
  padding: 7px 14px;
  border: none;
  background: transparent;
  color: var(--app-ink);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.global-search-history-term:hover {
  background: var(--app-bg-hover);
}
.global-search-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--app-border);
  color: var(--app-ink-muted);
  font-size: 11px;
}
.global-search-jump-back {
  border: none;
  background: transparent;
  color: var(--app-accent);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.global-search-keys {
  margin-left: auto;
}
.global-search-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.global-search-settings-label {
  color: var(--app-ink-soft);
  font-size: 11px;
  font-weight: 650;
}
.global-search-settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
