<template>
  <div class="chat-composer-wrap" data-ui-id="chat-composer">
    <div
      class="chat-composer"
      :class="{ 'is-focused': focused, 'has-text': !!modelValue.trim() }"
    >
      <textarea
        ref="textareaRef"
        class="composer-textarea"
        data-ui-id="chat-input"
        :value="modelValue"
        rows="1"
        :placeholder="t('composer.placeholder')"
        @input="onInput"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter="onEnter"
      />

      <div class="composer-footer">
        <div class="composer-footer-left">
          <el-popover placement="top-start" :width="300" trigger="click">
            <template #reference>
              <button type="button" class="composer-icon-btn" data-ui-id="chat-more" :title="t('composer.more')" :aria-label="t('composer.more')">
                <span class="composer-plus">+</span>
              </button>
            </template>
            <div class="composer-popover">
              <div class="composer-popover-settings">
                <div class="composer-panel-field composer-panel-switch">
                  <label for="composer-plan-mode">{{ t('composer.planMode') }}</label>
                  <el-switch
                    id="composer-plan-mode"
                    :model-value="planMode"
                    size="small"
                    @update:model-value="emit('update:planMode', $event)"
                  />
                </div>
              </div>
            </div>
          </el-popover>
        </div>

        <div class="composer-footer-right">
          <ModelPicker
            variant="chip"
            placement="top-end"
            show-reasoning
            show-settings-link
            :providers="availableProviders"
            :selected-provider="selectedProvider"
            :selected-model="selectedModel"
            :thinking-level="thinkingLevel"
            :empty-configured-hint="t('composer.noModels')"
            @select="onSelectProfile"
            @update:thinking-level="emit('update:thinkingLevel', $event)"
          />

          <button
            type="button"
            class="composer-send-btn"
            data-ui-id="chat-send"
            :class="{ 'is-stop': isRunning }"
            :disabled="!isRunning && !modelValue.trim()"
            :title="isRunning ? t('composer.stop') : t('composer.sendEnter')"
            :aria-label="isRunning ? t('composer.stop') : t('composer.send')"
            @click="onSendClick"
          >
            <el-icon v-if="isRunning"><VideoPause /></el-icon>
            <el-icon v-else><Top /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Top, VideoPause } from '@element-plus/icons-vue'
import ModelPicker from './model-picker/ModelPicker.vue'
import { useI18n } from '../i18n'

const props = defineProps<{
  modelValue: string
  isRunning: boolean
  availableProviders: Array<{ id: string; label: string; models: Array<{ id: string; label: string }> }>
  selectedProvider: string
  selectedModel: string
  thinkingLevel: string
  planMode: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: []
  stop: []
  'update:selectedProvider': [id: string]
  'update:selectedModel': [id: string]
  'update:thinkingLevel': [v: string]
  'update:planMode': [v: boolean]
  'select-profile': [payload: { providerId: string; modelId: string }]
}>()

const focused = ref(false)
const textareaRef = ref<HTMLTextAreaElement>()
const { t } = useI18n()

function onSelectProfile(payload: { providerId: string; modelId: string }) {
  emit('select-profile', payload)
}

function onSendClick() {
  if (props.isRunning) {
    emit('stop')
    return
  }
  if (!props.modelValue.trim()) return
  emit('send')
}

function onEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (props.isRunning) return
  onSendClick()
}

function onInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  emit('update:modelValue', value)
  void nextTick(resizeTextarea)
}

function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 280)}px`
}

watch(() => props.modelValue, () => void nextTick(resizeTextarea))
</script>
