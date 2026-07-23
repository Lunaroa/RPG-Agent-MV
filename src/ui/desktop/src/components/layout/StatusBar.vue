<script setup lang="ts">
import { useI18n } from '../../i18n';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';

const ui = useWorkbenchUiStore();
const { t } = useI18n();
</script>

<template>
  <footer class="statusbar">
    <span class="sb-item sb-map"><span class="sb-dot" />{{ ui.sbMapLabel || 'RPG Agent MV' }}</span>
    <span v-if="ui.sbMode" class="sb-item sb-mode" :class="ui.sbMode">
      {{ ui.sbMode === 'map' ? t('status.mode.map') : ui.sbMode === 'preview' ? t('status.mode.preview') : t('status.mode.event') }}
    </span>
    <span v-if="ui.sbCursor" class="sb-item">{{ ui.sbCursor }}</span>
    <span class="sb-fill" />
    <span v-if="ui.sbContextText" class="sb-item">{{ ui.sbContextText }}</span>
    <span v-if="!ui.sbHideZoom" class="sb-item">{{ ui.sbZoom }}%</span>
    <span class="sb-item" :class="{ 'sb-warn': ui.sbStagingDirty }">
      {{ ui.sbStagingDirty ? t('status.staging.dirty') : t('status.staging.clean') }}
    </span>
    <span v-if="ui.sbPlacementActive && ui.sbPlacementHint" class="sb-item sb-placement">
      {{ ui.sbPlacementHint }}
    </span>
    <span v-if="ui.sbStatusText" class="sb-item sb-status" :class="ui.sbStatusKind">
      {{ ui.sbStatusText }}
    </span>
  </footer>
</template>

<style scoped>
.statusbar {
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 16px;
  background: var(--app-bg-page);
  color: var(--app-ink-muted);
  font-size: 11px;
  font-family: var(--app-font-mono);
}

.sb-item { white-space: nowrap; }
.sb-fill { flex: 1; }
.sb-map { display: inline-flex; align-items: center; gap: 7px; }
.sb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--app-ok); }
.sb-mode { font-weight: 600; color: var(--app-ink-soft); }
.sb-warn { font-weight: 600; color: var(--app-warn); }
.sb-placement { max-width: 42vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-status.sb-busy { color: var(--app-warn); }
.sb-status.sb-saved { color: var(--app-ok); }
.sb-status.sb-error { color: var(--app-danger); }
</style>
