<script setup lang="ts">
import { computed } from 'vue'

/**
 * Windows-Explorer-style folder icon: a yellow folder with up to two content
 * thumbnails peeking out of it (like the RPG Maker file-parameter picker).
 * Purely presentational; the parent decides which preview URLs to pass.
 */
const props = withDefaults(defineProps<{
  /** Up to two thumbnail URLs shown inside the folder. */
  previews?: string[]
  /** Icon width in px; height follows the 64:50 viewBox ratio. */
  size?: number
}>(), {
  previews: () => [],
  size: 72,
})

const shown = computed(() => props.previews.slice(0, 2))
const height = computed(() => Math.round((props.size * 50) / 64))
</script>

<template>
  <span
    class="asset-folder-icon"
    :style="{ width: `${size}px`, height: `${height}px` }"
    aria-hidden="true"
  >
    <svg
      class="afi-back"
      viewBox="0 0 64 50"
      focusable="false"
    >
      <path
        d="M4 10a4 4 0 0 1 4-4h15l5 6h28a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="#e8b23a"
        stroke="#c99420"
        stroke-width="1.5"
      />
    </svg>
    <img
      v-for="(url, index) in shown"
      :key="`${index}:${url}`"
      class="afi-preview"
      :class="`afi-preview-${index}`"
      :src="url"
      alt=""
      draggable="false"
      loading="lazy"
    >
    <svg
      class="afi-front"
      viewBox="0 0 64 50"
      focusable="false"
    >
      <defs>
        <linearGradient
          id="afi-front-fill"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0" stop-color="#ffd868" />
          <stop offset="1" stop-color="#ffc93c" />
        </linearGradient>
      </defs>
      <path
        d="M4 22h56v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="url(#afi-front-fill)"
        stroke="#c99420"
        stroke-width="1.5"
      />
    </svg>
  </span>
</template>

<style scoped>
.asset-folder-icon {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
}

.afi-back,
.afi-front {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.afi-preview {
  position: absolute;
  z-index: 1;
  width: 38%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #fff;
  border: 1px solid #e3d9c8;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
}

.afi-preview-0 {
  left: 14%;
  top: 22%;
  transform: rotate(-8deg);
}

.afi-preview-1 {
  left: 44%;
  top: 16%;
  transform: rotate(6deg);
}

.afi-front {
  z-index: 2;
}
</style>
