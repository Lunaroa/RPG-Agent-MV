<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Close } from '@element-plus/icons-vue'
import ParticleAnimationPreviewFrame from './ParticleAnimationPreviewFrame.vue'

/**
 * Borderless full-screen effect viewer that mirrors AssetVideoViewer UX: dark overlay,
 * centered stage, Esc / mask-click to close, prev/next across sibling effects. The stage
 * hosts a ParticleAnimationPreviewFrame that autoplays the effect on the project's default
 * battle scene and loops it, so the effect reads like a looping video rather than a frame.
 */
const props = defineProps<{
  /** Effect names in view order; the viewer plays list[index]. */
  nameList: string[]
  project: string
  initialIndex?: number
}>()

const emit = defineEmits<{
  close: []
  switch: [index: number]
}>()

const index = ref(props.initialIndex ?? 0)
const frameRef = ref<InstanceType<typeof ParticleAnimationPreviewFrame> | null>(null)

const currentName = computed(() => props.nameList[index.value] ?? '')
const hasMultiple = computed(() => props.nameList.length > 1)

watch(
  () => props.initialIndex,
  (next) => {
    if (typeof next === 'number') index.value = clampIndex(next)
  },
)

// Reload playback whenever the shown effect changes (mount handled by the immediate run).
watch(currentName, (name) => {
  if (!name) return
  void nextTick(() => frameRef.value?.autoplay({ effectName: name }))
}, { immediate: true })

function clampIndex(value: number): number {
  if (props.nameList.length === 0) return 0
  const last = props.nameList.length - 1
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
    <div class="asset-effect-viewer" @click.self="close">
      <button type="button" class="asset-effect-viewer__close" @click="close">
        <el-icon><Close /></el-icon>
      </button>

      <button
        v-if="hasMultiple"
        type="button"
        class="asset-effect-viewer__nav asset-effect-viewer__nav--prev"
        @click="go(-1)"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>

      <div class="asset-effect-viewer__stage" @click.self="close">
        <ParticleAnimationPreviewFrame
          ref="frameRef"
          class="asset-effect-viewer__frame"
          :project="project"
          loop
        />
      </div>

      <button
        v-if="hasMultiple"
        type="button"
        class="asset-effect-viewer__nav asset-effect-viewer__nav--next"
        @click="go(1)"
      >
        <el-icon><ArrowRight /></el-icon>
      </button>

      <div class="asset-effect-viewer__caption">
        <span class="asset-effect-viewer__name">{{ currentName }}</span>
        <span v-if="hasMultiple" class="asset-effect-viewer__counter">
          {{ index + 1 }} / {{ nameList.length }}
        </span>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.asset-effect-viewer {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
}

.asset-effect-viewer__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 48px;
  box-sizing: border-box;
}

.asset-effect-viewer__frame {
  width: 100%;
  height: 100%;
  background: transparent;
  border-radius: 0;
}

.asset-effect-viewer__close,
.asset-effect-viewer__nav {
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

.asset-effect-viewer__close:hover,
.asset-effect-viewer__nav:hover {
  background: rgba(255, 255, 255, 0.25);
}

.asset-effect-viewer__close {
  top: 24px;
  right: 24px;
  width: 40px;
  height: 40px;
  font-size: 20px;
}

.asset-effect-viewer__nav {
  top: 50%;
  width: 44px;
  height: 44px;
  font-size: 22px;
  transform: translateY(-50%);
}

.asset-effect-viewer__nav--prev {
  left: 24px;
}

.asset-effect-viewer__nav--next {
  right: 24px;
}

.asset-effect-viewer__caption {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  color: #fff;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
}

.asset-effect-viewer__counter {
  color: rgba(255, 255, 255, 0.75);
}
</style>
