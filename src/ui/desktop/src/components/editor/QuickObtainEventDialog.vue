<template>
  <teleport to="body">
    <div v-if="visible" class="obtain-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="obtain-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="obtain-event-title">
        <header class="editor-modal-header">
          <strong id="obtain-event-title" class="editor-modal-title">{{ t('quickObtain.title') }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="obtain-body">
          <label>
            <span>{{ t('quickObtain.kind') }}</span>
            <select v-model="kind" @change="selectFirstEntry">
              <option value="item">{{ t('quickObtain.item') }}</option>
              <option value="weapon">{{ t('quickObtain.weapon') }}</option>
              <option value="armor">{{ t('quickObtain.armor') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('quickObtain.entry') }}</span>
            <select v-model.number="databaseId">
              <option v-for="entry in entries" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4, '0') }} · {{ entry.name }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('quickObtain.quantity') }}</span>
            <input v-model.number="quantity" type="number" min="1" max="9999" />
          </label>
          <p>{{ t('quickObtain.note') }}</p>
        </div>
        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" :disabled="!canCommit" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { EditorProjectCatalog, NamedCatalogEntry } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import type { QuickObtainKind } from '../../composables/useEventEditor';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';

interface QuickObtainSelection {
  kind: QuickObtainKind;
  databaseId: number;
  quantity: number;
  x: number;
  y: number;
  name: string;
}

const props = defineProps<{ catalog: EditorProjectCatalog | null }>();
const emit = defineEmits<{ commit: [selection: QuickObtainSelection] }>();
const { t } = useI18n();
const visible = ref(false);
const kind = ref<QuickObtainKind>('item');
const databaseId = ref(0);
const quantity = ref(1);
const x = ref(0);
const y = ref(0);
const entries = computed<NamedCatalogEntry[]>(() => {
  if (kind.value === 'item') return props.catalog?.items || [];
  if (kind.value === 'weapon') return props.catalog?.weapons || [];
  return props.catalog?.armors || [];
});
const selectedEntry = computed(() => entries.value.find((entry) => Number(entry.id) === databaseId.value) || null);
const canCommit = computed(() => Boolean(selectedEntry.value) && Number.isInteger(quantity.value) && quantity.value > 0 && quantity.value <= 9999);

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(position: { x: number; y: number }) {
  x.value = Math.max(0, Math.trunc(Number(position.x) || 0));
  y.value = Math.max(0, Math.trunc(Number(position.y) || 0));
  kind.value = 'item';
  quantity.value = 1;
  selectFirstEntry();
  visible.value = true;
}
function close() { visible.value = false; }
function selectFirstEntry() { databaseId.value = Number(entries.value[0]?.id) || 0; }
function commit() {
  if (!canCommit.value || !selectedEntry.value) return;
  emit('commit', {
    kind: kind.value,
    databaseId: databaseId.value,
    quantity: quantity.value,
    x: x.value,
    y: y.value,
    name: selectedEntry.value.name,
  });
  close();
}

defineExpose({ open });
</script>

<style scoped>
.obtain-overlay { z-index:2500; }
.obtain-dialog { width:min(440px,calc(100vw - 32px)); }
.obtain-body { display:grid; grid-template-columns:1fr 2fr; gap:10px; padding:14px; }
.obtain-body label { min-width:0; display:grid; gap:4px; color:var(--app-ink-muted); font-size:12px; }
.obtain-body label:nth-child(2) { grid-column:2; grid-row:1 / span 2; }
.obtain-body input,.obtain-body select { min-width:0; padding:6px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-bg); color:var(--app-ink); }
.obtain-body p { grid-column:1 / -1; margin:0; padding-top:4px; color:var(--app-ink-muted); font-size:11px; line-height:1.45; }
</style>
