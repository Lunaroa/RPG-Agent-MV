<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  src: string;
  alt?: string;
}>()
const emit = defineEmits<{ error: [] }>()

/**
 * First-frame captures shared across grid cells and view remounts.
 * Failures are not cached so a transient decode error can retry later;
 * the view-level failedThumbnails set already stops retry storms.
 */
const frameCache = new Map<string, Promise<string>>()

function captureVideoFrame(src: string): Promise<string> {
  const cached = frameCache.get(src)
  if (cached) return cached
  const promise = new Promise<string>((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    video.addEventListener('error', () => {
      cleanup()
      reject(new Error(`Video thumbnail source failed to load: ${src}`))
    }, { once: true })
    video.addEventListener('loadeddata', () => {
      const finish = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          if (!canvas.width || !canvas.height) throw new Error('Video has no visual frame to capture.')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas 2d context is unavailable for video capture.')
          context.drawImage(video, 0, 0)
          const url = canvas.toDataURL('image/webp', 0.8)
          cleanup()
          resolve(url)
        } catch (error) {
          cleanup()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
      // Seek slightly in so an encoded black leader frame is skipped.
      const target = Math.min(0.1, (video.duration || 0) / 2)
      if (target > 0 && Number.isFinite(target)) {
        video.addEventListener('seeked', finish, { once: true })
        video.currentTime = target
      } else {
        finish()
      }
    }, { once: true })
    video.src = src
  })
  frameCache.set(src, promise)
  promise.catch(() => frameCache.delete(src))
  return promise
}

const frame = ref('')

watch(() => props.src, (src) => {
  frame.value = ''
  if (!src) return
  captureVideoFrame(src).then((url) => {
    if (props.src === src) frame.value = url
  }, () => {
    if (props.src === src) emit('error')
  })
}, { immediate: true })
</script>

<template>
  <img
    v-if="frame"
    :src="frame"
    :alt="props.alt || ''"
    draggable="false"
  />
</template>
