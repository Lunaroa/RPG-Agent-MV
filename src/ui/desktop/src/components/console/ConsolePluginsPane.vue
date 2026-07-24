<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import {
  maps as mapsApi,
  plugins as pluginApi,
  projectAssets,
  system,
  type EditorProjectCatalog,
  type ManagedPluginEntry,
  type ManagedPluginFile,
  type PluginConfigurationResult,
  type PluginHeaderMetadata,
  type PluginValidationIssue,
} from '../../api/client';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { useWorkspaceStore } from '../../stores/workspace';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';
import { parseProjectStagingSummary } from '../../utils/projectStaging';
import {
  clampPluginListWidth,
  DEFAULT_PLUGIN_LIST_WIDTH,
  PLUGIN_LIST_MAX_WIDTH,
  PLUGIN_LIST_MIN_WIDTH,
} from '../../utils/workspaceSettings';
import { derivePluginInstallNameFromSourcePath } from '../../utils/pluginInstallPath';
import ConsoleSearchInput from './ConsoleSearchInput.vue';
import PluginDeleteDialog from './PluginDeleteDialog.vue';
import PluginEngineTags from './PluginEngineTags.vue';
import PluginParameterDialog from './PluginParameterDialog.vue';
import {
  adjacentPluginListKey,
  buildPluginManagerGroups,
  isPluginReorderLocked,
  movePluginIndex,
  pluginHelpLanguageKey,
  pluginSupportsEngine,
  resolvePluginReference,
} from './plugin-manager-model';

type SelectedItem =
  | { kind: 'configured'; plugin: ManagedPluginEntry }
  | { kind: 'file'; file: ManagedPluginFile };

const projectStore = useProjectStore();
const workbenchUi = useWorkbenchUiStore();
const workspaceStore = useWorkspaceStore();
const { language, t } = useI18n();

const config = ref<PluginConfigurationResult | null>(null);
const editorCatalog = ref<EditorProjectCatalog | null>(null);
const selectedKey = ref('');
const search = ref('');
const loading = ref(false);
const loadFailed = ref(false);
const busyKey = ref('');
const error = ref('');
const actionMessage = ref('');
const stagingDirty = ref(false);
const parameterDialogOpen = ref(false);
const parameterDialogPluginIndex = ref<number | null>(null);
const parameterDialogError = ref('');
const deleteDialogOpen = ref(false);
const deleteTargetIndex = ref<number | null>(null);
const activeHelpTab = ref('');
const draggedIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);
const layoutElement = ref<HTMLElement | null>(null);
const pluginRowElements = new Map<string, HTMLElement>();
const listWidth = ref(clampPluginListWidth(
  workspaceStore.settings.layout?.pluginListWidth ?? DEFAULT_PLUGIN_LIST_WIDTH,
));
let resizeStartX = 0;
let resizeStartWidth = listWidth.value;

const query = computed(() => search.value.trim().toLocaleLowerCase());
const groups = computed(() => buildPluginManagerGroups(config.value, search.value));
const plugins = computed(() => config.value?.plugins || []);
const pluginFiles = computed(() => config.value?.pluginFiles || []);
const unconfiguredFiles = computed(() => buildPluginManagerGroups(config.value).unconfigured);
const enabledCount = computed(() => groups.value.enabledCount);
const filteredPlugins = computed(() => groups.value.configured);
const filteredFiles = computed(() => groups.value.unconfigured);
const reorderLocked = computed(() => isPluginReorderLocked(search.value, Boolean(busyKey.value)));

const selectedItem = computed<SelectedItem | null>(() => {
  if (selectedKey.value.startsWith('configured-row:')) {
    const index = Number(selectedKey.value.slice('configured-row:'.length));
    const plugin = plugins.value.find((entry) => entry.index === index);
    if (plugin) return { kind: 'configured', plugin };
  }
  if (selectedKey.value.startsWith('configured:')) {
    const name = selectedKey.value.slice('configured:'.length);
    const plugin = plugins.value.find((entry) => entry.name === name);
    if (plugin) return { kind: 'configured', plugin };
  }
  if (selectedKey.value.startsWith('file:')) {
    const relativePath = selectedKey.value.slice('file:'.length);
    const file = unconfiguredFiles.value.find((entry) => entry.relativePath === relativePath);
    if (file) return { kind: 'file', file };
  }
  const plugin = plugins.value[0];
  if (plugin) return { kind: 'configured', plugin };
  const file = unconfiguredFiles.value[0];
  return file ? { kind: 'file', file } : null;
});

const selectedPlugin = computed(() =>
  selectedItem.value?.kind === 'configured' ? selectedItem.value.plugin : null,
);
const parameterDialogPlugin = computed(() =>
  parameterDialogPluginIndex.value == null
    ? null
    : (plugins.value.find((plugin) => plugin.index === parameterDialogPluginIndex.value) || null),
);
const selectedFile = computed(() =>
  selectedItem.value?.kind === 'file' ? selectedItem.value.file : null,
);
const selectedHeader = computed<PluginHeaderMetadata | null>(() =>
  selectedPlugin.value?.header || selectedFile.value?.header || null,
);
const selectedName = computed(() => selectedPlugin.value?.name || selectedFile.value?.name || '');
const selectedPath = computed(() => selectedHeader.value?.displayPath || 'js/plugins');
const selectedDescription = computed(() =>
  selectedHeader.value?.plugindesc
  || selectedPlugin.value?.description
  || t('plugins.noDescription'),
);
const selectedIssue = computed(() => {
  const name = selectedPlugin.value?.name;
  if (!name) return null;
  return (config.value?.validation.issues || []).find(
    (issue) => issue.severity === 'error' && issue.pluginName === name,
  ) || null;
});
const currentEngineTarget = computed(() =>
  projectStore.currentProjectInfo?.engine === 'rpg-maker-mz' ? 'MZ' : 'MV',
);
const selectedTargetMismatch = computed(() => {
  const engine = projectStore.currentProjectInfo?.engine;
  if (!engine || !selectedHeader.value) return false;
  return pluginSupportsEngine(selectedHeader.value.target, engine) === false;
});
const selectedTargetWarning = computed(() =>
  selectedTargetMismatch.value
    ? t('plugins.incompatibleTarget', {
        current: currentEngineTarget.value,
        supported: selectedHeader.value?.target.join(' / ') || '-',
      })
    : '',
);
const deleteTargetPath = computed(() => {
  if (deleteTargetIndex.value == null) return '';
  return plugins.value.find((plugin) => plugin.index === deleteTargetIndex.value)?.header.displayPath || '';
});
const deleteTargetName = computed(() => {
  if (deleteTargetIndex.value == null) return '';
  return plugins.value.find((plugin) => plugin.index === deleteTargetIndex.value)?.name || '';
});
const selectedHelpTabs = computed(() =>
  (selectedHeader.value?.helpSections || []).map((section) => ({
    id: section.language
      ? `locale:${section.language.toLocaleLowerCase()}`
      : 'default',
    label: helpLanguageLabel(section.language),
    content: section.content,
  })),
);

