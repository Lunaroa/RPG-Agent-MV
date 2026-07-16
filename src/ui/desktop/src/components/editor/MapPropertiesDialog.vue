<template>
  <el-dialog class="map-properties-dialog" :model-value="visible" :title="mode === 'create' ? t('editor.mapProperties.createTitle') : t('editor.mapProperties.editTitle')" width="min(760px, calc(100vw - 32px))" :close-on-click-modal="false" @close="$emit('close')">
    <el-form label-position="top" size="small">
      <div class="property-grid">
        <el-form-item :label="t('editor.mapProperties.name')"><el-input v-model="form.name" autofocus /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.displayName')"><el-input v-model="form.displayName" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item :label="t('editor.mapProperties.width')"><el-input-number v-model="form.width" :min="1" :max="256" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.height')"><el-input-number v-model="form.height" :min="1" :max="256" controls-position="right" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item label="Tileset">
          <el-select v-model="form.tilesetId" style="width: 100%">
            <el-option v-for="tileset in tilesets" :key="tileset.id" :label="`${tileset.id} · ${tileset.name}`" :value="tileset.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('editor.mapProperties.scrollType')">
          <el-select v-model="form.scrollType" style="width: 100%">
            <el-option :label="t('editor.mapProperties.scroll.none')" :value="0" />
            <el-option :label="t('editor.mapProperties.scroll.vertical')" :value="1" />
            <el-option :label="t('editor.mapProperties.scroll.horizontal')" :value="2" />
            <el-option :label="t('editor.mapProperties.scroll.both')" :value="3" />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item v-if="mode === 'create'" :label="t('editor.mapProperties.parentMap')">
        <el-input :model-value="parentLabel" disabled />
      </el-form-item>

      <div class="check-row">
        <el-checkbox v-model="form.disableDashing">{{ t('editor.mapProperties.disableDashing') }}</el-checkbox>
        <el-checkbox v-model="form.specifyBattleback">{{ t('editor.mapProperties.specifyBattleback') }}</el-checkbox>
      </div>
      <div class="property-grid">
        <el-form-item :label="t('editor.mapProperties.battleback1')">
          <button type="button" class="asset-picker-button" :disabled="!form.specifyBattleback" @click="openImagePicker('battleback1Name', 'battlebacks1', t('editor.mapProperties.pickBattleback1'))">{{ imageLabel(form.battleback1Name) }}</button>
        </el-form-item>
        <el-form-item :label="t('editor.mapProperties.battleback2')">
          <button type="button" class="asset-picker-button" :disabled="!form.specifyBattleback" @click="openImagePicker('battleback2Name', 'battlebacks2', t('editor.mapProperties.pickBattleback2'))">{{ imageLabel(form.battleback2Name) }}</button>
        </el-form-item>
      </div>

      <div class="section-title">BGM / BGS</div>
      <div class="check-row">
        <el-checkbox v-model="form.autoplayBgm">{{ t('editor.mapProperties.autoplayBgm') }}</el-checkbox>
        <el-checkbox v-model="form.autoplayBgs">{{ t('editor.mapProperties.autoplayBgs') }}</el-checkbox>
      </div>
      <div class="audio-grid">
        <el-form-item label="BGM">
          <el-select v-model="form.bgm.name" filterable clearable :disabled="!form.autoplayBgm" style="width: 100%">
            <el-option v-for="option in audioOptions('bgm', form.bgm.name)" :key="option.name" :label="option.label" :value="option.name">
              <span :class="{ 'missing-option': option.missing }">{{ option.label }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="t('editor.mapProperties.volume')"><el-input-number v-model="form.bgm.volume" :disabled="!form.autoplayBgm" :min="0" :max="100" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.pitch')"><el-input-number v-model="form.bgm.pitch" :disabled="!form.autoplayBgm" :min="50" :max="150" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.pan')"><el-input-number v-model="form.bgm.pan" :disabled="!form.autoplayBgm" :min="-100" :max="100" controls-position="right" /></el-form-item>
        <el-form-item label="BGS">
          <el-select v-model="form.bgs.name" filterable clearable :disabled="!form.autoplayBgs" style="width: 100%">
            <el-option v-for="option in audioOptions('bgs', form.bgs.name)" :key="option.name" :label="option.label" :value="option.name">
              <span :class="{ 'missing-option': option.missing }">{{ option.label }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="t('editor.mapProperties.volume')"><el-input-number v-model="form.bgs.volume" :disabled="!form.autoplayBgs" :min="0" :max="100" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.pitch')"><el-input-number v-model="form.bgs.pitch" :disabled="!form.autoplayBgs" :min="50" :max="150" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.pan')"><el-input-number v-model="form.bgs.pan" :disabled="!form.autoplayBgs" :min="-100" :max="100" controls-position="right" /></el-form-item>
      </div>

      <div class="section-title">{{ t('editor.mapProperties.parallax') }}</div>
      <div class="property-grid">
        <el-form-item :label="t('editor.mapProperties.parallaxImage')">
          <button type="button" class="asset-picker-button" @click="openImagePicker('parallaxName', 'parallaxes', t('editor.mapProperties.pickParallax'))">{{ imageLabel(form.parallaxName) }}</button>
        </el-form-item>
        <el-form-item :label="t('editor.mapProperties.showInEditor')"><el-checkbox v-model="form.parallaxShow" :disabled="!form.parallaxName" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item :label="t('editor.mapProperties.horizontalScroll')"><el-input-number v-model="form.parallaxSx" :disabled="!form.parallaxLoopX" :min="-32" :max="32" controls-position="right" /></el-form-item>
        <el-form-item :label="t('editor.mapProperties.verticalScroll')"><el-input-number v-model="form.parallaxSy" :disabled="!form.parallaxLoopY" :min="-32" :max="32" controls-position="right" /></el-form-item>
      </div>
      <div class="check-row">
        <el-checkbox v-model="form.parallaxLoopX">{{ t('editor.mapProperties.horizontalLoop') }}</el-checkbox>
        <el-checkbox v-model="form.parallaxLoopY">{{ t('editor.mapProperties.verticalLoop') }}</el-checkbox>
      </div>

      <el-form-item :label="t('editor.mapProperties.encounterStep')" class="half-width"><el-input-number v-model="form.encounterStep" :min="1" :max="999" controls-position="right" /></el-form-item>

      <div class="encounter-heading">
        <div class="section-title">{{ t('editor.mapProperties.encounters') }}</div>
        <el-button size="small" :disabled="!troops.length" @click="addEncounter">{{ t('editor.mapProperties.addEncounter') }}</el-button>
      </div>
      <div v-if="!troops.length" class="empty-hint">{{ t('editor.mapProperties.noTroops') }}</div>
      <div v-else-if="!form.encounterList.length" class="empty-hint">{{ t('editor.mapProperties.noEncounters') }}</div>
      <div v-for="(encounter, encounterIndex) in form.encounterList" :key="encounterIndex" class="encounter-row">
        <div class="encounter-fields">
          <el-form-item :label="t('editor.mapProperties.troop')">
            <el-select v-model="encounter.troopId" filterable style="width: 100%">
              <el-option v-for="troop in troopOptions(encounter.troopId)" :key="troop.id" :label="troop.label" :value="troop.id" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('editor.mapProperties.weight')"><el-input-number v-model="encounter.weight" :min="1" :max="999" controls-position="right" /></el-form-item>
          <el-button size="small" type="danger" plain @click="removeEncounter(encounterIndex)">{{ t('editor.mapProperties.deleteEncounter') }}</el-button>
        </div>
        <div class="region-row">
          <span class="region-label">{{ t('editor.mapProperties.range') }}</span>
          <span v-if="!encounter.regionSet.length" class="entire-map">{{ t('editor.mapProperties.entireMap') }}</span>
          <div v-for="(_, regionIndex) in encounter.regionSet" :key="regionIndex" class="region-control">
            <el-input-number v-model="encounter.regionSet[regionIndex]" :min="1" :max="255" controls-position="right" />
            <el-button size="small" @click="removeRegion(encounter, regionIndex)">{{ t('editor.mapProperties.removeRegion') }}</el-button>
          </div>
          <el-button size="small" :disabled="encounter.regionSet.length >= 3" @click="addRegion(encounter)">{{ t('editor.mapProperties.addRegion') }}</el-button>
        </div>
      </div>

      <el-form-item :label="t('editor.mapProperties.note')" class="map-note">
        <el-input v-model="form.note" type="textarea" :rows="4" resize="vertical" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button size="small" @click="$emit('close')">{{ t('editor.mapProperties.cancel') }}</el-button>
      <el-button size="small" type="primary" :loading="busy" @click="$emit('save')">{{ mode === 'create' ? t('editor.mapProperties.createAction') : t('editor.mapProperties.saveAction') }}</el-button>
    </template>
  </el-dialog>
  <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="safeLoadImage" @commit="commitImageSelection" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog, RmmvMapEncounter, TilesetSummary } from '../../api/client';
