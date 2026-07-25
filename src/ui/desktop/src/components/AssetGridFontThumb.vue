<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ASSET_FONT_PREVIEW_SAMPLE_DEFAULT } from '../utils/assetPreview'

const props = withDefaults(defineProps<{
  src: string
  size: number
  sampleText?: string
}>(), {
  sampleText: ASSET_FONT_PREVIEW_SAMPLE_DEFAULT,
})

const emit = defineEmits<{
  error: []
}>()

const familyName = ref('')
const ready = ref(false)
let loadedFace: FontFace | null = null
let bindToken = 0

const sampleStyle = computed(() => {
  const fontPx = Math.max(11, Math.min(22, Math.round(props.size * 0.28)))
  return {
    fontFamily: familyName.value ? `'${familyName.value}', sans-serif` : 'sans-serif',
    fontSize: `${fontPx}px`,
  }
})

watch(
  () => props.src,
  () => {
    void bindFont()
  },
  { immediate: true },
)

async function bindFont(): Promise<void> {
  const token = ++bindToken
  await releaseFace()
  ready.value = false
  familyName.value = ''
  if (!props.src) {
    emit('error')
    return
  }
  const family = `asset-grid-font-${token}-${Math.random().toString(36).slice(2, 9)}`
  try {
    const response = await fetch(props.src)
    if (!response.ok) throw new Error(`font fetch ${response.status}`)
    const buffer = await response.arrayBuffer()
    if (token !== bindToken) return
    const face = new FontFace(family, buffer)
    await face.load()
    if (token !== bindToken) {
      try {
        document.fonts.delete(face)
      } catch {
        /* ignore */
      }
      return
    }
    document.fonts.add(face)
    loadedFace = face
    familyName.value = family
    ready.value = true
  } catch {
    if (token !== bindToken) return
    emit('error')
  }
}

async function releaseFace(): Promise<void> {
  if (!loadedFace) return
  try {
    document.fonts.delete(loadedFace)
  } catch {
    /* ignore */
  }
  loadedFace = null
}

onUnmounted(() => {
  bindToken += 1
  void releaseFace()
})
</script>

<template>
  <span class="asset-grid-font-thumb" :style="{ width: `${size}px`, height: `${size}px` }">
    <span
      v-if="ready"
      class="asset-grid-font-sample"
      :style="sampleStyle"
    >{{ sampleText }}</span>
  </span>
</template>

<style scoped>
.asset-grid-font-thumb {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 4px;
  overflow: hidden;
}

.asset-grid-font-sample {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  max-width: 100%;
  color: var(--app-ink, #2a3138);
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
