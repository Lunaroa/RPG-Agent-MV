<script setup lang="ts">
import { computed, ref } from 'vue'
import SystemNamedEntrySelectorDialog from '../../../components/editor/SystemNamedEntrySelectorDialog.vue'
import { formatSystemNamedEntryId } from '../../../utils/systemNamedEntryRanges'
import { useSystemNamedEntries, type UiSystemNamedKind } from '../composables/useSystemNamedEntries'
import { useUiDesignerI18n } from '../i18n'

const props = withDefaults(defineProps<{
  kind: UiSystemNamedKind
  modelValue: number
  allowNone?: boolean
  uiId?: string
}>(), { allowNone: false })
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const { t } = useUiDesignerI18n()
const { catalog, ready, entryName, reload } = useSystemNamedEntries()
const selector = ref<InstanceType<typeof SystemNamedEntrySelectorDialog>>()
const pickLabel = computed(() => t(props.kind === 'switch' ? 'chooseSwitch' : 'chooseVariable'))
const normalizedId = computed(() => {
  const id = Number(props.modelValue)
  if (!Number.isFinite(id)) return props.allowNone ? 0 : 1
  const floor = Math.floor(id)
  return props.allowNone ? Math.max(0, floor) : Math.max(1, floor)
})
const display = computed(() => {
  const id = normalizedId.value
  if (id <= 0) return `${formatSystemNamedEntryId(0)} ${t('optionNone')}`
  const name = entryName(props.kind, id)
  return name ? `${formatSystemNamedEntryId(id)} ${name}` : formatSystemNamedEntryId(id)
})
const openPicker = () => { if (ready.value) void selector.value?.open({ kind: props.kind, selectedId: normalizedId.value, allowNone: props.allowNone }) }
const commit = (value: unknown) => {
  const fallback = props.allowNone ? 0 : 1
  const parsed = Math.floor(Number(value))
  emit('update:modelValue', Number.isFinite(parsed) ? Math.max(fallback, parsed) : fallback)
}
const commitNamedSelection = (payload: { kind: UiSystemNamedKind; id: number }) => commit(payload.id)
</script>

<template>
  <div v-if="ready" class="named-entry-field">
    <el-input class="named-entry-value" :model-value="display" readonly size="small" :title="display" @click="openPicker">
      <template #append>
        <el-button size="small" :data-ui-id="props.uiId" :data-testid="props.uiId" :aria-label="pickLabel" :title="pickLabel" @click.stop="openPicker">…</el-button>
      </template>
    </el-input>
    <SystemNamedEntrySelectorDialog ref="selector" :catalog="catalog" @commit="commitNamedSelection" @catalog-changed="reload" />
  </div>
  <el-input-number v-else :model-value="normalizedId" :min="props.allowNone ? 0 : 1" size="small" @update:model-value="commit" />
</template>

<style scoped>
.named-entry-field { display: inline-flex; width: 150px; max-width: 100%; min-width: 0; vertical-align: middle; }
.named-entry-field .named-entry-value { flex: 1; min-width: 0; }
.named-entry-value :deep(.el-input__inner) { cursor: pointer; }
</style>
