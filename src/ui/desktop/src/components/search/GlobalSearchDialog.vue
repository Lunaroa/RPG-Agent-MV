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
  type GlobalSearchMatchPrecision,
} from '../../api/client'
import { useI18n } from '../../i18n'
import { useProjectStore } from '../../stores/project'
import { useShortcutsStore } from '../../stores/shortcuts'
import { GLOBAL_SEARCH_OPEN_EVENT } from '../../utils/globalSearchEvents'

const HIT_ROW_HEIGHT = 56
const HEADER_ROW_HEIGHT = 32
const LIST_MAX_HEIGHT = 416
const HISTORY_LIMIT = 50

const router = useRouter()
const projectStore = useProjectStore()
const shortcuts = useShortcutsStore()
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
const matchPrecision = ref<GlobalSearchMatchPrecision>('loose')
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

/** Hits regrouped by category (fixed order) for the sectioned, DocSearch-style list. */
const orderedHits = computed<GlobalSearchHit[]>(() => {
  const groups = new Map<GlobalSearchCategory, GlobalSearchHit[]>()
  for (const hit of hits.value) {
    const list = groups.get(hit.document.category)
    if (list) list.push(hit)
    else groups.set(hit.document.category, [hit])
  }
  return ALL_CATEGORIES.flatMap((category) => groups.get(category) || [])
})

interface DisplayRow {
  kind: 'header' | 'hit'
  category: GlobalSearchCategory
  hit: GlobalSearchHit | null
  hitIndex: number
  top: number
  height: number
}

/** Flat render rows (section headers + hit cards) with precomputed offsets for the virtual list. */
const displayRows = computed<DisplayRow[]>(() => {
  const rows: DisplayRow[] = []
  let top = 0
  let hitIndex = 0
  let lastCategory: GlobalSearchCategory | null = null
  for (const hit of orderedHits.value) {
    if (hit.document.category !== lastCategory) {
      lastCategory = hit.document.category
      rows.push({ kind: 'header', category: lastCategory, hit: null, hitIndex: -1, top, height: HEADER_ROW_HEIGHT })
      top += HEADER_ROW_HEIGHT
    }
    rows.push({ kind: 'hit', category: hit.document.category, hit, hitIndex, top, height: HIT_ROW_HEIGHT })
    top += HIT_ROW_HEIGHT
    hitIndex += 1
  }
  return rows
})

const listTotalHeight = computed(() => {
  const last = displayRows.value[displayRows.value.length - 1]
  return last ? last.top + last.height : 0
})

const visibleWindow = computed(() => {
  const viewTop = scrollTop.value - HIT_ROW_HEIGHT
  const viewBottom = scrollTop.value + LIST_MAX_HEIGHT + HIT_ROW_HEIGHT
  const items = displayRows.value.filter((row) => row.top + row.height >= viewTop && row.top <= viewBottom)
  return { items, offsetY: items[0]?.top ?? 0, totalHeight: listTotalHeight.value }
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
    matchPrecision.value = config.search?.matchPrecision || 'loose'
  } catch {
    // Config read failures surface on save; the dialog stays usable.
  }
}

