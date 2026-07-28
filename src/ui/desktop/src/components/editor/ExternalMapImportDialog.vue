<template>
  <el-dialog
    class="external-map-import-dialog"
    :model-value="visible"
    :title="mode === 'replace' ? t('editor.import.titleReplace') : t('editor.import.title')"
    width="min(880px, calc(100vw - 32px))"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div v-if="isReplace" class="replace-target-banner">
      {{ t('editor.import.replaceTarget', { id: targetMapId ?? 0, name: targetMapName || '' }) }}
    </div>
    <!-- Source project -->
    <section class="import-section">
      <div class="section-head">
        <span class="section-title">{{ t('editor.import.sourceSection') }}</span>
        <el-button size="small" :loading="browsing" @click="browse">
          {{ source ? t('editor.import.changeSource') : t('editor.import.chooseSource') }}
        </el-button>
      </div>
      <div v-if="!source" class="empty-hint">{{ t('editor.import.noSource') }}</div>
      <template v-else>
        <div class="source-line">
          <span class="source-name">{{ source.name }}</span>
          <span class="source-path">{{ source.sourceProjectPath }}</span>
        </div>
        <el-alert v-if="blockedMessage" :title="blockedMessage" type="error" :closable="false" show-icon />
      </template>
    </section>

    <!-- Map selection -->
    <section v-if="source && !blockedMessage" class="import-section">
      <div class="section-title">{{ isReplace ? t('editor.import.selectOneMap') : t('editor.import.mapsSection') }}</div>
      <el-empty v-if="!source.maps.length" :description="t('editor.import.noMaps')" :image-size="60" />
      <div v-else class="map-tree-wrap">
        <el-tree
          v-if="isReplace"
          :data="mapTree"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @node-click="onMapClick"
        >
          <template #default="{ data }">
            <span class="map-node"><span class="map-id">{{ data.id }}</span>{{ data.label }}</span>
          </template>
        </el-tree>
        <el-tree
          v-else
          :data="mapTree"
          show-checkbox
          node-key="id"
          default-expand-all
          :expand-on-click-node="false"
          @check="onMapCheck"
        >
          <template #default="{ data }">
            <span class="map-node"><span class="map-id">{{ data.id }}</span>{{ data.label }}</span>
          </template>
        </el-tree>
      </div>
      <div class="options-row">
        <template v-if="isReplace">
          <el-checkbox v-model="replaceOptions.overwriteEvents">{{ t('editor.import.overwriteEvents') }}</el-checkbox>
          <el-checkbox v-model="replaceOptions.validateEventResources" :disabled="!replaceOptions.overwriteEvents">
            {{ t('editor.import.validateEventResources') }}
          </el-checkbox>
        </template>
        <template v-else>
          <el-checkbox v-model="options.includeEvents">{{ t('editor.import.includeEvents') }}</el-checkbox>
          <el-checkbox v-model="options.validateEventResources" :disabled="!options.includeEvents">
            {{ t('editor.import.validateEventResources') }}
          </el-checkbox>
        </template>
      </div>
    </section>

    <!-- Scan results -->
    <section v-if="scan" class="import-section">
      <div class="scan-summary">
        {{ t('editor.import.summary', { maps: scan.maps.length, assets: newAssetCount, conflicts: conflictRows.length }) }}
      </div>

      <template v-if="scan.tilesets.length">
        <div class="section-title">{{ t('editor.import.tilesetsSection') }}</div>
        <el-table :data="scan.tilesets" size="small" class="import-table">
          <el-table-column :label="t('editor.import.col.tileset')" min-width="180">
            <template #default="{ row }"><span class="asset-cell"><span class="map-id">{{ row.sourceTilesetId }}</span>{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column :label="t('editor.import.col.action')" width="150">
            <template #default="{ row }">
              <el-select v-model="tilesetActions[row.sourceTilesetId].action" size="small" style="width: 100%">
                <el-option :label="t('editor.import.action.add')" value="add" />
                <el-option :label="t('editor.import.action.overwrite')" value="overwrite" />
                <el-option :label="t('editor.import.action.ignore')" value="ignore" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column :label="t('editor.import.col.targetTileset')" min-width="200">
            <template #default="{ row }">
              <el-select
                v-if="showTilesetTarget(row.sourceTilesetId)"
                v-model="tilesetActions[row.sourceTilesetId].targetTilesetId"
                size="small"
                filterable
                :placeholder="t('editor.import.selectTarget')"
                style="width: 100%"
              >
                <el-option v-for="ts in targetTilesets" :key="ts.id" :label="`${ts.id} · ${ts.name}`" :value="ts.id" />
              </el-select>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-if="conflictRows.length">
        <div class="section-title">{{ t('editor.import.resourcesSection') }}</div>
        <el-table :data="conflictRows" size="small" class="import-table">
          <el-table-column :label="t('editor.import.col.asset')" min-width="240">
            <template #default="{ row }"><span class="asset-cell"><span class="asset-cat">{{ row.category }}</span>{{ row.name }}</span></template>
          </el-table-column>
          <el-table-column :label="t('editor.import.col.status')" width="110">
            <template #default="{ row }"><span :class="`status-${row.status}`">{{ statusText(row.status) }}</span></template>
          </el-table-column>
          <el-table-column :label="t('editor.import.col.action')" width="150">
            <template #default="{ row }">
              <el-select v-model="resourceActions[row.key]" size="small" style="width: 100%">
                <el-option :label="t('editor.import.action.add')" value="add" />
                <el-option :label="t('editor.import.action.overwrite')" value="overwrite" />
                <el-option :label="t('editor.import.action.ignore')" value="ignore" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <el-alert
        v-for="warning in scan.warnings"
        :key="warning.code"
        :title="warning.message"
        type="warning"
        :closable="false"
        show-icon
        class="scan-warning"
      />
    </section>

    <template #footer>
      <el-button size="small" @click="handleClose">{{ t('editor.import.cancel') }}</el-button>
      <el-button v-if="!scan" size="small" type="primary" :loading="scanning" :disabled="!canScan" @click="scanNow">
        {{ t('editor.import.scan') }}
      </el-button>
      <el-button v-else size="small" type="primary" :loading="applying" :disabled="!canApply" @click="applyNow">
        {{ t('editor.import.apply') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  maps as mapsApi,
  type ExternalMapImportOptions,
  type ExternalMapReplaceOptions,
  type ExternalMapImportScanResult,
  type ExternalMapResourceAction,
  type ExternalMapResourceStatus,
  type ExternalProjectBrowseResult,
  type TilesetSummary,
} from '../../api/client';
import { useI18n, type MessageKey } from '../../i18n';

const props = withDefaults(defineProps<{
  visible: boolean;
  project: string;
  anchorParentId: number;
  mode?: 'import' | 'replace';
  targetMapId?: number;
  targetMapName?: string;
}>(), { mode: 'import' });

const emit = defineEmits<{ close: []; applied: [payload: { mapIds: number[] }] }>();

const { t } = useI18n();

// Dynamic message keys must be resolved through a typed lookup so vue-tsc keeps t() type-safe.
const statusLabel: Record<ExternalMapResourceStatus, MessageKey> = {
  missing: 'editor.import.status.missing',
  same: 'editor.import.status.same',
  conflict: 'editor.import.status.conflict',
};

interface MapTreeNode { id: number; label: string; children?: MapTreeNode[] }
interface TilesetResolution { action: ExternalMapResourceAction; targetTilesetId?: number }

const source = ref<ExternalProjectBrowseResult | null>(null);
const browsing = ref(false);
const scanning = ref(false);
const applying = ref(false);
const selectedMapIds = ref<number[]>([]);
const options = reactive<ExternalMapImportOptions>({ includeEvents: true, validateEventResources: true });
const replaceOptions = reactive<ExternalMapReplaceOptions>({ overwriteEvents: false, validateEventResources: true });
const isReplace = computed(() => props.mode === 'replace');
const scan = ref<ExternalMapImportScanResult | null>(null);
const resourceActions = ref<Record<string, ExternalMapResourceAction>>({});
const tilesetActions = ref<Record<number, TilesetResolution>>({});
const targetTilesets = ref<TilesetSummary[]>([]);

const blockedMessage = computed(() => source.value?.blocked?.message || '');

const mapTree = computed<MapTreeNode[]>(() => {
  const maps = source.value?.maps || [];
  const byId = new Map<number, MapTreeNode>();
  for (const map of maps) byId.set(map.id, { id: map.id, label: map.name, children: [] });
  const roots: MapTreeNode[] = [];
  for (const map of maps) {
    const node = byId.get(map.id)!;
    const parent = map.parentId ? byId.get(map.parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  const prune = (nodes: MapTreeNode[]): void => {
    for (const node of nodes) {
      if (node.children && node.children.length) prune(node.children);
      else delete node.children;
    }
  };
  prune(roots);
  return roots;
});

// Tileset image slots are governed by their owning tileset's action, so the per-asset
// conflict table only surfaces free-standing resource conflicts the user must resolve.
const conflictRows = computed(() =>
  (scan.value?.resources || []).filter((row) => row.status === 'conflict' && row.tilesetSourceId == null));
const newAssetCount = computed(() =>
  (scan.value?.resources || []).filter((row) => row.status === 'missing').length);

const canScan = computed(() => Boolean(source.value && !blockedMessage.value && selectedMapIds.value.length));
const canApply = computed(() => {
  if (!scan.value) return false;
  return scan.value.tilesets.every((row) => {
    const resolution = tilesetActions.value[row.sourceTilesetId];
    if (!resolution || resolution.action === 'add') return true;
    // Replace mode: an ignored tileset reuses the target map's own tilesetId, no pick needed.
    if (resolution.action === 'ignore' && isReplace.value) return true;
    return resolution.targetTilesetId != null;
  });
});

watch(() => props.visible, (open) => {
  if (!open) return;
  source.value = null;
  scan.value = null;
  selectedMapIds.value = [];
  options.includeEvents = true;
  options.validateEventResources = true;
  replaceOptions.overwriteEvents = false;
  replaceOptions.validateEventResources = true;
  resourceActions.value = {};
  tilesetActions.value = {};
  targetTilesets.value = [];
});

// A stale scan would misrepresent the pending import, so map/option changes drop it.
watch(
  () => [selectedMapIds.value.join(','), options.includeEvents, options.validateEventResources, replaceOptions.overwriteEvents, replaceOptions.validateEventResources],
  () => { scan.value = null; },
);

function onMapCheck(_data: unknown, info: { checkedKeys: Array<number | string> }): void {
  selectedMapIds.value = info.checkedKeys.map(Number);
}

function statusText(status: ExternalMapResourceStatus): string {
  return t(statusLabel[status]);
}

function onMapClick(data: MapTreeNode): void {
  selectedMapIds.value = [data.id];
}

// Import needs a target tileset for ignore + overwrite; replace only needs it for overwrite
// (an ignored tileset there reuses the target map's own tilesetId).
function showTilesetTarget(sourceTilesetId: number): boolean {
  const action = tilesetActions.value[sourceTilesetId]?.action;
  if (action === 'overwrite') return true;
  if (action === 'ignore') return !isReplace.value;
  return false;
}

async function browse(): Promise<void> {
  browsing.value = true;
  try {
    const result = await mapsApi.browseExternalProject();
    if (result.canceled) return;
    source.value = result;
    scan.value = null;
    selectedMapIds.value = [];
  } catch (error) {
    ElMessage.error(t('editor.import.browseFailed', { message: (error as Error).message }));
  } finally {
    browsing.value = false;
  }
}

async function scanNow(): Promise<void> {
  if (!source.value?.sourceProjectPath || !selectedMapIds.value.length) return;
  scanning.value = true;
  try {
    const result = isReplace.value
      ? await mapsApi.replaceExternalScan(
          {
            sourceProjectPath: source.value.sourceProjectPath,
            sourceMapId: selectedMapIds.value[0] ?? 0,
            targetMapId: props.targetMapId ?? 0,
            options: { ...replaceOptions },
          },
          props.project,
        )
      : await mapsApi.importExternalScan(
          { sourceProjectPath: source.value.sourceProjectPath, sourceMapIds: [...selectedMapIds.value], options: { ...options } },
          props.project,
        );
    const nextResourceActions: Record<string, ExternalMapResourceAction> = {};
    for (const row of result.resources) nextResourceActions[row.key] = row.defaultAction;
    const nextTilesetActions: Record<number, TilesetResolution> = {};
    for (const row of result.tilesets) nextTilesetActions[row.sourceTilesetId] = { action: row.defaultAction };
    resourceActions.value = nextResourceActions;
    tilesetActions.value = nextTilesetActions;
    try {
      targetTilesets.value = (await mapsApi.tilesets(props.project)).tilesets;
    } catch {
      targetTilesets.value = [];
    }
    scan.value = result;
  } catch (error) {
    ElMessage.error(t('editor.import.scanFailed', { message: (error as Error).message }));
  } finally {
    scanning.value = false;
  }
}

async function applyNow(): Promise<void> {
  if (!source.value?.sourceProjectPath || !scan.value) return;
  applying.value = true;
  try {
    const resolvedResources = Object.entries(resourceActions.value).map(([key, action]) => ({ key, action }));
    const resolvedTilesets = scan.value.tilesets.map((row) => ({
      sourceTilesetId: row.sourceTilesetId,
      action: tilesetActions.value[row.sourceTilesetId]?.action || row.defaultAction,
      targetTilesetId: tilesetActions.value[row.sourceTilesetId]?.targetTilesetId,
    }));
    const result = isReplace.value
      ? await mapsApi.replaceExternalApply(
          {
            sourceProjectPath: source.value.sourceProjectPath,
            sourceMapId: selectedMapIds.value[0] ?? 0,
            targetMapId: props.targetMapId ?? 0,
            options: { ...replaceOptions },
            resources: resolvedResources,
            tilesets: resolvedTilesets,
          },
          props.project,
        )
      : await mapsApi.importExternalApply(
          {
            sourceProjectPath: source.value.sourceProjectPath,
            sourceMapIds: [...selectedMapIds.value],
            anchorParentId: props.anchorParentId,
            options: { ...options },
            resources: resolvedResources,
            tilesets: resolvedTilesets,
          },
          props.project,
        );
    ElMessage.success(isReplace.value
      ? t('editor.import.replaceApplied', { count: result.mapIds.length })
      : t('editor.import.applied', { count: result.mapIds.length }));
    emit('applied', { mapIds: result.mapIds });
    handleClose();
  } catch (error) {
    ElMessage.error(t('editor.import.applyFailed', { message: (error as Error).message }));
  } finally {
    applying.value = false;
  }
}

function handleClose(): void {
  emit('close');
}
</script>

<style scoped>
.import-section { margin-bottom: 18px; }
.import-section:last-child { margin-bottom: 0; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-title { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); }
.section-head .section-title { margin: 0; }
.import-section > .section-title { display: block; margin: 14px 0 8px; }
.empty-hint { padding: 12px; border: 1px dashed var(--el-border-color); border-radius: var(--el-border-radius-base); color: var(--el-text-color-secondary); font-size: 12px; text-align: center; }
.source-line { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: var(--el-border-radius-base); background: var(--el-fill-color-lighter); }
.source-name { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.source-path { font-size: 11px; color: var(--el-text-color-secondary); word-break: break-all; }
.map-tree-wrap { max-height: 240px; overflow-y: auto; padding: 4px 0; border: 1px solid var(--el-border-color-lighter); border-radius: var(--el-border-radius-base); }
.map-node { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.map-id { min-width: 34px; padding: 0 4px; border-radius: 3px; background: var(--el-fill-color); color: var(--el-text-color-secondary); font-size: 11px; text-align: center; }
.options-row { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px; }
.scan-summary { font-size: 13px; color: var(--el-text-color-primary); }
.import-table { margin-top: 4px; }
.asset-cell { display: inline-flex; align-items: center; gap: 6px; }
.asset-cat { padding: 0 4px; border-radius: 3px; background: var(--el-fill-color); color: var(--el-text-color-secondary); font-size: 11px; }
.muted { color: var(--el-text-color-disabled); }
.status-conflict { color: var(--el-color-danger); }
.status-missing { color: var(--el-color-success); }
.status-same { color: var(--el-text-color-secondary); }
.scan-warning { margin-top: 8px; }
.replace-target-banner { margin-bottom: 14px; padding: 8px 12px; border-radius: var(--el-border-radius-base); background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-size: 13px; font-weight: 600; }
:global(.external-map-import-dialog) { display: flex; flex-direction: column; max-height: calc(100vh - 32px); margin: 16px auto !important; }
:global(.external-map-import-dialog .el-dialog__header),
:global(.external-map-import-dialog .el-dialog__footer) { flex: 0 0 auto; }
:global(.external-map-import-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; }
</style>
