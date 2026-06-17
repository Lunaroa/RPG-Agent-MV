<script setup lang="ts">
import { MapPin } from '@lucide/vue';

defineProps<{
  title: string;
  subtitle?: string;
  active?: boolean;
  missing?: boolean;
  imageUrl?: string | null;
  spriteStyle?: Record<string, string> | null;
  placeholderLabel?: string;
}>();
</script>

<template>
  <button
    type="button"
    class="image-grid-card"
    :class="{ active, missing }"
  >
    <span class="image-grid-thumb">
      <span
        v-if="spriteStyle"
        class="grid-preview-sprite kind-character"
        :style="spriteStyle"
      />
      <img v-else-if="imageUrl" :src="imageUrl" :alt="title" />
      <span v-else class="image-grid-placeholder">
        <MapPin :size="22" stroke-width="1.75" />
        <small v-if="placeholderLabel">{{ placeholderLabel }}</small>
      </span>
    </span>
    <span class="image-grid-meta">
      <strong>{{ title }}</strong>
      <small v-if="subtitle">{{ subtitle }}</small>
    </span>
  </button>
</template>

<style scoped>
.image-grid-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease),
    box-shadow var(--app-dur) var(--app-ease);
}

.image-grid-card:hover {
  border-color: var(--app-border-strong);
  background: var(--app-bg-sunken);
}

.image-grid-card.active {
  border-color: var(--app-accent);
  box-shadow: inset 0 0 0 1px var(--app-accent);
  background: var(--app-accent-soft);
}

.image-grid-card.missing {
  opacity: 0.82;
}

.image-grid-card:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.image-grid-card.active:focus-visible {
  box-shadow: inset 0 0 0 1px var(--app-accent), var(--app-ring);
}

.image-grid-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background-color: var(--app-bg-soft);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.08) 75%);
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
  background-size: 14px 14px;
}

.image-grid-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.grid-preview-sprite {
  display: block;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}

.grid-preview-sprite.kind-character {
  width: 58px;
  height: 58px;
}

.image-grid-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--app-ink-muted);
}

.image-grid-placeholder small {
  font-size: 9px;
}

.image-grid-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.image-grid-meta strong,
.image-grid-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-grid-meta strong {
  font-size: 11px;
  font-weight: 650;
  color: var(--app-ink);
}

.image-grid-meta small {
  color: var(--app-ink-muted);
  font-size: 10px;
}
</style>
