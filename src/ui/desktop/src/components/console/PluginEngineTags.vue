<script setup lang="ts">
import { computed } from 'vue';
import { pluginEngineTargets } from './plugin-manager-model';

const props = defineProps<{
  targets: string[];
}>();

const visibleTargets = computed(() => pluginEngineTargets(props.targets));
</script>

<template>
  <span v-if="visibleTargets.length" class="plugin-engine-tags">
    <el-tag
      v-for="target in visibleTargets"
      :key="target"
      size="small"
      effect="plain"
      class="plugin-engine-tag"
      :class="target.toLocaleLowerCase()"
    >
      {{ target }}
    </el-tag>
  </span>
</template>

<style scoped>
.plugin-engine-tags {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.plugin-engine-tag {
  --engine-color: var(--console-text-muted, #9a8e7e);
  height: 16px;
  padding: 0 4px;
  border-color: color-mix(in srgb, var(--engine-color) 38%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--engine-color) 10%, transparent);
  color: var(--engine-color);
  font-size: 8px;
  font-weight: 700;
  line-height: 14px;
}
.plugin-engine-tag.mv {
  --engine-color: var(--console-accent, #be5630);
}
.plugin-engine-tag.mz {
  --engine-color: var(--app-tone-control, #3d76b8);
}
</style>
