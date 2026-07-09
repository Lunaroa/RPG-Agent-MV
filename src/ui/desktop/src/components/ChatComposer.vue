<template>
  <div class="chat-composer-wrap" data-ui-id="chat-composer">
    <div
      class="chat-composer"
      :class="{ 'is-focused': focused, 'has-text': !!modelValue.trim() }"
    >
      <div class="composer-input-shell">
        <SlashPopover
          :open="slashOpen"
          :items="filteredSlashCommands"
          :active-index="slashActiveIndex"
          @select="applySlashCommand"
        />
        <textarea
          ref="textareaRef"
          class="composer-textarea"
          data-ui-id="chat-input"
          :value="modelValue"
          rows="1"
          :placeholder="t('composer.placeholder')"
          @input="onInput"
          @focus="focused = true"
          @blur="onBlur"
          @keydown="onKeydown"
          @keydown.enter="onEnter"
        />
      </div>

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
          <ContextUsageRing
            :context-percent="contextPercent"
            :context-used-tokens="contextUsedTokens"
            :context-window-tokens="contextWindowTokens"
          />
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
            :class="{ 'is-stop': showStopButton }"
            :disabled="sendDisabled"
            :title="showStopButton ? t('composer.stop') : t('composer.sendEnter')"
            :aria-label="showStopButton ? t('composer.stop') : t('composer.send')"
            @click="onSendClick"
          >
            <el-icon v-if="showStopButton"><VideoPause /></el-icon>
            <el-icon v-else><Top /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Top, VideoPause } from '@element-plus/icons-vue'
import ModelPicker from './model-picker/ModelPicker.vue'
import ContextUsageRing from './ContextUsageRing.vue'
import SlashPopover from './SlashPopover.vue'
import type { SlashCommandListItem } from '../api/client'
import { filterSlashCommands } from '../utils/chatSlashFilter'
import {
  isCompleteSlashCommand,
  isSlashInput,
  shouldOpenSlashPopover,
} from '../utils/chatSlashInput'
import { useI18n } from '../i18n'

const props = defineProps<{
  modelValue: string
  isRunning: boolean
  availableProviders: Array<{ id: string; label: string; models: Array<{ id: string; label: string }> }>
  selectedProvider: string
  selectedModel: string
  thinkingLevel: string
  planMode: boolean
  slashCommands: SlashCommandListItem[]
  contextPercent?: number | null
  contextUsedTokens?: number | null
  contextWindowTokens?: number | null
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
const slashActiveIndex = ref(0)
const { t } = useI18n()

const filteredSlashCommands = computed(() => filterSlashCommands(props.modelValue, props.slashCommands))
const slashReadyToSend = computed(() => isCompleteSlashCommand(props.modelValue, props.slashCommands))
const slashOpen = computed(() => (
  focused.value
  && !slashReadyToSend.value
  && shouldOpenSlashPopover(props.modelValue)
))
const showStopButton = computed(() => props.isRunning && !isSlashInput(props.modelValue))
const sendDisabled = computed(() => {
  if (showStopButton.value) return false
  return !props.modelValue.trim()
})

watch([slashOpen, filteredSlashCommands], () => {
  slashActiveIndex.value = 0
})

function onSelectProfile(payload: { providerId: string; modelId: string }) {
  emit('select-profile', payload)
}

function onSendClick() {
  if (showStopButton.value) {
    emit('stop')
    return
  }
  if (!props.modelValue.trim()) return
  emit('send')
}

function onEnter(event: KeyboardEvent) {
  if (slashReadyToSend.value) {
    if (event.shiftKey || event.isComposing) return
    event.preventDefault()
    onSendClick()
    return
  }
  if (slashOpen.value && filteredSlashCommands.value.length > 0) {
    event.preventDefault()
    const selected = filteredSlashCommands.value[slashActiveIndex.value]
    if (selected) applySlashCommand(selected.name)
    return
  }
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (props.isRunning && !isSlashInput(props.modelValue)) return
  onSendClick()
}

function onKeydown(event: KeyboardEvent) {
  if (!slashOpen.value || filteredSlashCommands.value.length === 0) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    slashActiveIndex.value = (slashActiveIndex.value + 1) % filteredSlashCommands.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const total = filteredSlashCommands.value.length
    slashActiveIndex.value = (slashActiveIndex.value - 1 + total) % total
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    const selected = filteredSlashCommands.value[slashActiveIndex.value]
    if (selected) applySlashCommand(selected.name)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    focused.value = false
    textareaRef.value?.blur()
  }
}

function applySlashCommand(name: string) {
  emit('update:modelValue', `/${name} `)
  void nextTick(() => {
    textareaRef.value?.focus()
    resizeTextarea()
  })
}

function onBlur() {
  focused.value = false
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

<style scoped>
.composer-input-shell {
  position: relative;
}
</style>