async function onMatchPrecisionChange(): Promise<void> {
  const project = projectStore.currentProject
  scheduleSearch(0)
  if (!project) return
  try {
    await projectConfig.setSearch({ matchPrecision: matchPrecision.value }, project)
  } catch {
    // Precision persistence is best effort; the live search already reflects the change.
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
      matchPrecision: matchPrecision.value,
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
function removeHit(hit: GlobalSearchHit): void {
  hits.value = hits.value.filter((item) => item.document.id !== hit.document.id)
  total.value = Math.max(0, total.value - 1)
  if (activeIndex.value >= orderedHits.value.length) {
    activeIndex.value = Math.max(0, orderedHits.value.length - 1)
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
  const row = displayRows.value.find((item) => item.kind === 'hit' && item.hitIndex === activeIndex.value)
  if (!row) return
  // Keep the section header visible when the active hit is the first in its group.
  const top = row.top - HEADER_ROW_HEIGHT
  if (top < host.scrollTop) host.scrollTop = Math.max(0, top)
  else if (row.top + row.height > host.scrollTop + host.clientHeight) {
    host.scrollTop = row.top + row.height - host.clientHeight
  }
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (orderedHits.value.length) {
      activeIndex.value = Math.min(orderedHits.value.length - 1, activeIndex.value + 1)
      scrollActiveIntoView()
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (orderedHits.value.length) {
      activeIndex.value = Math.max(0, activeIndex.value - 1)
      scrollActiveIntoView()
    }
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const hit = orderedHits.value[activeIndex.value]
    if (hit) navigateTo(hit)
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (shortcuts.matches(event, 'app.globalSearch')) {
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
          <div class="global-search-input-box">
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
          </div>
          <el-popover v-model:visible="settingsOpen" trigger="click" width="320" placement="bottom-end" popper-class="global-search-settings-popper">
            <template #reference>
              <button type="button" class="global-search-tool" :title="t('search.settings')">
                <el-icon><Setting /></el-icon>
              </button>
            </template>
            <div class="global-search-settings">
              <label class="global-search-settings-label">{{ t('search.matchPrecision') }}</label>
              <el-select v-model="matchPrecision" size="small" @change="onMatchPrecisionChange">
                <el-option value="loose" :label="t('search.matchPrecisionLoose')" />
                <el-option value="medium" :label="t('search.matchPrecisionMedium')" />
                <el-option value="strict" :label="t('search.matchPrecisionStrict')" />
              </el-select>
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
              <template
                v-for="row in visibleWindow.items"
                :key="row.hit ? row.hit.document.id : `header-${row.category}`"
              >
                <div v-if="row.kind === 'header'" class="global-search-section-title">
                  {{ categoryLabels[row.category] }}
                </div>
                <div
                  v-else-if="row.hit"
                  class="global-search-row"
                  :class="{ active: row.hitIndex === activeIndex }"
                  :data-ui-id="`global-search-hit-${row.hit.document.id}`"
                  @mouseenter="activeIndex = row.hitIndex"
                  @click="navigateTo(row.hit)"
                >
                  <span class="global-search-row-main">
                    <span class="global-search-row-title">{{ row.hit.document.title }}</span>
                    <span class="global-search-row-context">{{ hitContext(row.hit) }}</span>
                  </span>
                  <button
                    type="button"
                    class="global-search-row-remove"
                    :title="t('search.removeResult')"
                    @click.stop="removeHit(row.hit)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                  <span class="global-search-row-enter" aria-hidden="true">↵</span>
                </div>
              </template>
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
          <span class="global-search-keys">
            <span class="global-search-key-group"><kbd>↵</kbd>{{ t('search.keySelect') }}</span>
            <span class="global-search-key-group"><kbd>↓</kbd><kbd>↑</kbd>{{ t('search.keyNavigate') }}</span>
            <span class="global-search-key-group"><kbd>esc</kbd>{{ t('search.keyClose') }}</span>
          </span>
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
  border-radius: 12px;
  background: var(--app-bg, #f6f4f1);
  box-shadow: 0 18px 50px rgba(20, 24, 29, .35);
  overflow: hidden;
}
.global-search-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 8px;
}
.global-search-input-box {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  border: 2px solid var(--app-accent);
  border-radius: 8px;
  background: var(--app-bg-elevated, #fff);
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
  padding: 2px 14px 6px;
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
.global-search-section-title {
  height: 32px;
  display: flex;
  align-items: flex-end;
  padding: 0 14px 6px;
  color: var(--app-accent);
  font-size: 12px;
  font-weight: 700;
}
.global-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  margin: 0 14px 8px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--app-bg-elevated, #fff);
  box-shadow: 0 1px 2px rgba(20, 24, 29, .08);
  cursor: pointer;
}
.global-search-row.active {
  background: var(--app-accent);
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
.global-search-row.active .global-search-row-title,
.global-search-row.active .global-search-row-context {
  color: #fff;
}
.global-search-row-enter {
  flex: none;
  display: none;
  color: #fff;
  font-size: 14px;
}
.global-search-row.active .global-search-row-enter {
  display: inline;
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
.global-search-row.active .global-search-row-remove {
  color: #fff;
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
  background: var(--app-bg-elevated, #fff);
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
  display: flex;
  align-items: center;
  gap: 12px;
}
.global-search-key-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--app-ink-muted);
  font-size: 11px;
}
.global-search-key-group kbd {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--app-bg, #f6f4f1);
  box-shadow: 0 1px 2px rgba(20, 24, 29, .2);
  font-family: inherit;
  font-size: 11px;
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

<style>
/* Teleported to body; must sit above the search overlay (z-index 4000). */
.global-search-settings-popper {
  z-index: 4100 !important;
}
</style>
