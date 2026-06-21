<template>
  <div class="model-picker-panel">
    <div class="model-picker-search">
      <input
        v-model="searchQuery"
        type="search"
        class="model-picker-search-input"
        :placeholder="t('modelPicker.search')"
        autocomplete="off"
      />
    </div>

    <div class="model-picker-list">
      <button
        v-if="allowEmpty"
        type="button"
        class="model-picker-row"
        :class="{ 'is-selected': !selectedModelId }"
        @click="onClear"
      >
        <span class="model-picker-row-label">{{ resolvedEmptyLabel }}</span>
        <el-icon v-if="!selectedModelId" class="model-picker-check">
          <Check />
        </el-icon>
      </button>

      <template v-if="filteredGroups.length">
        <div
          v-for="group in filteredGroups"
          :key="group.providerId"
          class="model-picker-group"
        >
          <div
            v-if="showGroupTitles"
            class="model-picker-group-title"
          >
            {{ group.providerLabel }}
          </div>
          <button
            v-for="model in group.models"
            :key="`${group.providerId}--${model.id}`"
            type="button"
            class="model-picker-row"
            :class="{ 'is-selected': isSelected(group.providerId, model.id) }"
            @click="onSelect(group.providerId, model.id)"
          >
            <span class="model-picker-row-label">{{ model.label || model.id }}</span>
            <el-icon
              v-if="isSelected(group.providerId, model.id)"
              class="model-picker-check"
            >
              <Check />
            </el-icon>
          </button>
        </div>
      </template>
      <div v-else-if="!allowEmpty || selectedModelId" class="model-picker-empty">
        <template v-if="!providers.length">
          <span>{{ resolvedEmptyConfiguredHint }}</span>
          <router-link
            v-if="showSettingsLink"
            class="model-picker-settings-link"
            :to="{ path: '/console', query: { page: 'settings' } }"
          >
            {{ t('modelPicker.openSettings') }}
          </router-link>
        </template>
        <template v-else>{{ t('modelPicker.noMatches') }}</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check } from '@element-plus/icons-vue'
import type { ModelPickerProvider } from './types'
import { useI18n } from '../../i18n'

const props = withDefaults(
  defineProps<{
    providers: ModelPickerProvider[]
    selectedProviderId: string
    selectedModelId: string
    allowEmpty?: boolean
    emptyLabel?: string
    emptyConfiguredHint?: string
    showGroupTitles?: boolean
    showSettingsLink?: boolean
  }>(),
  {
    allowEmpty: false,
    emptyLabel: '',
    emptyConfiguredHint: '',
    showGroupTitles: true,
    showSettingsLink: false,
  },
)

const emit = defineEmits<{
  select: [payload: { providerId: string; modelId: string }]
  clear: []
}>()

const searchQuery = ref('')
const { t } = useI18n()
const resolvedEmptyLabel = computed(() => props.emptyLabel || t('modelPicker.emptyDefault'))
const resolvedEmptyConfiguredHint = computed(() => props.emptyConfiguredHint || t('modelPicker.emptyConfigured'))

const filteredGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const groups: Array<{
    providerId: string
    providerLabel: string
    models: ModelPickerProvider['models']
  }> = []

  for (const provider of props.providers) {
    const providerLabel = provider.label || provider.id
    const providerMatches = !q
      || providerLabel.toLowerCase().includes(q)
      || provider.id.toLowerCase().includes(q)

    const models = provider.models.filter((model) => {
      if (!q) return true
      if (providerMatches) return true
      const label = (model.label || model.id).toLowerCase()
      return label.includes(q) || model.id.toLowerCase().includes(q)
    })

    if (models.length > 0) {
      groups.push({
        providerId: provider.id,
        providerLabel,
        models,
      })
    }
  }

  return groups
})

function isSelected(providerId: string, modelId: string) {
  return providerId === props.selectedProviderId && modelId === props.selectedModelId
}

function onSelect(providerId: string, modelId: string) {
  emit('select', { providerId, modelId })
}

function onClear() {
  emit('clear')
}

function resetSearch() {
  searchQuery.value = ''
}

defineExpose({ resetSearch })
</script>
