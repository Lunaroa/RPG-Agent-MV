<script setup lang="ts">
import type { AssetPreviewItem } from '../utils/assetPreview';

defineProps<{
  displayName: string;
  info: NonNullable<AssetPreviewItem['info']>;
}>();
</script>

<template>
  <div class="effect-info" role="region" :aria-label="displayName">
    <p class="effect-info-notice">{{ info.notice }}</p>
    <dl class="effect-info-rows">
      <div v-for="row in info.rows" :key="`${row.label}:${row.value}`" class="effect-info-row">
        <dt>{{ row.label }}</dt>
        <dd :title="row.value">{{ row.value }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.effect-info {
  width: min(100%, 520px);
  margin: 24px;
  padding: 18px 20px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
  display: grid;
  gap: 14px;
}
.effect-info-notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--app-accent, #c45c26) 12%, #fff);
  color: #2a3138;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.effect-info-rows {
  margin: 0;
  display: grid;
  gap: 10px;
}
.effect-info-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 10px;
  align-items: start;
}
.effect-info-row dt {
  margin: 0;
  color: #8a939e;
  font-size: 11px;
  font-weight: 650;
}
.effect-info-row dd {
  margin: 0;
  color: #2a3138;
  font: 600 12px / 1.35 var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