watch(() => projectStore.currentProject, () => {
  resetState();
  if (projectStore.currentProject) void loadPlugins();
});

watch(
  () => workspaceStore.settings.layout?.pluginListWidth,
  (width) => {
    if (typeof width === 'number') listWidth.value = clampPluginListWidth(width);
  },
);

watch(
  () => [enabledCount.value, plugins.value.length, language.value] as const,
  updateStatusBar,
  { immediate: true },
);

watch(
  () => `${selectedKey.value}\u0000${selectedHelpTabs.value.map((tab) => tab.id).join('\u0000')}`,
  () => {
    activeHelpTab.value = selectedHelpTabs.value[0]?.id || '';
  },
  { immediate: true },
);

onMounted(() => {
  workbenchUi.sbHideZoom = true;
  if (projectStore.currentProject) void loadPlugins();
});

onBeforeUnmount(() => {
  stopResize();
  workbenchUi.sbContextText = '';
  workbenchUi.sbHideZoom = false;
  workbenchUi.sbStagingDirty = false;
});

function resetState(): void {
  config.value = null;
  editorCatalog.value = null;
  selectedKey.value = '';
  search.value = '';
  error.value = '';
  actionMessage.value = '';
  loadFailed.value = false;
  busyKey.value = '';
  stagingDirty.value = false;
  parameterDialogOpen.value = false;
  parameterDialogPluginIndex.value = null;
  parameterDialogError.value = '';
  deleteDialogOpen.value = false;
  deleteTargetIndex.value = null;
  activeHelpTab.value = '';
  pluginRowElements.clear();
  updateStatusBar();
}

function applyConfig(next: PluginConfigurationResult): void {
  config.value = next;
  if (!selectedItem.value) {
    selectedKey.value = next.plugins[0]
      ? configuredRowKey(next.plugins[0].index)
      : next.pluginFiles[0]
        ? fileKey(next.pluginFiles[0].relativePath)
        : '';
  }
  updateStatusBar();
}

async function loadPlugins(): Promise<void> {
  if (!projectStore.currentProject) return;
  loading.value = true;
  loadFailed.value = false;
  error.value = '';
  actionMessage.value = '';
  try {
    const [nextConfig, catalog] = await Promise.all([
      pluginApi.read(projectStore.currentProject),
      projectAssets.editorCatalog(projectStore.currentProject),
    ]);
    applyConfig(nextConfig);
    editorCatalog.value = catalog;
    await refreshStagingStatus();
  } catch (loadError) {
    config.value = null;
    loadFailed.value = true;
    console.error('[plugins] failed to load plugin configuration', loadError);
    updateStatusBar();
  } finally {
    loading.value = false;
  }
}

async function refreshEditorCatalog(): Promise<void> {
  if (!projectStore.currentProject) return;
  try {
    editorCatalog.value = await projectAssets.editorCatalog(projectStore.currentProject);
  } catch (catalogError) {
    console.error('[plugins] failed to refresh editor catalog', catalogError);
  }
}

async function runAction(
  key: string,
  action: () => Promise<PluginConfigurationResult>,
  message: string,
): Promise<boolean> {
  if (!projectStore.currentProject || busyKey.value) return false;
  busyKey.value = key;
  error.value = '';
  actionMessage.value = '';
  try {
    applyConfig(await action());
    await refreshStagingStatus();
    actionMessage.value = message;
    return true;
  } catch (actionError) {
    error.value = formatPluginActionError(actionError);
    return false;
  } finally {
    busyKey.value = '';
  }
}

async function refreshStagingStatus(): Promise<void> {
  if (!projectStore.currentProject) {
    stagingDirty.value = false;
    workbenchUi.sbStagingDirty = false;
    return;
  }
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject) as { staged?: boolean };
    stagingDirty.value = Boolean(status?.staged);
    workbenchUi.sbStagingDirty = stagingDirty.value;
  } catch {
    /* Staging status does not block plugin configuration reads. */
  }
}

function updateStatusBar(): void {
  workbenchUi.sbHideZoom = true;
  if (!config.value) {
    workbenchUi.sbContextText = '';
    return;
  }
  workbenchUi.sbContextText = t('plugins.statusCount', {
    enabled: enabledCount.value,
    total: plugins.value.length,
  });
}

function configuredKey(name: string): string {
  return `configured:${name}`;
}

function configuredRowKey(index: number): string {
  return `configured-row:${index}`;
}

function fileKey(relativePath: string): string {
  return `file:${relativePath}`;
}

function selectPlugin(plugin: ManagedPluginEntry): void {
  selectedKey.value = configuredRowKey(plugin.index);
}

function selectFile(file: ManagedPluginFile): void {
  selectedKey.value = fileKey(file.relativePath);
}

function helpLanguageLabel(languageCode: string): string {
  const key = pluginHelpLanguageKey(languageCode);
  return key ? t(key) : languageCode;
}

function setPluginRowElement(key: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    pluginRowElements.set(key, element);
  } else {
    pluginRowElements.delete(key);
  }
}

function pluginReferenceAvailable(name: string): boolean {
  return Boolean(resolvePluginReference(config.value, name));
}

function pluginReferenceLabel(name: string): string {
  return pluginReferenceAvailable(name)
    ? t('plugins.locatePlugin', { name })
    : t('plugins.pluginReferenceMissing', { name });
}

async function navigateToPluginReference(name: string): Promise<void> {
  const target = resolvePluginReference(config.value, name);
  if (!target) return;
  search.value = '';
  const configured = target.kind === 'configured'
    ? plugins.value.find((plugin) => plugin.name === target.name)
    : null;
  const selectedItemKey = configured
    ? configuredRowKey(configured.index)
    : target.kind === 'file'
      ? fileKey(target.relativePath)
      : '';
  const rowKey = selectedItemKey;
  selectedKey.value = selectedItemKey;
  await nextTick();
  const row = pluginRowElements.get(rowKey);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
}

function hasConfigurableParameters(plugin: ManagedPluginEntry): boolean {
  return (plugin.parameterSchema?.fields.length ?? 0) > 0;
}

function mergeManagedPluginEntry(entry: ManagedPluginEntry): void {
  if (!config.value) return;
  const nextPlugins = config.value.plugins.slice();
  const atIndex = nextPlugins.findIndex((plugin) => plugin.index === entry.index);
  if (atIndex >= 0) {
    nextPlugins[atIndex] = entry;
  } else {
    nextPlugins.push(entry);
    nextPlugins.sort((left, right) => left.index - right.index);
  }
  config.value = { ...config.value, plugins: nextPlugins };
  updateStatusBar();
}

