<script setup lang="ts">

import { computed, watch } from 'vue';

import type { EditorProjectCatalog } from '../../api/client';

import PlacementEventCard from './PlacementEventCard.vue';

import { useEventPlacementAskStore } from '../../stores/eventPlacementAsk';

import { useWorkbenchUiStore } from '../../stores/workbenchUi';

import { isPlacedStatus } from '../../utils/placementStatus';
import { useI18n } from '../../i18n';



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

const placedCount = computed(() => events.value.filter((e) => isPlacedStatus(e.status)).length);

const pendingCount = computed(() => placementAsk.placeablePendingCount);



const selectedEvent = computed(() => {

  const selectedId = placementAsk.selectedContractId;

  if (selectedId) {

    const match = events.value.find((event) => event.contractId === selectedId);

    if (match) return match;

  }

  return events.value.find((event) => !isPlacedStatus(event.status)) || events.value[0] || null;

});



function onSelect(contractId: string) {

  emit('select', contractId);

}



watch(

  selectedEvent,

  (event) => {

    if (!event?.contractId || event.contractId === placementAsk.selectedContractId) return;

    placementAsk.selectContract(event.contractId);

  },

  { immediate: true },

);

</script>



<template>

  <div

    v-if="props.mode === 'event'"

    class="bottom-panel"

    :class="{ collapsed: !ui.bottomPanelOpen }"

  >

    <div class="bp-tabs">

      <button

        type="button"

        class="bp-tab active"

        @click="ui.toggleBottomPanel()"

      >

        {{ t('editor.bottom.placement') }}

        <span class="tab-badge" :class="{ empty: pendingCount === 0 }">{{ t('editor.bottom.pendingCount', { count: pendingCount }) }}</span>

      </button>



      <div class="bp-spacer" />



      <button

        type="button"

        class="bp-collapse-btn"

        :title="ui.bottomPanelOpen ? t('editor.bottom.collapse') : t('editor.bottom.expand')"

        @click="ui.toggleBottomPanel()"

      >

        {{ ui.bottomPanelOpen ? '▾' : '▴' }}

      </button>

    </div>



    <div v-if="ui.bottomPanelOpen" class="bp-body">

      <p v-if="!hasActiveSession" class="bp-empty">{{ t('editor.bottom.empty') }}</p>

      <template v-else>

        <div class="bp-grid">

          <PlacementEventCard

            v-for="item in events"

            :key="item.contractId"

            :event="item"

            :current-map-id="props.currentMapId"

            :active="item.contractId === selectedEvent?.contractId"

            :placing="item.contractId === placementAsk.placingContractId"

            @select="onSelect"

            @place="emit('place', $event)"

            @reject="emit('reject', $event)"

          />

        </div>

        <div class="bp-summary">

          {{ t('editor.bottom.placedSummary', { placed: placedCount, total: events.length }) }}

        </div>

      </template>

    </div>

  </div>

</template>



<style scoped>

.bottom-panel {

  flex-shrink: 0;

  background: var(--app-bg);

  display: flex;

  flex-direction: column;

  height: 200px;

  min-height: 36px;

  transition: height 250ms var(--app-ease);

}



.bottom-panel.collapsed {

  height: 36px;

}



.bp-tabs {

  height: 36px;

  flex-shrink: 0;

  display: flex;

  align-items: center;

  padding: 0 8px;

  gap: 0;

  background: var(--app-bg);

}



.bp-tab {

  padding: 0 10px;

  height: 100%;

  display: flex;

  align-items: center;

  gap: 5px;

  font-size: 11px;

  color: var(--app-ink-muted);

  cursor: pointer;

  border: none;

  background: none;

  font-family: inherit;

  border-bottom: 0;

  transition: color var(--app-dur) var(--app-ease), border-color var(--app-dur) var(--app-ease);

}



.bp-tab:hover {

  color: var(--app-ink-soft);

}



.bp-tab.active {

  color: var(--app-ink);

  font-weight: 600;

}



.tab-badge {

  min-width: 14px;

  height: 18px;

  border-radius: var(--app-radius-pill);

  background: var(--app-accent-soft);

  color: var(--app-accent);

  font-size: 10px;

  font-weight: 700;

  display: grid;

  place-items: center;

  padding: 0 3px;

}



.tab-badge.empty {

  background: var(--app-bg-soft);

  color: var(--app-ink-muted);

}



.bp-spacer {

  flex: 1;

}



.bp-collapse-btn {

  width: 22px;

  height: 22px;

  display: grid;

  place-items: center;

  border: none;

  border-radius: var(--app-radius-sm);

  background: transparent;

  color: var(--app-ink-muted);

  cursor: pointer;

  font-size: 10px;

}



.bp-collapse-btn:hover {

  background: var(--app-bg-sunken);

  color: var(--app-ink);

}



.bp-body {

  flex: 1;

  min-height: 0;

  display: flex;

  flex-direction: column;

  padding: 6px 8px 6px;

  background: var(--app-bg-soft);

}



.bp-empty {

  color: var(--app-ink-muted);

  font-size: 11px;

  padding: 8px 0;

}



.bp-grid {

  flex: 1;

  min-height: 0;

  display: flex;

  flex-direction: row;

  align-items: flex-start;

  gap: 8px;

  overflow-x: auto;

  overflow-y: hidden;

  padding: 2px 2px 4px;

}



.bp-summary {

  flex-shrink: 0;

  padding: 2px 2px 0;

  font-size: 9px;

  line-height: 1.2;

  color: var(--app-ink-muted);

}

</style>

