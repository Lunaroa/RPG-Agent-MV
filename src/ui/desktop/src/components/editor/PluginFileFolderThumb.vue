<template>
  <span class="folder-thumb" :class="{ empty: !visibleUrls.length }" aria-hidden="true">
    <span class="folder-back" />
    <span
      v-for="(url, index) in visibleUrls"
      :key="`${url}:${index}`"
      class="folder-sheet"
      :class="`sheet-${index}`"
      :style="{ zIndex: 2 + index }"
    >
      <img
        v-if="!failed.has(url)"
        :src="url"
        alt=""
        loading="lazy"
        decoding="async"
        @error="markFailed(url)"
      />
    </span>
    <span class="folder-front" />
    <span class="folder-tab" />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  urls: string[];
}>();

const failed = ref(new Set<string>());

watch(
  () => props.urls,
  () => {
    failed.value = new Set();
  },
);

const visibleUrls = computed(() =>
  props.urls.filter((url) => url && !failed.value.has(url)).slice(0, 3),
);

function markFailed(url: string): void {
  failed.value = new Set([...failed.value, url]);
}
</script>

<style scoped>
.folder-thumb {
  position: relative;
  width: 108px;
  height: 88px;
  display: block;
  margin: 0 auto;
  filter: drop-shadow(0 1px 2px rgba(40, 32, 18, .2));
}
.folder-back,
.folder-front,
.folder-tab {
  position: absolute;
  inset: auto;
  background: linear-gradient(180deg, #f6e7b0 0%, #e8c86a 55%, #d9b24a 100%);
  border: 1px solid #c9a227;
  box-sizing: border-box;
}
.folder-tab {
  top: 4px;
  left: 10px;
  width: 38px;
  height: 16px;
  border-radius: 5px 8px 0 0;
  border-bottom: 0;
  z-index: 1;
}
.folder-back {
  top: 16px;
  left: 4px;
  width: 100px;
  height: 64px;
  border-radius: 5px 7px 6px 6px;
  z-index: 1;
}
.folder-front {
  top: 40px;
  left: 2px;
  width: 104px;
  height: 44px;
  border-radius: 3px 3px 7px 7px;
  background: linear-gradient(180deg, #f3df9a 0%, #e2bc55 70%, #d0a63a 100%);
  z-index: 6;
  clip-path: polygon(0 28%, 12% 0, 88% 0, 100% 28%, 100% 100%, 0 100%);
}
.folder-sheet {
  position: absolute;
  top: 12px;
  width: 48px;
  height: 60px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(40, 32, 18, .28);
  border-radius: 3px;
  background: #f7f3ea;
  box-shadow: 0 1px 3px rgba(40, 32, 18, .22);
}
.folder-sheet img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
  margin: 0 auto;
  object-fit: contain;
  object-position: center center;
  image-rendering: auto;
}
.sheet-0 {
  left: 16px;
  transform: rotate(-10deg);
}
.sheet-1 {
  left: 32px;
  top: 10px;
  transform: rotate(1deg);
}
.sheet-2 {
  left: 48px;
  top: 12px;
  transform: rotate(11deg);
}
.folder-thumb.empty .folder-front {
  top: 30px;
  height: 52px;
  clip-path: none;
  border-radius: 5px 5px 7px 7px;
}
</style>