async function openParameterDialog(plugin: ManagedPluginEntry): Promise<void> {
  if (!plugin.name || busyKey.value || !projectStore.currentProject) return;
  selectPlugin(plugin);
  parameterDialogError.value = '';
  actionMessage.value = '';
  try {
    const [fresh, catalog] = await Promise.all([
      pluginApi.readEntry(plugin.index, projectStore.currentProject),
      projectAssets.editorCatalog(projectStore.currentProject),
    ]);
    if (busyKey.value) return;
    if (fresh.name !== plugin.name) {
      error.value = t('plugins.emptySelection');
      return;
    }
    mergeManagedPluginEntry(fresh);
    editorCatalog.value = catalog;
    selectedKey.value = configuredRowKey(fresh.index);
    if (!hasConfigurableParameters(fresh)) {
      actionMessage.value = t('plugins.noParameters');
      return;
    }
    parameterDialogPluginIndex.value = fresh.index;
    parameterDialogOpen.value = true;
  } catch (refreshError) {
    error.value = formatPluginActionError(refreshError);
  }
}

async function saveParameters(parameters: Record<string, unknown>): Promise<void> {
  const plugin = parameterDialogPlugin.value;
  if (!plugin || !projectStore.currentProject) return;
  parameterDialogError.value = '';
  const saved = await runAction(
    `params:${plugin.index}`,
    () => pluginApi.updateParameters(plugin.index, parameters, projectStore.currentProject),
    t('plugins.savedParams', { name: plugin.name }),
  );
  if (saved) {
    parameterDialogOpen.value = false;
  } else {
    parameterDialogError.value = error.value;
  }
}

function closeParameterDialogState(): void {
  parameterDialogPluginIndex.value = null;
  parameterDialogError.value = '';
}

async function togglePlugin(plugin: ManagedPluginEntry, enabled: boolean): Promise<void> {
  if (!projectStore.currentProject || !plugin.name) return;
  if (enabled && !plugin.fileExists) {
    error.value = t('plugins.enableMissingFile', { name: plugin.name });
    return;
  }
  await runAction(
    `toggle:${plugin.index}`,
    () => pluginApi.setEnabled(plugin.index, enabled, projectStore.currentProject),
    enabled
      ? t('plugins.enabledPlugin', { name: plugin.name })
      : t('plugins.disabledPlugin', { name: plugin.name }),
  );
}

async function addExistingFile(file: ManagedPluginFile): Promise<void> {
  if (!projectStore.currentProject || file.deleted) return;
  selectedKey.value = configuredKey(file.name);
  await runAction(
    `add:${file.name}`,
    () => pluginApi.addConfiguration(file.name, projectStore.currentProject),
    t('plugins.addedConfiguration', { name: file.name }),
  );
}

function pluginExistsInProject(name: string): boolean {
  return pluginFiles.value.some((file) => file.name === name && file.exists && !file.deleted);
}

async function installPlugin(): Promise<void> {
  if (!projectStore.currentProject || busyKey.value) return;
  busyKey.value = 'install';
  error.value = '';
  actionMessage.value = '';
  try {
    let mode: 'file' | 'directory';
    try {
      await ElMessageBox.confirm(
        t('plugins.installModeMessage'),
        t('plugins.installModeTitle'),
        {
          distinguishCancelAndClose: true,
          confirmButtonText: t('plugins.installModeFile'),
          cancelButtonText: t('plugins.installModeDirectory'),
          type: 'info',
        },
      );
      mode = 'file';
    } catch (action) {
      if (action === 'cancel') mode = 'directory';
      else return;
    }

    if (mode === 'directory') {
      const sourceDirectory = await pluginApi.selectInstallDirectory();
      if (!sourceDirectory) return;
      let result;
      try {
        result = await pluginApi.installDirectory(
          sourceDirectory,
          { overwrite: false },
          projectStore.currentProject,
        );
      } catch (firstError) {
        const message = formatPluginActionError(firstError);
        if (!/already exists/i.test(message)) throw firstError;
        try {
          await ElMessageBox.confirm(
            t('plugins.overwriteDirectoryConfirm'),
            t('plugins.overwriteTitle'),
            { type: 'warning' },
          );
        } catch {
          return;
        }
        result = await pluginApi.installDirectory(
          sourceDirectory,
          { overwrite: true },
          projectStore.currentProject,
        );
      }
      const first = result.installed[0];
      selectedKey.value = first ? configuredKey(first.name) : selectedKey.value;
      applyConfig(result.configuration);
      actionMessage.value = t('plugins.installDirectorySuccess', { count: result.installed.length });
      await refreshStagingStatus();
      return;
    }

    const sourceFile = await pluginApi.selectInstallFile();
    if (!sourceFile) return;
    const name = derivePluginInstallNameFromSourcePath(sourceFile);
    const overwrite = pluginExistsInProject(name);
    if (overwrite) {
      try {
        await ElMessageBox.confirm(
          t('plugins.overwriteConfirm', { name }),
          t('plugins.overwriteTitle'),
          { type: 'warning' },
        );
      } catch {
        return;
      }
    }
    const result = await pluginApi.installFile(
      sourceFile,
      { name, overwrite },
      projectStore.currentProject,
    );
    selectedKey.value = configuredKey(result.name);
    applyConfig(result.configuration || await pluginApi.read(projectStore.currentProject));
    actionMessage.value = overwrite
      ? t('plugins.overwriteSuccess', { name: result.name })
      : t('plugins.installSuccess', { name: result.name });
    await refreshStagingStatus();
  } catch (installError) {
    error.value = formatPluginActionError(installError);
  } finally {
    busyKey.value = '';
  }
}

function openDeleteConfiguredDialog(plugin: ManagedPluginEntry): void {
  if (!plugin.name || busyKey.value) return;
  deleteTargetIndex.value = plugin.index;
  deleteDialogOpen.value = true;
}

async function deleteConfiguredPlugin(mode: 'configuration' | 'file'): Promise<void> {
  const plugin = deleteTargetIndex.value == null
    ? null
    : plugins.value.find((entry) => entry.index === deleteTargetIndex.value) || null;
  if (!projectStore.currentProject || !plugin?.name || busyKey.value) return;
  const adjacentKey = adjacentConfiguredKey(plugin.index);
  if (mode === 'configuration') {
    selectedKey.value = adjacentKey || fileKey(plugin.fileRelativePath);
    const removed = await runAction(
      `remove-config:${plugin.index}`,
      () => pluginApi.removeConfiguration(plugin.index, projectStore.currentProject),
      t('plugins.removedConfiguration', { name: plugin.name }),
    );
    if (removed) closeDeleteConfiguredDialog();
    return;
  }

  selectedKey.value = adjacentKey;
  busyKey.value = `delete:${plugin.name}`;
  error.value = '';
  let deleted = false;
  try {
    const result = await pluginApi.deleteFile(plugin.name, {}, projectStore.currentProject);
    applyConfig(result.configuration || await pluginApi.read(projectStore.currentProject));
    actionMessage.value = t('plugins.deleteSuccess', { name: plugin.name });
    await refreshStagingStatus();
    deleted = true;
  } catch (deleteError) {
    error.value = formatPluginActionError(deleteError);
  } finally {
    busyKey.value = '';
  }
  if (deleted) closeDeleteConfiguredDialog();
}

