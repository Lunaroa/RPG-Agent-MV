<template>
  <input
    :value="modelValue"
    type="search"
    class="console-search-input"
    :placeholder="resolvedPlaceholder"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
  }>(),
  {
    placeholder: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder || t('ui.searchPlaceholder'))

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>
