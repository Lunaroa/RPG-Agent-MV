<template>
  <el-dialog :model-value="visible" :title="mode === 'create' ? '新建地图' : '地图属性'" width="760px" :close-on-click-modal="false" @close="$emit('close')">
    <el-form label-position="top" size="small">
      <div class="property-grid">
        <el-form-item label="名称"><el-input v-model="form.name" autofocus /></el-form-item>
        <el-form-item label="显示名称"><el-input v-model="form.displayName" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item label="宽度"><el-input-number v-model="form.width" :min="1" :max="256" controls-position="right" /></el-form-item>
        <el-form-item label="高度"><el-input-number v-model="form.height" :min="1" :max="256" controls-position="right" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item label="Tileset">
          <el-select v-model="form.tilesetId" style="width: 100%">
            <el-option v-for="tileset in tilesets" :key="tileset.id" :label="`${tileset.id} · ${tileset.name}`" :value="tileset.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="卷动类型">
          <el-select v-model="form.scrollType" style="width: 100%">
            <el-option label="无循环" :value="0" />
            <el-option label="纵向循环" :value="1" />
            <el-option label="横向循环" :value="2" />
            <el-option label="横向和纵向循环" :value="3" />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item v-if="mode === 'create'" label="父地图">
        <el-input :model-value="parentLabel" disabled />
      </el-form-item>

      <div class="check-row">
        <el-checkbox v-model="form.disableDashing">禁止奔跑</el-checkbox>
        <el-checkbox v-model="form.specifyBattleback">指定战斗背景</el-checkbox>
      </div>
      <div class="property-grid">
        <el-form-item label="战斗背景 1">
          <button type="button" class="asset-picker-button" @click="openImagePicker('battleback1Name', 'battlebacks1', '选择战斗背景 1')">{{ imageLabel(form.battleback1Name) }}</button>
        </el-form-item>
        <el-form-item label="战斗背景 2">
          <button type="button" class="asset-picker-button" @click="openImagePicker('battleback2Name', 'battlebacks2', '选择战斗背景 2')">{{ imageLabel(form.battleback2Name) }}</button>
        </el-form-item>
      </div>

      <div class="section-title">BGM / BGS</div>
      <div class="check-row">
        <el-checkbox v-model="form.autoplayBgm">自动播放 BGM</el-checkbox>
        <el-checkbox v-model="form.autoplayBgs">自动播放 BGS</el-checkbox>
      </div>
      <div class="audio-grid">
        <el-form-item label="BGM"><el-input v-model="form.bgm.name" /></el-form-item>
        <el-form-item label="音量"><el-input-number v-model="form.bgm.volume" :min="0" :max="100" controls-position="right" /></el-form-item>
        <el-form-item label="音调"><el-input-number v-model="form.bgm.pitch" :min="50" :max="150" controls-position="right" /></el-form-item>
        <el-form-item label="声像"><el-input-number v-model="form.bgm.pan" :min="-100" :max="100" controls-position="right" /></el-form-item>
        <el-form-item label="BGS"><el-input v-model="form.bgs.name" /></el-form-item>
        <el-form-item label="音量"><el-input-number v-model="form.bgs.volume" :min="0" :max="100" controls-position="right" /></el-form-item>
        <el-form-item label="音调"><el-input-number v-model="form.bgs.pitch" :min="50" :max="150" controls-position="right" /></el-form-item>
        <el-form-item label="声像"><el-input-number v-model="form.bgs.pan" :min="-100" :max="100" controls-position="right" /></el-form-item>
      </div>

      <div class="section-title">远景</div>
      <div class="property-grid">
        <el-form-item label="远景图">
          <button type="button" class="asset-picker-button" @click="openImagePicker('parallaxName', 'parallaxes', '选择远景图')">{{ imageLabel(form.parallaxName) }}</button>
        </el-form-item>
        <el-form-item label="显示在编辑器中"><el-checkbox v-model="form.parallaxShow" /></el-form-item>
      </div>
      <div class="property-grid">
        <el-form-item label="横向滚动"><el-input-number v-model="form.parallaxSx" :min="-32" :max="32" controls-position="right" /></el-form-item>
        <el-form-item label="纵向滚动"><el-input-number v-model="form.parallaxSy" :min="-32" :max="32" controls-position="right" /></el-form-item>
      </div>
      <div class="check-row">
        <el-checkbox v-model="form.parallaxLoopX">横向循环</el-checkbox>
        <el-checkbox v-model="form.parallaxLoopY">纵向循环</el-checkbox>
      </div>

      <div class="property-grid">
        <el-form-item label="遭遇步数"><el-input-number v-model="form.encounterStep" :min="1" :max="999" controls-position="right" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" /></el-form-item>
      </div>
      <el-form-item label="遭遇列表 JSON">
        <el-input v-model="form.encounterListText" type="textarea" :rows="4" spellcheck="false" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button size="small" @click="$emit('close')">取消</el-button>
      <el-button size="small" type="primary" :loading="busy" @click="$emit('save')">{{ mode === 'create' ? '创建地图' : '保存属性' }}</el-button>
    </template>
  </el-dialog>
  <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="safeLoadImage" @commit="commitImageSelection" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { EditorProjectCatalog, TilesetSummary } from '../../api/client';
import type { MapPropertiesForm } from './editorTypes';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';

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
let pendingImageField: ImageField | null = null;

function imageLabel(value: string): string {
  return value || '(无)';
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
.asset-picker-button { box-sizing: border-box; width: 100%; min-height: 32px; overflow: hidden; padding: 0 11px; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; font-size: 13px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.asset-picker-button:hover { border-color: var(--el-color-primary); }
@media (max-width: 760px) {
  .property-grid,
  .audio-grid { grid-template-columns: 1fr; }
}
</style>
