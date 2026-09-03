<template>
  <el-dialog
    :model-value="visible"
    :title="t('mapImageExport.title')"
    class="map-image-export-dialog"
    width="min(960px, 92vw)"
    top="4vh"
    append-to-body
    destroy-on-close
    @close="close"
  >
    <div class="map-image-export">
      <div class="map-image-preview" :class="{ loading }">
        <el-skeleton v-if="loading && !previewUrl" animated class="map-image-preview-skeleton" />
        <img v-else-if="previewUrl" :src="previewUrl" :alt="t('mapImageExport.previewAlt')" />
        <el-empty v-else :description="errorMessage || t('mapImageExport.previewEmpty')" />
      </div>

      <div class="map-image-fields">
        <label class="map-image-field">
          <span>{{ t('mapImageExport.scale') }}</span>
          <el-input-number v-model="scalePercent" :min="1" :max="100" :step="1" step-strictly controls-position="right" />
          <span>%</span>
        </label>
        <el-checkbox v-model="includeDefaultEventCharacters">
          {{ t('mapImageExport.includeEvents') }}
        </el-checkbox>
        <div>
          <el-checkbox v-model="includeUnlimitedLayers" :disabled="!scene?.unlimitedLayersEnabled">
            {{ t('mapImageExport.includeUnlimitedLayers') }}
          </el-checkbox>
          <div v-if="scene && !scene.unlimitedLayersEnabled" class="map-image-hint">
            {{ t('mapImageExport.unlimitedLayersDisabled') }}
          </div>
        </div>
        <label class="map-image-field map-image-directory">
          <span>{{ t('mapImageExport.directory') }}</span>
          <el-input v-model="directory" readonly :placeholder="t('mapImageExport.directoryPlaceholder')" />
          <el-button @click="selectDirectory">{{ t('mapImageExport.chooseDirectory') }}</el-button>
        </label>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon />
      <div v-else-if="preview" class="map-image-size">
        {{ preview.width }} × {{ preview.height }} px
      </div>
    </div>

    <template #footer>
      <el-button :disabled="!preview || loading" :loading="copying" type="primary" @click="copyImage">
        {{ t('mapImageExport.copy') }}
      </el-button>
      <el-button :disabled="!preview || !directory || loading" :loading="exporting" @click="exportPng">
        {{ t('mapImageExport.exportPng') }}
      </el-button>
      <el-button @click="close">{{ t('common.cancel') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { maps, type MapImageExportPreviewResult, type MapImageExportScene } from '../../api/client';
import { useI18n } from '../../i18n';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';

const props = defineProps<{
  visible: boolean;
  scene: MapImageExportScene | null;
}>();

const emit = defineEmits<{ (event: 'update:visible', value: boolean): void }>();
const { language, t } = useI18n();
const scalePercent = ref(100);
const includeDefaultEventCharacters = ref(false);
const includeUnlimitedLayers = ref(false);
const directory = ref('');
const loading = ref(false);
const copying = ref(false);
const exporting = ref(false);
const errorMessage = ref('');
const preview = ref<MapImageExportPreviewResult | null>(null);
const previewUrl = ref('');
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;
let activeRequestId = '';

watch(() => props.visible, (visible) => {
  if (!visible || !props.scene) return;
  scalePercent.value = 100;
  includeDefaultEventCharacters.value = false;
  includeUnlimitedLayers.value = props.scene.unlimitedLayersEnabled;
  directory.value = '';
  preview.value = null;
  previewUrl.value = '';
  errorMessage.value = '';
  void openSession();
});

async function openSession(): Promise<void> {
  const scene = props.scene;
  if (!scene) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    await maps.openImageExportSession(scene);
  } catch (error) {
    if (!props.visible) return;
    loading.value = false;
    errorMessage.value = formatUserFacingErrorMessage(error, 'general', language.value);
    return;
  }
  if (!props.visible) return;
  schedulePreview(0);
}

watch([scalePercent, includeDefaultEventCharacters, includeUnlimitedLayers], () => {
  if (props.visible) schedulePreview(140);
});

function schedulePreview(delay: number): void {
  const scheduledSequence = ++sequence;
  if (timer) clearTimeout(timer);
  if (activeRequestId) void maps.cancelImageExportPreview(activeRequestId).catch(() => undefined);
  loading.value = true;
  timer = setTimeout(() => {
    timer = null;
    void generatePreview(scheduledSequence);
  }, delay);
}

async function generatePreview(currentSequence: number): Promise<void> {
  const base = props.scene;
  if (!base) return;
  if (activeRequestId) void maps.cancelImageExportPreview(activeRequestId).catch(() => undefined);
  const requestId = `map-image-${Date.now()}-${currentSequence}`;
  activeRequestId = requestId;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await maps.imageExportPreview({
      ...base,
      requestId,
      options: {
        scalePercent: scalePercent.value,
        includeDefaultEventCharacters: includeDefaultEventCharacters.value,
        includeUnlimitedLayers: includeUnlimitedLayers.value,
      },
    });
    if (sequence !== currentSequence || !props.visible) return;
    preview.value = result;
    previewUrl.value = `data:image/png;base64,${result.pngBase64}`;
  } catch (error) {
    if (sequence !== currentSequence || /MAP_IMAGE_PREVIEW_CANCELLED/.test((error as Error).message)) return;
    preview.value = null;
    previewUrl.value = '';
    errorMessage.value = formatUserFacingErrorMessage(error, 'general', language.value);
  } finally {
    if (sequence === currentSequence) loading.value = false;
    if (activeRequestId === requestId) activeRequestId = '';
  }
}

