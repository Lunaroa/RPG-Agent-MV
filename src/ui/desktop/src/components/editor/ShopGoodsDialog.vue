<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog shop-goods-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="shop-goods-title">
        <header class="editor-modal-header">
          <strong id="shop-goods-title" class="editor-modal-title">{{ t('eventcmd.goodsTitle') }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="goods-body">
          <fieldset class="goods-group">
            <legend>{{ t('eventcmd.shopMerchandise') }}</legend>
            <div class="goods-type-row">
              <label><input v-model.number="goodsType" type="radio" :value="0" />{{ t('eventcmd.goodsItem') }}</label>
              <label><input v-model.number="goodsType" type="radio" :value="1" />{{ t('eventcmd.goodsWeapon') }}</label>
              <label><input v-model.number="goodsType" type="radio" :value="2" />{{ t('eventcmd.goodsArmor') }}</label>
            </div>
            <select v-model.number="goodsId">
              <option v-for="entry in goodsOptions" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4, '0') }} {{ entry.name }}</option>
            </select>
          </fieldset>
          <fieldset class="goods-group">
            <legend>{{ t('eventcmd.shopPrice') }}</legend>
            <label class="goods-price-row"><input v-model.number="priceType" type="radio" :value="0" />{{ t('eventcmd.shopPriceStandard') }}</label>
            <label class="goods-price-row">
              <input v-model.number="priceType" type="radio" :value="1" />{{ t('eventcmd.shopPriceSpecify') }}
              <input v-model.number="price" type="number" min="0" :disabled="priceType !== 1" class="goods-price-input" />
            </label>
          </fieldset>
        </div>
        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" :disabled="!goodsOptions.length" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';

export interface ShopGoodsEntry {
  goodsType: number;
  id: number;
  priceType: number;
  price: number;
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  commit: [entry: ShopGoodsEntry];
}>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const goodsType = ref(0);
const goodsId = ref(1);
const priceType = ref(0);
const price = ref(0);

const goodsOptions = computed(() => {
  const catalog = props.catalog;
  if (!catalog) return [];
  return goodsType.value === 1 ? catalog.weapons : goodsType.value === 2 ? catalog.armors : catalog.items;
});

// Switching the merchandise type invalidates the previous id; snap to the first entry.
watch(goodsType, () => {
  if (!goodsOptions.value.some((entry) => entry.id === goodsId.value)) {
    goodsId.value = goodsOptions.value[0]?.id ?? 0;
  }
});

function open(entry: ShopGoodsEntry): void {
  goodsType.value = [0, 1, 2].includes(entry.goodsType) ? entry.goodsType : 0;
  goodsId.value = entry.id;
  if (!goodsOptions.value.some((item) => item.id === goodsId.value)) {
    goodsId.value = goodsOptions.value[0]?.id ?? 0;
  }
  priceType.value = entry.priceType === 1 ? 1 : 0;
  price.value = Math.max(0, Number(entry.price) || 0);
  visible.value = true;
}

function close(): void {
  visible.value = false;
}

function commit(): void {
  emit('commit', {
    goodsType: goodsType.value,
    id: goodsId.value,
    priceType: priceType.value,
    price: priceType.value === 1 ? Math.max(0, Number(price.value) || 0) : 0,
  });
  close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.shop-goods-dialog { width: min(320px, calc(100vw - 32px)); }
.goods-body { display: grid; gap: 10px; padding: 12px; }
.goods-group {
  margin: 0;
  padding: 8px 10px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  display: grid;
  gap: 8px;
}
.goods-group legend { padding: 0 4px; color: var(--app-ink-soft); font-size: 12px; }
.goods-type-row { display: flex; gap: 12px; }
.goods-type-row label,
.goods-price-row { display: flex; align-items: center; gap: 5px; color: var(--app-ink); font-size: 12px; }
.goods-price-input { width: 90px; margin-left: 6px; }
.goods-group select,
.goods-group input[type="number"] {
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: 13px;
}
.goods-group input[type="number"]:disabled { opacity: 0.5; }
</style>