function closeDeleteConfiguredDialog(): void {
  if (busyKey.value) return;
  deleteDialogOpen.value = false;
  deleteTargetIndex.value = null;
}

function adjacentConfiguredKey(index: number): string {
  const current = plugins.value.findIndex((plugin) => plugin.index === index);
  const adjacent = plugins.value[current + 1] || plugins.value[current - 1];
  return adjacent ? configuredRowKey(adjacent.index) : '';
}

async function deleteUnconfiguredFile(file: ManagedPluginFile): Promise<void> {
  if (!projectStore.currentProject || file.deleted || busyKey.value) return;
  try {
    await ElMessageBox.confirm(
      t('plugins.deleteUnconfiguredConfirm', { name: file.name }),
      t('plugins.deleteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('plugins.deleteFile'),
        cancelButtonText: t('editor.mapProperties.cancel'),
      },
    );
  } catch {
    return;
  }
  const fileIndex = unconfiguredFiles.value.findIndex(
    (entry) => entry.relativePath === file.relativePath,
  );
  const adjacent = unconfiguredFiles.value[fileIndex + 1] || unconfiguredFiles.value[fileIndex - 1];
  selectedKey.value = adjacent ? fileKey(adjacent.relativePath) : '';
  busyKey.value = `delete-file:${file.name}`;
  error.value = '';
  try {
    const result = await pluginApi.deleteFile(file.name, {}, projectStore.currentProject);
    applyConfig(result.configuration || await pluginApi.read(projectStore.currentProject));
    actionMessage.value = t('plugins.deleteFileSuccess', { name: file.name });
    await refreshStagingStatus();
  } catch (deleteError) {
    error.value = formatPluginActionError(deleteError);
  } finally {
    busyKey.value = '';
  }
}

async function reorderPluginIndexes(indexes: number[], messageName: string): Promise<void> {
  if (!projectStore.currentProject || reorderLocked.value) return;
  await runAction(
    `reorder:${messageName}`,
    () => pluginApi.reorder(indexes, projectStore.currentProject),
    t('plugins.adjustedOrder', { name: messageName }),
  );
}

function startDrag(event: DragEvent, plugin: ManagedPluginEntry): void {
  if (reorderLocked.value) {
    event.preventDefault();
    return;
  }
  draggedIndex.value = plugin.index;
  dropIndex.value = plugin.index;
  event.dataTransfer?.setData('text/plain', String(plugin.index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function dragOver(event: DragEvent, index: number): void {
  if (draggedIndex.value === null || reorderLocked.value) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const bounds = target.getBoundingClientRect();
  dropIndex.value = index + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0);
}

async function finishDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const movedIndex = draggedIndex.value;
  const movedPlugin = plugins.value.find((plugin) => plugin.index === movedIndex);
  const from = plugins.value.findIndex((plugin) => plugin.index === movedIndex);
  const insertion = dropIndex.value ?? from;
  clearDrag();
  if (!movedPlugin || from < 0 || insertion < 0 || insertion > plugins.value.length) return;
  const indexes = movePluginIndex(
    plugins.value.map((plugin) => plugin.index),
    movedIndex,
    insertion,
  );
  if (indexes.every((pluginIndex, index) => pluginIndex === plugins.value[index]?.index)) return;
  await reorderPluginIndexes(indexes, movedPlugin.name);
}

function clearDrag(): void {
  draggedIndex.value = null;
  dropIndex.value = null;
}

async function keyboardMove(plugin: ManagedPluginEntry, delta: -1 | 1): Promise<void> {
  if (reorderLocked.value) return;
  const indexes = plugins.value.map((entry) => entry.index);
  const index = indexes.indexOf(plugin.index);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= indexes.length) return;
  [indexes[index], indexes[target]] = [indexes[target], indexes[index]];
  await reorderPluginIndexes(indexes, plugin.name);
}

async function navigatePluginList(currentRowKey: string, delta: -1 | 1): Promise<void> {
  const rows = [
    ...filteredPlugins.value.map((plugin) => ({
      key: configuredRowKey(plugin.index),
      select: () => selectPlugin(plugin),
    })),
    ...filteredFiles.value.map((file) => ({
      key: fileKey(file.relativePath),
      select: () => selectFile(file),
    })),
  ];
  const targetKey = adjacentPluginListKey(
    rows.map((row) => row.key),
    currentRowKey,
    delta,
  );
  if (!targetKey) return;
  const target = rows.find((row) => row.key === targetKey);
  if (!target) return;
  target.select();
  await nextTick();
  const row = pluginRowElements.get(targetKey);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
}

function pluginKeydown(event: KeyboardEvent, plugin: ManagedPluginEntry): void {
  if (event.target !== event.currentTarget) return;
  if (event.altKey && event.key === 'ArrowUp') {
    event.preventDefault();
    void keyboardMove(plugin, -1);
  } else if (event.altKey && event.key === 'ArrowDown') {
    event.preventDefault();
    void keyboardMove(plugin, 1);
  } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') {
    event.preventDefault();
    void navigatePluginList(configuredRowKey(plugin.index), -1);
  } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowDown') {
    event.preventDefault();
    void navigatePluginList(configuredRowKey(plugin.index), 1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectPlugin(plugin);
  }
}

function fileKeydown(event: KeyboardEvent, file: ManagedPluginFile): void {
  if (event.target !== event.currentTarget) return;
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') {
    event.preventDefault();
    void navigatePluginList(fileKey(file.relativePath), -1);
  } else if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowDown') {
    event.preventDefault();
    void navigatePluginList(fileKey(file.relativePath), 1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectFile(file);
  }
}

async function openPluginUrl(): Promise<void> {
  if (selectedHeader.value?.urlHref) {
    await system.openExternalUrl(selectedHeader.value.urlHref);
  }
}

async function applyPluginStaging(): Promise<void> {
  if (!projectStore.currentProject || busyKey.value) return;
  busyKey.value = 'apply-staging';
  error.value = '';
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject);
    const summary = parseProjectStagingSummary(status);
    if (summary.operations.length) {
      const operations = summary.operations
        .map((operation) => `${operation.operationId} · ${operation.files.length}`)
        .join('\n');
      try {
        await ElMessageBox.confirm(
          t('plugins.applyAgentOperationsConfirm', { operations }),
          t('plugins.applyAgentOperationsTitle'),
          { type: 'warning' },
        );
      } catch {
        return;
      }
    }
    const result = await mapsApi.applyProjectStaging(
      projectStore.currentProject,
      summary.operations.map((operation) => operation.operationId),
    ) as { canceled?: boolean };
    if (result?.canceled) return;
    await loadPlugins();
    actionMessage.value = t('plugins.applySuccess');
  } catch (applyError) {
    error.value = formatPluginActionError(applyError);
  } finally {
    busyKey.value = '';
  }
}