import type { MapPropertiesForm } from './editorTypes';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import { useI18n } from '../../i18n';

type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImageField = 'battleback1Name' | 'battleback2Name' | 'parallaxName';

const props = defineProps<{
  visible: boolean;
  mode: 'create' | 'edit';
  form: MapPropertiesForm;
  tilesets: TilesetSummary[];
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
  parentLabel: string;
  busy: boolean;
}>();
defineEmits<{ close: []; save: [] }>();

const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
const { t } = useI18n();
let pendingImageField: ImageField | null = null;
const troops = computed(() => props.catalog?.troops || []);

function audioOptions(kind: 'bgm' | 'bgs', current: string): { name: string; label: string; missing: boolean }[] {
  const options = (props.catalog?.assets[kind] || []).map((asset) => ({ name: asset.name, label: asset.name, missing: false }));
  if (current && !options.some((option) => option.name === current)) {
    options.unshift({ name: current, label: t('editor.mapProperties.missingAsset', { name: current }), missing: true });
  }
  return options;
}

function troopOptions(currentId: number): { id: number; label: string }[] {
  const options = troops.value.map((troop) => ({ id: troop.id, label: `${troop.id} · ${troop.name}` }));
  if (currentId > 0 && !options.some((option) => option.id === currentId)) {
    options.unshift({ id: currentId, label: t('editor.mapProperties.missingTroop', { id: currentId }) });
  }
  return options;
}

