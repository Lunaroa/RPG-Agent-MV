<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Close } from '@element-plus/icons-vue'

/**
 * Borderless full-screen video viewer that mirrors ElImageViewer UX:
 * dark overlay, centered player, Esc / mask-click to close, and prev/next
 * switching across sibling videos. Kept intentionally minimal — playback
 * controls come from the native <video> element.
 */
const props = defineProps<{
  urlList: string[];
  initialIndex?: number;
}>()

const emit = defineEmits<{
  close: [];
  switch: [index: number];
}>()

const index = ref(props.initialIndex ?? 0)

const currentUrl = computed(() => props.urlList[index.value] ?? '')
const hasMultiple = computed(() => props.urlList.length > 1)

watch(
  () => props.initialIndex,
  (next) => {
    if (typeof next === 'number') index.value = clampIndex(next)
  },
)

function clampIndex(value: number): number {
  if (props.urlList.length === 0) return 0
  const last = props.urlList.length - 1
  if (value < 0) return last
  if (value > last) return 0
  return value
}

function go(step: number): void {
  if (!hasMultiple.value) return
  index.value = clampIndex(index.value + step)
  emit('switch', index.value)
}

function close(): void {
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    go(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    go(1)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <teleport to="body">
    <div class="asset-video-viewer" @click.self="close">
      <button type="button" class="asset-video-viewer__close" @click="close">
        <el-icon><Close /></el-icon>
      </button>

      <button
        v-if="hasMultiple"
        type="button"
        class="asset-video-viewer__nav asset-video-viewer__nav--prev"
        @click="go(-1)"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>

      <div class="asset-video-viewer__stage" @click.self="close">
        <video
          :key="currentUrl"
          :src="currentUrl"
          class="asset-video-viewer__video"
          controls
          autoplay
        />
      </div>

      <button
        v-if="hasMultiple"
        type="button"
        class="asset-video-viewer__nav asset-video-viewer__nav--next"
        @click="go(1)"
      >
        <el-icon><ArrowRight /></el-icon>
      </button>

      <div v-if="hasMultiple" class="asset-video-viewer__counter">
        {{ index + 1 }} / {{ urlList.length }}
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.asset-video-viewer {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
}

.asset-video-viewer__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 48px;
  box-sizing: border-box;
}

.asset-video-viewer__video {
  max-width: 90vw;
  max-height: 90vh;
  outline: none;
  background: #000;
}

.asset-video-viewer__close,
.asset-video-viewer__nav {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.2s;
}

.asset-video-viewer__close:hover,
.asset-video-viewer__nav:hover {
  background: rgba(255, 255, 255, 0.25);
}

.asset-video-viewer__close {
  top: 24px;
  right: 24px;
  width: 40px;
  height: 40px;
  font-size: 20px;
}

.asset-video-viewer__nav {
  top: 50%;
  width: 44px;
  height: 44px;
  font-size: 22px;
  transform: translateY(-50%);
}

.asset-video-viewer__nav--prev {
  left: 24px;
}

.asset-video-viewer__nav--next {
  right: 24px;
}

.asset-video-viewer__counter {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  color: #fff;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
}
</style>