async function discardPluginStaging(): Promise<void> {
  if (!projectStore.currentProject || busyKey.value) return;
  busyKey.value = 'discard-staging';
  error.value = '';
  try {
    await mapsApi.discardProjectStaging(projectStore.currentProject);
    await loadPlugins();
    actionMessage.value = t('plugins.discardSuccess');
  } catch (discardError) {
    error.value = formatPluginActionError(discardError);
  } finally {
    busyKey.value = '';
  }
}

function selectedIssueMessage(issue: PluginValidationIssue | null): string {
  if (!issue) return '';
  if (issue.code === 'plugin-file-missing') {
    return t('plugins.fileMissingAction', { name: issue.pluginName || selectedName.value });
  }
  const baseMissing = issue.message.match(/requires missing base plugin (.+)$/i);
  if (baseMissing) {
    return t('plugins.baseMissingAction', {
      name: issue.pluginName || selectedName.value,
      dependency: baseMissing[1],
    });
  }
  const baseDisabled = issue.message.match(/requires enabled base plugin (.+)$/i);
  if (baseDisabled) {
    return t('plugins.baseDisabledAction', {
      name: issue.pluginName || selectedName.value,
      dependency: baseDisabled[1],
    });
  }
  const order = issue.message.match(/must be ordered (after|before)(?: base plugin)? (.+)$/i);
  if (order) {
    return t(order[1].toLowerCase() === 'before'
      ? 'plugins.orderBeforeAction'
      : 'plugins.orderAfterAction', {
      name: issue.pluginName || selectedName.value,
      dependency: order[2],
    });
  }
  return formatUserFacingErrorMessage(issue.message, 'general', language.value);
}

function formatPluginActionError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || '');
  const missingFile = raw.match(/\[PLUGIN_FILE_MISSING\]\s*([^\r\n]+)/i);
  if (missingFile) return t('plugins.enableMissingFile', { name: missingFile[1].trim() });
  const dependency = raw.match(/\[PLUGIN_DEPENDENCY_CONFLICT\]\s*(.+)$/i);
  if (dependency) {
    return selectedIssueMessage({
      severity: 'error',
      code: dependencyCode(dependency[1]),
      message: dependency[1],
      pluginName: dependency[1].match(/^Plugin\s+(\S+)/i)?.[1],
    });
  }
  return formatUserFacingErrorMessage(value, 'general', language.value);
}

function dependencyCode(message: string): string {
  if (/requires missing base plugin/i.test(message)) return 'plugin-base-missing';
  if (/requires enabled base plugin/i.test(message)) return 'plugin-base-disabled';
  if (/ordered before/i.test(message)) return 'plugin-order-before-invalid';
  return 'plugin-order-after-invalid';
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizeStartX = event.clientX;
  resizeStartWidth = listWidth.value;
  window.addEventListener('pointermove', resizePanel);
  window.addEventListener('pointerup', finishResize, { once: true });
  document.body.classList.add('plugin-pane-resizing');
}

function resizePanel(event: PointerEvent): void {
  const containerWidth = layoutElement.value?.getBoundingClientRect().width || 0;
  const viewportMaximum = containerWidth > 0 ? containerWidth - 420 : 560;
  listWidth.value = clampPluginListWidth(
    Math.min(viewportMaximum, resizeStartWidth + event.clientX - resizeStartX),
  );
}

function finishResize(): void {
  stopResize();
  workspaceStore.patchLayout({ pluginListWidth: listWidth.value });
}

function stopResize(): void {
  window.removeEventListener('pointermove', resizePanel);
  window.removeEventListener('pointerup', finishResize);
  document.body.classList.remove('plugin-pane-resizing');
}

function resizeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  listWidth.value = clampPluginListWidth(
    listWidth.value + (event.key === 'ArrowLeft' ? -16 : 16),
  );
  workspaceStore.patchLayout({ pluginListWidth: listWidth.value });
}
</script>