async function selectDirectory(): Promise<void> {
  try {
    const selected = await maps.selectImageExportDirectory();
    if (selected) directory.value = selected;
  } catch (error) {
    ElMessage.error(formatUserFacingErrorMessage(error, 'general', language.value));
  }
}

async function copyImage(): Promise<void> {
  if (!preview.value) return;
  copying.value = true;
  try {
    await maps.copyImageExport(preview.value);
    ElMessage.success(t('mapImageExport.copied'));
  } catch (error) {
    ElMessage.error(t('mapImageExport.copyFailed', { message: formatUserFacingErrorMessage(error, 'general', language.value) }));
  } finally {
    copying.value = false;
  }
}

async function exportPng(): Promise<void> {
  if (!preview.value || !directory.value || !props.scene) return;
  exporting.value = true;
  try {
    const result = await maps.writeImageExport(preview.value, directory.value, props.scene.mapId, props.scene.mapName);
    if (result) ElMessage.success(t('mapImageExport.exported'));
  } catch (error) {
    ElMessage.error(t('mapImageExport.exportFailed', { message: formatUserFacingErrorMessage(error, 'general', language.value) }));
  } finally {
    exporting.value = false;
  }
}

function cleanup(): void {
  sequence += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  const requestId = activeRequestId || preview.value?.requestId || '';
  if (requestId) void maps.cancelImageExportPreview(requestId).catch(() => undefined);
  activeRequestId = '';
  loading.value = false;
}

function close(): void {
  cleanup();
  if (props.scene) void maps.closeImageExportSession(props.scene.project).catch(() => undefined);
  emit('update:visible', false);
}

onBeforeUnmount(() => {
  cleanup();
  if (props.scene) void maps.closeImageExportSession(props.scene.project).catch(() => undefined);
});
</script>

<style scoped>
.map-image-export { display: grid; gap: 16px; }
.map-image-preview { display: grid; place-items: center; min-height: min(360px, 38vh); max-height: 48vh; overflow: auto; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background-color: #f5f3ee; background-image: linear-gradient(45deg, #dedbd4 25%, transparent 25%), linear-gradient(-45deg, #dedbd4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #dedbd4 75%), linear-gradient(-45deg, transparent 75%, #dedbd4 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.map-image-preview img { display: block; max-width: 100%; max-height: 48vh; image-rendering: pixelated; }
.map-image-preview.loading img { opacity: .55; }
.map-image-preview-skeleton { width: 72%; }
.map-image-fields { display: grid; gap: 12px; }
.map-image-field { display: flex; align-items: center; gap: 10px; }
.map-image-field > span:first-child { width: 112px; flex: 0 0 auto; color: var(--app-ink-muted); }
.map-image-directory .el-input { flex: 1; }
.map-image-hint { margin: 2px 0 0 24px; color: var(--app-ink-muted); font-size: 12px; }
.map-image-size { color: var(--app-ink-muted); font-size: 12px; text-align: right; }
:global(.map-image-export-dialog) { display: flex; flex-direction: column; max-height: 92vh; margin-bottom: 0; }
:global(.map-image-export-dialog .el-dialog__body) { min-height: 0; overflow: auto; }
</style>
