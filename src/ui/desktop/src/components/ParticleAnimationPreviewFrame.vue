<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { particlePreview } from '../api/client';

/**
 * In-panel MZ particle animation playback. Each play() prepares an isolated
 * preview app session and reloads the iframe; the preview runtime plays the
 * animation once and then idles, matching the stock editor.
 */
const props = defineProps<{ project: string }>();

const url = ref('');
const busy = ref(false);
let sessionKey = '';
let requestSeq = 0;

async function play(animation: Record<string, unknown>): Promise<void> {
  const seq = ++requestSeq;
  busy.value = true;
  try {
    const session = await particlePreview.prepare(animation, props.project);
    if (seq !== requestSeq) {
      void particlePreview.dispose(session.key);
      return;
    }
    const previousKey = sessionKey;
    sessionKey = session.key;
    url.value = session.url;
    if (previousKey) void particlePreview.dispose(previousKey);
  } finally {
    if (seq === requestSeq) busy.value = false;
  }
}

onBeforeUnmount(() => {
  requestSeq += 1;
  if (sessionKey) {
    void particlePreview.dispose(sessionKey);
    sessionKey = '';
  }
});

defineExpose({ play, busy });
</script>

<template>
  <div class="particle-preview-frame">
    <iframe
      v-if="url"
      :key="url"
      :src="url"
      class="particle-preview-iframe"
      tabindex="-1"
    />
  </div>
</template>

<style scoped>
.particle-preview-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #171411;
  border-radius: 4px;
  overflow: hidden;
}
.particle-preview-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
