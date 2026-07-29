<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog event-text-paste-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="event-text-paste-title">
        <header class="editor-modal-header">
          <strong id="event-text-paste-title" class="editor-modal-title">{{ title }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="event-text-paste-body">
          <textarea
            ref="textareaRef"
            v-model="text"
            class="event-text-paste-input"
            spellcheck="false"
            :placeholder="placeholder"
          />
        </div>
        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" :disabled="!text.trim()" @click="confirm">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';

const emit = defineEmits<{ confirm: [text: string] }>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const title = ref('');
const placeholder = ref('');
const text = ref('');
const textareaRef = ref<HTMLTextAreaElement>();

function open(dialogTitle: string, dialogPlaceholder = '') {
  title.value = dialogTitle;
  placeholder.value = dialogPlaceholder;
  text.value = '';
  visible.value = true;
  void nextTick(() => textareaRef.value?.focus());
}

function close() {
  visible.value = false;
}

function confirm() {
  const value = text.value.trim();
  if (!value) return;
  emit('confirm', value);
  close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.event-text-paste-dialog { width: min(560px, calc(100vw - 32px)); }
.event-text-paste-body { padding: 12px; }
.event-text-paste-input {
  width: 100%;
  min-height: 240px;
  padding: 8px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-family: var(--app-font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
.event-text-paste-input:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 1px; }
</style>
