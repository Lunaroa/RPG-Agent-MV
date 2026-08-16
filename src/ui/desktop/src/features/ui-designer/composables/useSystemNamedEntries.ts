import { computed, ref, watch } from 'vue'
import { projectAssets, type EditorProjectCatalog, type NamedCatalogEntry } from '../../../api/client'
import { useProjectStore } from '../../../stores/project'

export type UiSystemNamedKind = 'switch' | 'variable'

const catalog = ref<EditorProjectCatalog | null>(null)
const loadedProject = ref('')
let inflight: { project: string; promise: Promise<EditorProjectCatalog | null> } | null = null

function fetchCatalog(project: string, force: boolean): Promise<EditorProjectCatalog | null> {
  if (!force && catalog.value && loadedProject.value === project) return Promise.resolve(catalog.value)
  if (!force && inflight?.project === project) return inflight.promise
  const promise = projectAssets.editorCatalog(project)
    .then((result) => {
      if (inflight?.promise === promise) {
        catalog.value = result
        loadedProject.value = project
      }
      return result
    })
    .catch(() => null)
    .finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
  inflight = { project, promise }
  return promise
}

export function useSystemNamedEntries() {
  const projectStore = useProjectStore()
  const project = computed(() => projectStore.currentProject.trim())
  const ready = computed(() => Boolean(project.value) && loadedProject.value === project.value && catalog.value !== null)
  const entries = (kind: UiSystemNamedKind): NamedCatalogEntry[] => (kind === 'switch' ? catalog.value?.switches : catalog.value?.variables) ?? []
  const entryName = (kind: UiSystemNamedKind, id: number): string => {
    if (!Number.isInteger(id) || id <= 0) return ''
    const name = String(entries(kind).find((item) => item.id === id)?.name ?? '').trim()
    return name && name !== `#${id}` ? name : ''
  }
  const reload = () => { if (project.value) void fetchCatalog(project.value, true) }
  watch(project, (next) => {
    catalog.value = null
    loadedProject.value = ''
    if (next) void fetchCatalog(next, false)
  }, { immediate: true })
  return { catalog, ready, entries, entryName, reload }
}
