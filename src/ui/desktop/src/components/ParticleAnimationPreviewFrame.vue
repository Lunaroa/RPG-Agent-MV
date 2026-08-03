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
 * screen renders at native pixel size and the host viewport crops it centered on the
 * effect's target point (reported by the runtime once the battler is measured). Without
 * them the iframe fills the host and the runtime letterboxes the whole screen.
 */
const props = defineProps<{
  project: string;
  nativeWidth?: number;
  nativeHeight?: number;
  /** Replay the animation as soon as it finishes; used by autoplay() previews. */
  loop?: boolean;
}>();

const url = ref('');
const busy = ref(false);
const iframeEl = ref<HTMLIFrameElement | null>(null);
// The effect's target point (native screen px) reported by the runtime once the battler
// bitmap is measured; the 1:1 crop centers on it so any battler size stays framed.
const targetAnchor = ref<{ x: number; y: number } | null>(null);
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
  const data = event.data as { type?: string; targetX?: number; targetY?: number } | null;
  if (data?.type === 'rpg-agent-preview-ready') {
    sceneReady = true;
    if (typeof data.targetX === 'number' && typeof data.targetY === 'number') {
      targetAnchor.value = { x: data.targetX, y: data.targetY };
    }
    if (pendingPlay) {
      pendingPlay = false;
      clearPendingPlayTimer();
      postPlay();
    }
  }
}

async function prepareSession(
  animation: Record<string, unknown>,
  options: { autoplay: boolean; armed?: boolean; loop?: boolean },
): Promise<void> {
  const seq = ++requestSeq;
  busy.value = true;
  sceneReady = false;
  pendingPlay = false;
  clearPendingPlayTimer();
  targetAnchor.value = null;
  try {
    const session = await particlePreview.prepare(animation, options.autoplay, props.project, options.armed === true, options.loop === true);
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
    else armPendingPlay();
    return;
  }
  // No armed scene for this animation yet (first play, or the draft changed): arm a
  // fresh one and play on its ready handshake, so later identical plays are in-place.
  await prepareSession(animation, { autoplay: false, armed: true });
  if (armedAnimationKey === key && url.value) armPendingPlay();
}

// The armed scene normally signals readiness via the 'rpg-agent-preview-ready'
// postMessage, which clears pendingPlay and posts 'play'. That handshake can stall
// (battler bitmap slow/missing, iframe swapped under :key, message lost in a
// background window), leaving the auto-play silently stuck. Guard it with a timeout
// so the animation always plays at least once even if the ready message never lands.
const PENDING_PLAY_TIMEOUT_MS = 4000;
let pendingPlayTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingPlayTimer(): void {
  if (pendingPlayTimer !== null) {
    clearTimeout(pendingPlayTimer);
    pendingPlayTimer = null;
  }
}

function armPendingPlay(): void {
  pendingPlay = true;
  clearPendingPlayTimer();
  const seq = requestSeq;
  pendingPlayTimer = setTimeout(() => {
    pendingPlayTimer = null;
    if (seq !== requestSeq || !pendingPlay) return;
    pendingPlay = false;
    postPlay();
  }, PENDING_PLAY_TIMEOUT_MS);
}

async function showBackdrop(
  animation: Record<string, unknown>,
  options: { armed?: boolean } = {},
): Promise<void> {
  await prepareSession(animation, { autoplay: false, armed: options.armed === true });
}

// Fire-and-forget playback for previews with no play button (side panel, immersive
// viewer): loads the scene and starts immediately, looping when the loop prop is set.
async function autoplay(animation: Record<string, unknown>): Promise<void> {
  await prepareSession(animation, { autoplay: true, loop: props.loop === true });
}

onMounted(() => window.addEventListener('message', onWindowMessage));
onUnmounted(() => window.removeEventListener('message', onWindowMessage));
onBeforeUnmount(() => {
  requestSeq += 1;
  clearPendingPlayTimer();
  if (sessionKey) {
    void particlePreview.dispose(sessionKey);
    sessionKey = '';
  }
});

// Editor-style crop: size the iframe to the native game screen and offset it so the
// effect's target point lands at the host center. The runtime reports that point once
// the battler is measured; until then fall back to screen center so the first frame is
// framed sensibly and only nudges when the precise anchor arrives.
const cropStyle = computed(() => {
  const width = props.nativeWidth;
  const height = props.nativeHeight;
  if (!width || !height || width < 1 || height < 1) return null;
  const anchor = targetAnchor.value ?? { x: width / 2, y: height / 2 };
  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `calc(50% - ${Math.round(anchor.x)}px)`,
    top: `calc(50% - ${Math.round(anchor.y)}px)`,
  };
});

defineExpose({ play, showBackdrop, autoplay, busy });
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
