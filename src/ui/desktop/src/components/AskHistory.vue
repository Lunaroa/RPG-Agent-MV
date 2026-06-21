<template>
  <div class="ask-history">
    <div v-for="(pair, index) in pairs" :key="`${ask.askId}-${index}`" class="ask-history-pair">
      <div class="ask-history-question">{{ pair.question }}</div>
      <div class="seg-user">
        <div class="user-bubble">{{ pair.answer }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Ask } from '../utils/askParser'
import { buildAskHistoryPairs } from '../utils/askHistory'
import { useI18n } from '../i18n'

const props = defineProps<{ ask: Ask }>()
const { language } = useI18n()
const pairs = computed(() => buildAskHistoryPairs(props.ask, language.value))
</script>
