<template>
  <teleport to="body">
    <div
      class="language-shell"
      data-ui-id="language-picker"
      role="dialog"
      aria-modal="true"
      aria-label="选择语言 / Choose language"
    >
      <div class="language-dim" />
      <section class="language-card">
        <h1 class="language-title">选择语言</h1>
        <p class="language-subtitle">Choose your language</p>

        <div class="language-options" role="listbox" aria-label="Language options">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="language-option"
            :class="{ selected: selected === option.value }"
            :data-ui-id="`language-picker-option-${option.value}`"
            role="option"
            :aria-selected="selected === option.value"
            @click="selected = option.value"
          >
            <span class="language-option-label">{{ option.label }}</span>
            <Check v-if="selected === option.value" :size="16" :stroke-width="2" />
          </button>
        </div>

        <button
          type="button"
          class="language-continue"
          data-ui-id="language-picker-continue"
          :disabled="saving"
          @click="confirmSelection"
        >
          <span>{{ continueLabel }}</span>
          <ChevronRight :size="15" :stroke-width="1.8" />
        </button>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronRight } from '@lucide/vue'
import type { ProductLanguage } from '@contract/types'
import { PRODUCT_LANGUAGE_OPTIONS, translate } from '../../i18n/messages'
import { useSettingsStore } from '../../stores/settings'
import { guessSystemLanguage } from '../../utils/language-selection'

const emit = defineEmits<{
  chosen: [language: ProductLanguage]
}>()

const settingsStore = useSettingsStore()
const selected = ref<ProductLanguage>(guessSystemLanguage())
const saving = ref(false)

const options = computed(() =>
  PRODUCT_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: translate(option.labelKey, option.value),
  })),
)

const continueLabel = computed(() =>
  selected.value === 'zh-CN' ? '继续' : 'Continue',
)

async function confirmSelection(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const nextUi = {
      ...settingsStore.ui,
      language: selected.value,
    }
    await settingsStore.saveUi(nextUi)
    emit('chosen', selected.value)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.language-shell {
  position: fixed;
  inset: 0;
  z-index: 3500;
  display: grid;
  place-items: center;
  pointer-events: auto;
  color: var(--app-ink);
}

.language-dim {
  position: fixed;
  inset: 0;
  background: rgba(28, 24, 19, .58);
}

.language-card {
  position: relative;
  z-index: 1;
  width: min(360px, calc(100vw - 28px));
  padding: 24px 22px 20px;
  border: 1px solid color-mix(in srgb, var(--app-border-strong, #d7cdbd) 72%, #f2b36d 28%);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255, 253, 249, .98), rgba(250, 246, 239, .98));
  box-shadow: 0 24px 70px rgba(28, 24, 19, .28);
}

.language-title {
  margin: 0;
  color: var(--app-ink);
  font-size: 22px;
  line-height: 1.2;
  font-weight: 680;
  text-align: center;
}

.language-subtitle {
  margin: 6px 0 0;
  color: var(--app-ink-soft);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.language-options {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.language-option {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 14px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: #fffdf9;
  color: var(--app-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}

.language-option:hover {
  border-color: #d7b48a;
  background: #fff8ef;
}

.language-option.selected {
  border-color: #d28a4c;
  background: #fff4e8;
  box-shadow: 0 0 0 3px rgba(242, 179, 109, .18);
}

.language-option-label {
  text-align: left;
}

.language-continue {
  width: 100%;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 16px;
  border: 0;
  border-radius: 8px;
  background: #e8893d;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.language-continue:disabled {
  opacity: .7;
  cursor: wait;
}

.language-continue:not(:disabled):hover {
  background: #d97d35;
}
</style>
