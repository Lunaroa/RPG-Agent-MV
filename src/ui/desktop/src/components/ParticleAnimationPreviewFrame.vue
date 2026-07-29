<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';
import { particlePreview } from '../api/client';

/**
 * In-panel MZ particle animation playback. showBackdrop({ armed: true }) prepares the
 * scene (battle background + target monster) with the effect loaded but paused; play()
 * then starts it in-place via a postMessage 'play' so the iframe never reloads (no black
 * flash). play() for a not-yet-armed animation arms a fresh scene and starts it on the
 * ready handshake, so repeated plays of the same animation are always in-place.
 *
 * nativeWidth/nativeHeight switch the iframe to the editor-style 1:1 crop: the game
 * screen renders at native pixel size and the host viewport crops it around the target
 * (anchored at 50% width / 68% height of the screen). Without them the iframe fills the
 * host and the runtime letterboxes the whole screen.
 */
const props = defineProps<{
  project: string;
  nativeWidth?: number;
  nativeHeight?: number;
}>();

const url = ref('');
const busy = ref(false);
const iframeEl = ref<HTMLIFrameElement | null>(null);
let sessionKey = '';
let requestSeq = 0;
// The animation an armed backdrop was prepared for; play() reuses that loaded scene.
let armedAnimationKey = '';
let sceneReady = false;
let pendingPlay = false;

function animationKey(animation: Record<string, unknown>): string {
  try {
    return JSON.stringify(animation);
  } catch {
    return '';
  }
}

function postPlay(): void {
  iframeEl.value?.contentWindow?.postMessage({ type: 'play' }, '*');
}

function onWindowMessage(event: MessageEvent): void {
  if (!iframeEl.value || event.source !== iframeEl.value.contentWindow) return;
  if ((event.data as { type?: string } | null)?.type === 'rpg-agent-preview-ready') {
    sceneReady = true;
    if (pendingPlay) {
      pendingPlay = false;
      postPlay();
    }
  }
}

async function prepareSession(
  animation: Record<string, unknown>,
  options: { autoplay: boolean; armed?: boolean },
): Promise<void> {
  const seq = ++requestSeq;
  busy.value = true;
  sceneReady = false;
  pendingPlay = false;
  try {
    const session = await particlePreview.prepare(animation, options.autoplay, props.project, options.armed === true);
    if (seq !== requestSeq) {
      void particlePreview.dispose(session.key);
      return;
    }
    const previousKey = sessionKey;
    sessionKey = session.key;
    armedAnimationKey = options.armed ? animationKey(animation) : '';
    url.value = session.url;
    if (previousKey) void particlePreview.dispose(previousKey);
  } finally {
    if (seq === requestSeq) busy.value = false;
  }
}

async function play(animation: Record<string, unknown>): Promise<void> {
  // Reuse an armed backdrop for the same animation: start it in-place so the iframe
  // (with its already-loaded background and target) never reloads.
  const key = animationKey(animation);
  if (armedAnimationKey && armedAnimationKey === key && url.value) {
    if (sceneReady) postPlay();
    else pendingPlay = true;
    return;
  }
  // No armed scene for this animation yet (first play, or the draft changed): arm a
  // fresh one and play on its ready handshake, so later identical plays are in-place.
  await prepareSession(animation, { autoplay: false, armed: true });
  if (armedAnimationKey === key && url.value) pendingPlay = true;
}

async function showBackdrop(
  animation: Record<string, unknown>,
  options: { armed?: boolean } = {},
): Promise<void> {
  await prepareSession(animation, { autoplay: false, armed: options.armed === true });
}

onMounted(() => window.addEventListener('message', onWindowMessage));
onUnmounted(() => window.removeEventListener('message', onWindowMessage));
onBeforeUnmount(() => {
  requestSeq += 1;
  if (sessionKey) {
    void particlePreview.dispose(sessionKey);
    sessionKey = '';
  }
});

// Editor-style crop: size the iframe to the native game screen and offset it so the
// target anchor (screen 50% x / 68% y) lands at 50% width / 70% height of the host.
const cropStyle = computed(() => {
  const width = props.nativeWidth;
  const height = props.nativeHeight;
  if (!width || !height || width < 1 || height < 1) return null;
  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `calc(50% - ${width / 2}px)`,
    top: `calc(70% - ${Math.round(height * 0.68)}px)`,
  };
});

defineExpose({ play, showBackdrop, busy });
</script>

<template>
  <div class="particle-preview-frame">
    <iframe
      v-if="url"
      ref="iframeEl"
      :key="url"
      :src="url"
      class="particle-preview-iframe"
      :class="{ 'particle-preview-iframe-cropped': Boolean(cropStyle) }"
      :style="cropStyle || undefined"
      tabindex="-1"
    />
  </div>
</template>

<style scoped>
/* Height comes from the host class (aspect-ratio) set by each caller; a 100% height
   here would resolve against the flex row that already includes the play button and
   push siblings out of the panel. */
.particle-preview-frame {
  position: relative;
  width: 100%;
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
.particle-preview-iframe-cropped {
  position: absolute;
}
</style>
