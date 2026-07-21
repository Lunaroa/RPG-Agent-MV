<script setup lang="ts">
import { computed, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import { useEventPlacementAskStore } from '../../stores/eventPlacementAsk';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { isPlacedStatus } from '../../utils/placementStatus';
import EditorBottomWorkbench from './EditorBottomWorkbench.vue';
import PlacementEventCard from './PlacementEventCard.vue';

const emit = defineEmits<{
  select: [contractId: string];
  place: [contractId: string];
  reject: [contractId: string];
  backChat: [];
}>();
const props = defineProps<{
  mode: 'map' | 'event' | 'preview';
  catalog: EditorProjectCatalog | null;
  currentMapId?: number | null;
}>();
const placementAsk = useEventPlacementAskStore();
const ui = useWorkbenchUiStore();
const { t } = useI18n();
const events = computed(() => placementAsk.placeableEvents);
const hasActiveSession = computed(() => events.value.length > 0);
const placedCount = computed(() => events.value.filter((event) => isPlacedStatus(event.status)).length);
const pendingCount = computed(() => placementAsk.placeablePendingCount);
const selectedEvent = computed(() => {
  const selectedId = placementAsk.selectedContractId;
  if (selectedId) {
    const match = events.value.find((event) => event.contractId === selectedId);
    if (match) return match;
  }
  return events.value.find((event) => !isPlacedStatus(event.status)) || events.value[0] || null;
});

watch(selectedEvent, (event) => {
  if (!event?.contractId || event.contractId === placementAsk.selectedContractId) return;
  placementAsk.selectContract(event.contractId);
}, { immediate: true });
</script>

<template>
  <EditorBottomWorkbench
    v-if="props.mode === 'event'"
    :open="ui.bottomPanelOpen"
    :title="t('editor.bottom.placement')"
    :badge="t('editor.bottom.pendingCount', { count: pendingCount })"
    :badge-empty="pendingCount === 0"
    :collapse-label="t('editor.bottom.collapse')"
    :expand-label="t('editor.bottom.expand')"
    @toggle="ui.toggleBottomPanel()"
  >
    <div class="placement-body">
      <p v-if="!hasActiveSession" class="placement-empty">{{ t('editor.bottom.empty') }}</p>
      <template v-else>
        <div class="placement-grid">
          <PlacementEventCard
            v-for="item in events"
            :key="item.contractId"
            :event="item"
            :current-map-id="props.currentMapId"
            :active="item.contractId === selectedEvent?.contractId"
            :placing="item.contractId === placementAsk.placingContractId"
            @select="emit('select', $event)"
            @place="emit('place', $event)"
            @reject="emit('reject', $event)"
          />
        </div>
        <div class="placement-summary">{{ t('editor.bottom.placedSummary', { placed: placedCount, total: events.length }) }}</div>
      </template>
    </div>
  </EditorBottomWorkbench>
</template>

<style scoped>
.placement-body{min-height:0;flex:1;display:flex;flex-direction:column;padding:6px 8px;background:var(--app-bg-soft)}
.placement-empty{padding:8px 0;color:var(--app-ink-muted);font-size:11px}
.placement-grid{min-height:0;flex:1;display:flex;align-items:flex-start;gap:8px;padding:2px 2px 4px;overflow-x:auto;overflow-y:hidden}
.placement-summary{flex-shrink:0;padding:2px 2px 0;color:var(--app-ink-muted);font-size:9px;line-height:1.2}
</style>