<template>
  <div class="console-subpage plugins-pane">
    <div v-if="!projectStore.currentProject" class="state">
      {{ t('plugins.selectProjectFirst') }}
    </div>
    <div v-else-if="loading" class="state">{{ t('plugins.loadingConfig') }}</div>
    <div v-else-if="loadFailed" class="state load-failed" role="alert">
      <p>{{ t('plugins.loadFailed') }}</p>
      <button type="button" @click="loadPlugins">{{ t('plugins.retryLoad') }}</button>
    </div>
    <div
      v-else
      ref="layoutElement"
      class="plugins-layout"
      :style="{ '--plugin-list-width': `${listWidth}px` }"
    >
      <aside class="plugin-list-panel">
        <div class="panel-title">
          <span>{{ t('plugins.listTitle') }}</span>
          <span class="panel-actions">
            <button
              type="button"
              :title="t('plugins.install')"
              :aria-label="t('plugins.install')"
              :disabled="Boolean(busyKey)"
              @click="installPlugin"
            >
              <Plus />
            </button>
            <button
              type="button"
              :title="t('plugins.refresh')"
              :aria-label="t('plugins.refresh')"
              :disabled="Boolean(busyKey)"
              @click="loadPlugins"
            >
              <Refresh />
            </button>
          </span>
        </div>

        <ConsoleSearchInput v-model="search" :placeholder="t('plugins.searchPlaceholder')" />
        <p v-if="query" class="reorder-hint">{{ t('plugins.clearSearchToReorder') }}</p>
        <div v-if="error" class="status error" role="alert">{{ error }}</div>
        <div v-if="actionMessage" class="status success" role="status">{{ actionMessage }}</div>

        <div class="plugin-list">
          <section class="plugin-group">
            <h3>{{ t('plugins.configuredGroup') }}</h3>
            <div
              v-for="(plugin, index) in filteredPlugins"
              :key="`${plugin.index}:${plugin.name}`"
              :ref="(element) => setPluginRowElement(configuredRowKey(plugin.index), element)"
              class="plugin-row"
              :class="{
                active: selectedPlugin?.name === plugin.name,
                disabled: !plugin.status,
                broken: plugin.name && !plugin.fileExists,
                'drop-before': dropIndex === plugin.index,
                'drop-after': index === filteredPlugins.length - 1 && dropIndex === plugins.length,
              }"
              role="button"
              tabindex="0"
              :aria-pressed="selectedPlugin?.name === plugin.name"
              @click="selectPlugin(plugin)"
              @dblclick="openParameterDialog(plugin)"
              @keydown="pluginKeydown($event, plugin)"
              @dragover="dragOver($event, plugin.index)"
              @drop="finishDrop"
            >
              <span
                class="drag-handle"
                :class="{ locked: reorderLocked }"
                :draggable="!reorderLocked"
                :title="reorderLocked ? t('plugins.clearSearchToReorder') : t('plugins.dragToReorder')"
                :aria-label="t('plugins.dragToReorder')"
                @dragstart.stop="startDrag($event, plugin)"
                @dragend="clearDrag"
                @dblclick.stop
              >
                <svg
                  class="drag-handle-dots"
                  viewBox="0 0 12 18"
                  aria-hidden="true"
                >
                  <circle cx="3" cy="4" r="1.5" />
                  <circle cx="9" cy="4" r="1.5" />
                  <circle cx="3" cy="9" r="1.5" />
                  <circle cx="9" cy="9" r="1.5" />
                  <circle cx="3" cy="14" r="1.5" />
                  <circle cx="9" cy="14" r="1.5" />
                </svg>
              </span>
              <span class="plugin-main">
                <span class="plugin-title-line">
                  <PluginEngineTags :targets="plugin.header.target" />
                  <strong>{{ plugin.name || `#${plugin.index + 1}` }}</strong>
                </span>
                <small v-if="plugin.name.includes('/')">{{ plugin.fileRelativePath }}</small>
                <small>{{ plugin.header.plugindesc || plugin.description || t('plugins.noDescription') }}</small>
                <em v-if="!plugin.fileExists">{{ t('plugins.fileMissingShort') }}</em>
              </span>
              <span class="plugin-enabled-switch" @click.stop @dblclick.stop>
                <el-switch
                  :model-value="plugin.status"
                  size="small"
                  :disabled="Boolean(busyKey) || (!plugin.status && !plugin.fileExists)"
                  :aria-label="plugin.status ? t('plugins.disable') : t('plugins.enable')"
                  @change="togglePlugin(plugin, Boolean($event))"
                />
              </span>
            </div>
            <div v-if="!filteredPlugins.length" class="empty">
              {{ plugins.length ? t('plugins.noMatch') : t('plugins.noEntries') }}
            </div>
          </section>

          <section v-if="filteredFiles.length || unconfiguredFiles.length" class="plugin-group unconfigured-group">
            <h3>{{ t('plugins.unconfiguredFiles') }}</h3>
            <div
              v-for="file in filteredFiles"
              :key="file.relativePath"
              :ref="(element) => setPluginRowElement(fileKey(file.relativePath), element)"
              class="plugin-row file-row"
              :class="{ active: selectedFile?.relativePath === file.relativePath, deleted: file.deleted }"
              role="button"
              tabindex="0"
              :aria-pressed="selectedFile?.relativePath === file.relativePath"
              @click="selectFile(file)"
              @keydown="fileKeydown($event, file)"
            >
              <span class="file-spacer" />
              <span class="plugin-main">
                <span class="plugin-title-line">
                  <PluginEngineTags :targets="file.header.target" />
                  <strong>{{ file.name }}</strong>
                </span>
                <small>{{ file.header.plugindesc || file.header.displayPath }}</small>
                <em v-if="file.deleted">{{ t('plugins.pendingDelete') }}</em>
              </span>
              <button
                v-if="!file.deleted"
                type="button"
                class="row-action"
                :disabled="Boolean(busyKey)"
                @click.stop="addExistingFile(file)"
                @dblclick.stop
              >
                {{ t('plugins.addToConfiguration') }}
              </button>
            </div>
            <div v-if="unconfiguredFiles.length && !filteredFiles.length" class="empty">
              {{ t('plugins.noMatch') }}
            </div>
          </section>
        </div>
      </aside>

      <div
        class="pane-resizer"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('plugins.resizeList')"
        :aria-valuemin="PLUGIN_LIST_MIN_WIDTH"
        :aria-valuemax="PLUGIN_LIST_MAX_WIDTH"
        :aria-valuenow="listWidth"
        tabindex="0"
        @pointerdown="startResize"
        @keydown="resizeKeydown"
      />

      <main class="plugin-detail-panel">
        <template v-if="selectedItem && selectedHeader">
          <header class="detail-header">
            <div class="detail-identity">
              <div class="detail-title-line">
                <PluginEngineTags :targets="selectedHeader.target" />
                <strong>{{ selectedName }}</strong>
              </div>
              <span>{{ selectedPath }}</span>
            </div>
            <div class="detail-actions">
              <button
                v-if="selectedPlugin && hasConfigurableParameters(selectedPlugin)"
                type="button"
                class="primary-action"
                :disabled="Boolean(busyKey)"
                @click="openParameterDialog(selectedPlugin)"
              >
                {{ t('plugins.configureParameters') }}
              </button>
              <button
                v-if="selectedPlugin"
                type="button"
                class="danger-action"
                :disabled="Boolean(busyKey)"
                @click="openDeleteConfiguredDialog(selectedPlugin)"
              >
                {{ t('plugins.delete') }}
              </button>
              <button
                v-else-if="selectedFile && !selectedFile.deleted"
                type="button"
                :disabled="Boolean(busyKey)"
                @click="addExistingFile(selectedFile)"
              >
                {{ t('plugins.addToConfiguration') }}
              </button>
              <button
                v-if="selectedFile && !selectedFile.deleted"
                type="button"
                class="danger"
                :disabled="Boolean(busyKey)"
                @click="deleteUnconfiguredFile(selectedFile)"
              >
                {{ t('plugins.deleteFile') }}
              </button>
            </div>
          </header>

          <div v-if="selectedIssue" class="actionable-error" role="alert">
            {{ selectedIssueMessage(selectedIssue) }}
          </div>

          <section class="metadata-card">
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item
                v-if="selectedHeader.target.length"
                :label="t('plugins.metadataTarget')"
                :label-class-name="selectedTargetMismatch ? 'compatibility-label' : ''"
                :class-name="selectedTargetMismatch ? 'compatibility-content' : ''"
              >
                <div class="target-metadata">
                  <span>{{ selectedHeader.target.join(' / ') }}</span>
                  <strong v-if="selectedTargetWarning" role="alert">
                    {{ selectedTargetWarning }}
                  </strong>
                </div>
              </el-descriptions-item>
              <el-descriptions-item :label="t('plugins.metadataDescription')">
                {{ selectedDescription }}
              </el-descriptions-item>
              <el-descriptions-item
                v-if="selectedHeader.author"
                :label="t('plugins.metadataAuthor')"
              >
                {{ selectedHeader.author }}
              </el-descriptions-item>
              <el-descriptions-item
                v-if="selectedHeader.url"
                :label="t('plugins.metadataUrl')"
              >
                <button
                  v-if="selectedHeader.urlHref"
                  type="button"
                  class="metadata-link"
                  @click="openPluginUrl"
                >
                  {{ selectedHeader.url }}
                </button>
                <span v-else>{{ selectedHeader.url }}</span>
              </el-descriptions-item>
              <el-descriptions-item
                v-if="selectedHeader.base.length"
                :label="t('plugins.metadataBase')"
              >
                <div class="plugin-reference-list">
                  <button
                    v-for="dependency in selectedHeader.base"
                    :key="`base:${dependency}`"
                    type="button"
                    class="metadata-reference"
                    :disabled="!pluginReferenceAvailable(dependency)"
                    :title="pluginReferenceLabel(dependency)"
                    :aria-label="pluginReferenceLabel(dependency)"
                    @click="navigateToPluginReference(dependency)"
                  >
                    {{ dependency }}
                  </button>
                </div>
              </el-descriptions-item>
              <el-descriptions-item
                v-if="selectedHeader.orderAfter.length"
                :label="t('plugins.metadataOrderAfter')"
              >
                <div class="plugin-reference-list">
                  <button
                    v-for="dependency in selectedHeader.orderAfter"
                    :key="`order-after:${dependency}`"
                    type="button"
                    class="metadata-reference"
                    :disabled="!pluginReferenceAvailable(dependency)"
                    :title="pluginReferenceLabel(dependency)"
                    :aria-label="pluginReferenceLabel(dependency)"
                    @click="navigateToPluginReference(dependency)"
                  >
                    {{ dependency }}
                  </button>
                </div>
              </el-descriptions-item>
            </el-descriptions>
          </section>

          <section class="help-panel">
            <el-tabs
              v-if="selectedHelpTabs.length"
              v-model="activeHelpTab"
              type="card"
              class="help-language-tabs"
            >
              <el-tab-pane
                v-for="tab in selectedHelpTabs"
                :key="tab.id"
                :label="tab.label"
                :name="tab.id"
              >
                <pre v-if="tab.content">{{ tab.content }}</pre>
                <div v-else class="help-empty">{{ t('plugins.noHelpForLanguage') }}</div>
              </el-tab-pane>
            </el-tabs>
            <div v-else class="help-empty">{{ t('plugins.noHelp') }}</div>
          </section>

          <footer v-if="stagingDirty" class="staging-bar">
            <span>{{ t('plugins.stagingSourceUntouched') }}</span>
            <div>
              <button type="button" :disabled="Boolean(busyKey)" @click="discardPluginStaging">
                {{ t('editor.toolbar.discard') }}
              </button>
              <button
                type="button"
                class="primary"
                :disabled="Boolean(busyKey)"
                @click="applyPluginStaging"
              >
                {{ t('editor.toolbar.applyStaging') }}
              </button>
            </div>
          </footer>
        </template>
        <div v-else class="state">{{ t('plugins.emptySelection') }}</div>
      </main>
    </div>

    <PluginParameterDialog
      v-model="parameterDialogOpen"
      :busy="busyKey.startsWith('params:')"
      :plugin="parameterDialogPlugin"
      :catalog="editorCatalog"
      :error-message="parameterDialogError"
      @closed="closeParameterDialogState"
      @save="saveParameters"
      @catalog-changed="refreshEditorCatalog"
    />
    <PluginDeleteDialog
      :visible="deleteDialogOpen"
      :busy="busyKey.startsWith('delete:') || busyKey.startsWith('remove-config:')"
      :plugin-name="deleteTargetName"
      :plugin-path="deleteTargetPath"
      @close="closeDeleteConfiguredDialog"
      @remove-configuration="deleteConfiguredPlugin('configuration')"
      @delete-file="deleteConfiguredPlugin('file')"
    />
  </div>
