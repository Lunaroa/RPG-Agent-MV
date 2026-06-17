<script setup lang="ts">
import { computed } from 'vue';
import type { PlacementListEvent } from '../../stores/eventPlacementAsk';
import { isPlacedStatus } from '../../utils/placementStatus';
import {
  formatSuggestedMapHint,
  isSuggestedMapMismatch,
} from '../../utils/placementMapPolicy';

const props = defineProps<{
  event: PlacementListEvent;
  active?: boolean;
  placing?: boolean;
  currentMapId?: number | null;
}>();

const emit = defineEmits<{
  select: [contractId: string];
  place: [contractId: string];
  reject: [contractId: string];
}>();

const placed = computed(() => isPlacedStatus(props.event.status));

const summary = computed(() => (
  props.event.summary?.trim()
  || props.event.placementHint?.trim()
  || ''
));

const placedLabel = computed(() => {
  if (props.event.x != null && props.event.y != null) {
    return `已放置 (${props.event.x}, ${props.event.y})`;
  }
  return '已放置';
});

const mapHint = computed(() => {
  if (placed.value || !isSuggestedMapMismatch(props.event.targetMapId, props.currentMapId)) {
    return '';
  }
  return formatSuggestedMapHint(Number(props.event.targetMapId));
});
</script>

<template>
  <article
    class="placement-card"
    :class="{ active, placed, placing }"
  >
    <button
      type="button"
      class="placement-card-select"
      @click="emit('select', event.contractId)"
    >
      <strong :title="event.eventName || event.contractId">
        {{ event.eventName || event.contractId }}
      </strong>
      <small v-if="mapHint" class="placement-card-map-hint" :title="mapHint">{{ mapHint }}</small>
      <small v-if="summary" :title="summary">{{ summary }}</small>
    </button>

    <div v-if="placed" class="placement-card-status">{{ placedLabel }}</div>
    <div v-else class="placement-card-actions">
      <button
        type="button"
        class="placement-card-place"
        :disabled="placing"
        @click.stop="emit('place', event.contractId)"
      >
        {{ placing ? '…' : '放置' }}
      </button>
      <button
        type="button"
        class="placement-card-reject"
        title="拒绝"
        @click.stop="emit('reject', event.contractId)"
      >
        ×
      </button>
    </div>
  </article>
</template>

<style scoped>
.placement-card {
  flex: 0 0 148px;
  width: 148px;
  min-width: 148px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
  transition:
    border-color var(--app-dur) var(--app-ease),
    background var(--app-dur) var(--app-ease),
    box-shadow var(--app-dur) var(--app-ease);
}

.placement-card:hover {
  border-color: var(--app-border-strong);
  background: var(--app-bg-sunken);
}

.placement-card.active {
  border-color: var(--app-accent);
  box-shadow: inset 0 0 0 1px var(--app-accent);
  background: var(--app-accent-soft);
}

.placement-card.placed {
  opacity: 0.78;
}

.placement-card-select {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.placement-card-select:focus-visible {
  outline: none;
  border-radius: var(--app-radius-sm);
  box-shadow: var(--app-ring);
}

.placement-card-select strong,
.placement-card-select small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placement-card-select strong {
  font-size: 11px;
  font-weight: 650;
  color: var(--app-ink);
  line-height: 1.3;
}

.placement-card-select small {
  font-size: 10px;
  line-height: 1.35;
  color: var(--app-ink-muted);
}

.placement-card-map-hint {
  color: var(--app-ink-faint, var(--app-ink-muted));
  font-style: italic;
}

.placement-card-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.placement-card-place {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--app-accent);
  border-radius: var(--app-radius-sm);
  background: var(--app-accent);
  color: var(--app-accent-ink);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}

.placement-card-place:disabled {
  cursor: wait;
  opacity: 0.7;
}

.placement-card-reject {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.placement-card-reject:hover {
  background: var(--app-danger-soft);
  color: var(--app-danger);
}

.placement-card-status {
  height: 22px;
  display: grid;
  place-items: center;
  color: var(--app-ink-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