function addEncounter(): void {
  const troop = troops.value[0];
  if (!troop) return;
  props.form.encounterList.push({ troopId: troop.id, weight: 10, regionSet: [] });
}

function removeEncounter(index: number): void {
  props.form.encounterList.splice(index, 1);
}

function addRegion(encounter: RmmvMapEncounter): void {
  if (encounter.regionSet.length >= 3) return;
  const used = new Set(encounter.regionSet);
  let regionId = 1;
  while (used.has(regionId) && regionId < 255) regionId += 1;
  encounter.regionSet.push(regionId);
}

function removeRegion(encounter: RmmvMapEncounter, index: number): void {
  encounter.regionSet.splice(index, 1);
}

function imageLabel(value: string): string {
  return value || t('editor.mapProperties.none');
}

function openImagePicker(field: ImageField, asset: ImageAssetKind, title: string): void {
  pendingImageField = field;
  imagePicker.value?.open({ asset, mode: 'plain', title, name: props.form[field] || '' });
}

function commitImageSelection(selection: { name: string }): void {
  if (!pendingImageField) return;
  props.form[pendingImageField] = selection.name;
  pendingImageField = null;
}

function safeLoadImage(url: string): Promise<HTMLImageElement | null> {
  return props.loadImage(url);
}
</script>

<style scoped>
.property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.audio-grid { display: grid; grid-template-columns: minmax(160px, 1fr) 110px 110px 110px; gap: 12px; }
.check-row { display: flex; flex-wrap: wrap; gap: 16px; margin: 2px 0 14px; }
.section-title { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); margin: 8px 0 10px; }
.half-width { width: calc(50% - 6px); }
.asset-picker-button { box-sizing: border-box; width: 100%; min-height: 32px; overflow: hidden; padding: 0 11px; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; font-size: 13px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.asset-picker-button:hover { border-color: var(--el-color-primary); }
.asset-picker-button:disabled { cursor: not-allowed; color: var(--el-text-color-disabled); background: var(--el-disabled-bg-color); border-color: var(--el-disabled-border-color); }
.missing-option { color: var(--el-color-danger); }
.encounter-heading { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.encounter-heading .section-title { margin: 0; }
.empty-hint { margin: 8px 0 14px; padding: 12px; border: 1px dashed var(--el-border-color); border-radius: var(--el-border-radius-base); color: var(--el-text-color-secondary); font-size: 12px; text-align: center; }
.encounter-row { margin: 8px 0; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: var(--el-border-radius-base); background: var(--el-fill-color-lighter); }
.encounter-fields { display: grid; grid-template-columns: minmax(220px, 1fr) 120px auto; gap: 10px; align-items: end; }
.encounter-fields > .el-button { margin-bottom: 18px; }
.region-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.region-label { color: var(--el-text-color-secondary); font-size: 12px; }
.entire-map { font-size: 12px; }
.region-control { display: flex; gap: 4px; }
.region-control :deep(.el-input-number) { width: 102px; }
.map-note { margin-top: 14px; }
.map-note :deep(textarea) { min-height: 88px; }
:global(.map-properties-dialog) { display: flex; flex-direction: column; max-height: calc(100vh - 32px); margin: 16px auto !important; }
:global(.map-properties-dialog .el-dialog__header),
:global(.map-properties-dialog .el-dialog__footer) { flex: 0 0 auto; }
:global(.map-properties-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; }
@media (max-width: 760px) {
  .property-grid,
  .audio-grid,
  .encounter-fields { grid-template-columns: 1fr; }
  .half-width { width: 100%; }
  .encounter-fields > .el-button { margin-bottom: 0; }
}
</style>
