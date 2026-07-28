<script setup lang="ts">
import { watch } from 'vue'

import { useEffectThumbnail } from '../composables/useEffectThumbnail'

/**
 * Grid/panel cell that shows an effect's representative-frame thumbnail.
 * Mirrors AssetGridVideoThumb: renders an <img> once ready and emits `error`
 * on failure so the host can fall back to the type icon.
 */
const props = defineProps<{
  effectName: string;
  project?: string;
  sizeBucket?: number;
  alt?: string;
}>()
const emit = defineEmits<{ error: [] }>()

const { url, failed } = useEffectThumbnail(
  () => props.effectName,
  {
    sizeBucket: props.sizeBucket,
    project: () => props.project,
  },
)

watch(failed, (isFailed) => {
  if (isFailed) emit('error')
})
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="props.alt || ''"
    draggable="false"
  />
</template>