</template>

<style scoped>
.plugins-pane {
  height: 100%;
  min-height: 0;
  background: var(--console-page, #f4efe7);
  color: var(--console-text, #211d17);
}
.plugins-layout {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--plugin-list-width, 380px) 7px minmax(0, 1fr);
  padding: 16px 40px 28px;
}
.plugin-list-panel,
.plugin-detail-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 14px;
  background: var(--console-paper, #fffdfa);
}
.panel-title {
  min-height: 52px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  color: var(--console-text-soft, #5a5247);
  font-size: 12px;
  font-weight: 650;
}
.panel-actions {
  display: flex;
  gap: 4px;
}
.panel-title button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--console-text-muted, #9a8e7e);
  cursor: pointer;
}
.panel-title button:hover:not(:disabled) {
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-accent, #be5630);
}
.panel-title button :deep(svg) {
  width: 15px;
}
.plugin-list-panel :deep(.console-search-input) {
  flex: 0 0 auto;
  margin: 12px 12px 8px;
}
.reorder-hint,
.status {
  margin: 0 12px 8px;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 10px;
  line-height: 1.45;
}
.reorder-hint {
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-muted, #9a8e7e);
}
.status.error {
  background: var(--app-danger-soft);
  color: var(--app-danger);
}
.status.success {
  background: var(--app-ok-soft);
  color: var(--app-ok);
}
.plugin-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 10px 10px;
}
.plugin-group h3 {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  padding: 10px 8px 7px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-muted, #9a8e7e);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.unconfigured-group {
  margin-top: 8px;
  border-top: 1px solid var(--console-border, #e4dcce);
}
.plugin-row {
  position: relative;
  min-height: 44px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 0;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  border-radius: 0;
  color: var(--console-text, #211d17);
  cursor: default;
}
.plugin-row:hover {
  background: var(--console-paper-soft, #faf5ec);
}
.plugin-row.active {
  background: var(--console-accent-soft, #f6e3d7);
  box-shadow: inset 3px 0 var(--console-accent, #be5630);
}
.plugin-row:focus-visible,
.pane-resizer:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--console-accent, #be5630);
  outline-offset: 2px;
}
.plugin-row.drop-before::before,
.plugin-row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--console-accent, #be5630);
}
.plugin-row.drop-before::before {
  top: -2px;
}
.plugin-row.drop-after::after {
  bottom: -2px;
}
.drag-handle {
  width: 22px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--console-text-muted, #9a8e7e);
  cursor: grab;
}
.drag-handle:hover {
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
}
.drag-handle.locked {
  opacity: .35;
  cursor: not-allowed;
}
.drag-handle-dots {
  width: 12px;
  height: 18px;
  fill: currentColor;
}
.plugin-enabled-switch {
  width: 36px;
  height: 32px;
  display: grid;
  place-items: center;
}
.plugin-enabled-switch :deep(.el-switch) {
  --el-switch-on-color: var(--console-accent, #be5630);
  --el-switch-off-color: var(--console-border-strong, #ddd3c2);
  height: 32px;
}
.plugin-enabled-switch :deep(.el-switch__core) {
  min-width: 32px;
}
.plugin-main {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.plugin-title-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}
.plugin-main strong,
.plugin-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-main strong {
  min-width: 0;
  font-size: 11.5px;
}
.plugin-main small {
  color: var(--console-text-muted, #9a8e7e);
  font-size: 9.5px;
}
.plugin-main em {
  color: var(--app-danger);
  font-size: 10px;
  font-style: normal;
}
.plugin-row.disabled .plugin-main {
  opacity: .68;
}
.file-row {
  grid-template-columns: 22px minmax(0, 1fr) auto;
}
.file-row.deleted {
  opacity: .62;
}
.row-action {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 7px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.empty,
.state {
  min-height: 110px;
  display: grid;
  place-items: center;
  padding: 20px;
  color: var(--console-text-muted, #9a8e7e);
  font-size: 12px;
  text-align: center;
}
.state {
  height: 100%;
}
.load-failed {
  align-content: center;
  gap: 12px;
}
.load-failed p {
  margin: 0;
}
.load-failed button {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 8px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  font: inherit;
  cursor: pointer;
}
.pane-resizer {
  position: relative;
  cursor: col-resize;
  touch-action: none;
}
.pane-resizer::after {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 3px;
  width: 1px;
  background: var(--console-border-strong, #ddd3c2);
  transition: background-color .15s ease, width .15s ease;
}
.pane-resizer:hover::after,
.pane-resizer:focus-visible::after {
  width: 2px;
  background: var(--console-accent, #be5630);
}
.plugin-detail-panel {
  margin-left: 0;
}
.detail-header {
  min-height: 58px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 16px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
}
.detail-identity {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.detail-title-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-header strong,
.detail-identity > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-header strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.detail-identity > span {
  color: var(--console-text-muted, #9a8e7e);
  font: 10px var(--app-font-mono);
}
.detail-actions,
.staging-bar > div {
  flex: 0 0 auto;
  display: flex;
  gap: 14px;
}
.detail-actions button,
.staging-bar button {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 8px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.detail-actions button.primary-action {
  border-color: var(--app-tone-control);
  background: var(--app-tone-control);
  color: #fff;
  font-weight: 650;
}
.detail-actions button.danger-action {
  border-color: var(--app-danger);
  background: var(--app-danger);
  color: #fff;
  font-weight: 650;
}
.detail-actions button.primary-action:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--app-tone-control) 84%, #000);
  background: color-mix(in srgb, var(--app-tone-control) 84%, #000);
}
.detail-actions button.danger-action:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--app-danger) 84%, #000);
  background: color-mix(in srgb, var(--app-danger) 84%, #000);
}
.detail-actions button:hover:not(:disabled),
.staging-bar button:hover:not(:disabled),
.row-action:hover:not(:disabled) {
  border-color: var(--console-accent, #be5630);
}
.actionable-error {
  flex: 0 0 auto;
  margin: 12px 14px 0;
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--app-danger-soft);
  color: var(--app-danger);
  font-size: 11px;
  line-height: 1.5;
}
.metadata-card {
  flex: 0 0 auto;
  margin: 14px 14px 0;
  overflow: hidden;
  border-radius: 10px;
}
.metadata-card :deep(.el-descriptions__table) {
  table-layout: fixed;
}
.metadata-card :deep(.el-descriptions__cell) {
  border-color: var(--console-border, #e4dcce) !important;
  font-size: 11px;
  line-height: 1.5;
}
.metadata-card :deep(.el-descriptions__label.el-descriptions__cell.is-bordered-label) {
  width: 112px;
  padding: 8px 12px;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-muted, #9a8e7e);
  font-weight: 500;
}
.metadata-card :deep(.el-descriptions__content.el-descriptions__cell.is-bordered-content) {
  padding: 8px 12px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text, #211d17);
  overflow-wrap: anywhere;
}
.metadata-card :deep(.compatibility-label),
.metadata-card :deep(.compatibility-content) {
  border-color: color-mix(in srgb, var(--app-danger) 40%, var(--console-border, #e4dcce)) !important;
  background: var(--app-danger-soft) !important;
}
.metadata-card :deep(.compatibility-label) {
  color: var(--app-danger) !important;
}
.target-metadata {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.target-metadata strong {
  color: var(--app-danger);
  font-size: 10px;
  font-weight: 650;
}
.metadata-link {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--console-accent, #be5630);
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.plugin-reference-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.metadata-reference {
  min-height: 26px;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--app-tone-control) 34%, var(--console-border, #e4dcce));
  border-radius: 5px;
  background: color-mix(in srgb, var(--app-tone-control) 7%, var(--console-paper, #fffdfa));
  color: var(--app-tone-control);
  font: inherit;
  cursor: pointer;
}
.metadata-reference:hover:not(:disabled) {
  border-color: var(--app-tone-control);
  background: color-mix(in srgb, var(--app-tone-control) 13%, var(--console-paper, #fffdfa));
}
.metadata-reference:disabled {
  border-color: transparent;
  background: transparent;
  color: var(--console-text, #211d17);
  cursor: default;
  opacity: 1;
}
.help-panel {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 14px;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 10px;
}
.help-language-tabs {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.help-language-tabs :deep(.el-tabs__header) {
  flex: 0 0 auto;
  margin: 0;
  background: var(--console-paper-soft, #faf5ec);
}
.help-language-tabs :deep(.el-tabs__nav) {
  border: 0;
}
.help-language-tabs :deep(.el-tabs__item) {
  min-width: 76px;
  height: 38px;
  padding: 0 16px;
  border-top: 0;
  border-color: var(--console-border, #e4dcce);
  color: var(--console-text-muted, #9a8e7e);
  font-size: 11px;
}
.help-language-tabs :deep(.el-tabs__item.is-active) {
  background: var(--console-paper, #fffdfa);
  color: var(--console-accent, #be5630);
}
.help-language-tabs :deep(.el-tabs__content) {
  min-height: 0;
  flex: 1;
}
.help-language-tabs :deep(.el-tab-pane) {
  height: 100%;
}
.help-panel pre {
  height: 100%;
  margin: 0;
  padding: 18px 20px;
  overflow: auto;
  scrollbar-gutter: stable;
  background: color-mix(
    in srgb,
    var(--console-paper-soft, #faf5ec) 62%,
    var(--console-paper, #fffdfa)
  );
  color: var(--console-text, #211d17);
  font: 13px/1.8 "Microsoft YaHei", "Microsoft YaHei UI", "微软雅黑", var(--app-font-sans);
  font-variant-ligatures: none;
  letter-spacing: .01em;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.help-panel pre::selection {
  background: color-mix(in srgb, var(--console-accent, #be5630) 24%, transparent);
  color: var(--console-text, #211d17);
}
.help-empty {
  min-height: 120px;
  height: 100%;
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--console-text-muted, #9a8e7e);
  font-size: 11px;
}
.staging-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-top: 1px solid var(--console-border, #e4dcce);
  background: var(--console-accent-soft, #f6e3d7);
  color: var(--console-text-soft, #5a5247);
  font-size: 10px;
}
.staging-bar button.primary {
  border-color: var(--console-accent, #be5630);
  background: var(--console-accent, #be5630);
  color: #fff;
}
button:disabled {
  opacity: .45;
  cursor: not-allowed;
}
:global(body.plugin-pane-resizing) {
  cursor: col-resize;
  user-select: none;
}
@media (max-width: 760px) {
  .plugins-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(280px, 42%) minmax(320px, 1fr);
    gap: 8px;
    padding: 14px 24px 24px;
  }
  .pane-resizer {
    display: none;
  }
  .detail-header,
  .staging-bar {
    align-items: flex-start;
    flex-direction: column;
    padding-top: 10px;
    padding-bottom: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pane-resizer::after {
    transition: none;
  }
}
</style>
